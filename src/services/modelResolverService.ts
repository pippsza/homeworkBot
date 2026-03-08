import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { LanguageModel } from "ai";
import { MODEL_ROLES } from "../config/aiModels";

export interface ResolvedModels {
  primary: LanguageModel;
  fallback: LanguageModel | null;
  primaryId: string;
  primaryProvider: string;
  fallbackId: string | null;
  fallbackProvider: string | null;
}

// In-memory cache for modelConfig with TTL
let cachedConfig: any = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getGoogle() {
  return createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
}

function getOpenRouter() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  // @ai-sdk/openai with custom baseURL for OpenRouter
  const { createOpenAI } = require("@ai-sdk/openai");
  return createOpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });
}

/**
 * Create a LanguageModel instance for a given provider + modelId.
 */
function createLanguageModel(provider: string, modelId: string): LanguageModel {
  if (provider === "google") {
    return getGoogle()(modelId);
  }
  if (provider === "openrouter") {
    const or = getOpenRouter();
    if (!or) {
      throw new Error("OpenRouter not configured (missing OPENROUTER_API_KEY)");
    }
    return or.chat(modelId);
  }
  throw new Error(`Unknown provider: ${provider}`);
}

/**
 * Get the model config from Settings (with cache).
 */
async function getModelConfigCached(): Promise<any> {
  const now = Date.now();
  if (cachedConfig && now - cacheTimestamp < CACHE_TTL) {
    return cachedConfig;
  }
  const userService = require("./userService");
  cachedConfig = await userService.getModelConfig();
  cacheTimestamp = now;
  return cachedConfig;
}

/**
 * Invalidate the model config cache (called when config is updated).
 */
function invalidateModelCache(): void {
  cachedConfig = null;
  cacheTimestamp = 0;
}

/**
 * Resolve models for a given AI role.
 * Returns { primary, fallback?, primaryId, fallbackId?, primaryProvider, fallbackProvider? }
 */
async function resolveModels(role: string): Promise<ResolvedModels> {
  const roleConfig = MODEL_ROLES[role];
  if (!roleConfig) throw new Error(`Unknown AI role: ${role}`);

  const config = await getModelConfigCached();
  const roleSettings = config[role] || {};

  // Primary
  const primaryProvider: string = roleSettings.provider || roleConfig.default.provider;
  const primaryModelId: string = roleSettings.modelId || roleConfig.default.modelId;
  const primary = createLanguageModel(primaryProvider, primaryModelId);

  // Fallback (optional)
  let fallback: LanguageModel | null = null;
  let fallbackProvider: string | null = null;
  let fallbackModelId: string | null = null;

  if (roleSettings.fallbackProvider && roleSettings.fallbackModelId) {
    fallbackProvider = roleSettings.fallbackProvider;
    fallbackModelId = roleSettings.fallbackModelId;
    try {
      fallback = createLanguageModel(fallbackProvider!, fallbackModelId!);
    } catch (e: any) {
      console.error(`[modelResolver] Fallback model creation failed (${fallbackProvider}/${fallbackModelId}):`, e.message);
    }
  }

  return {
    primary,
    fallback,
    primaryId: primaryModelId,
    primaryProvider,
    fallbackId: fallbackModelId,
    fallbackProvider,
  };
}

// Convenience methods for common roles

async function getChatModels(): Promise<ResolvedModels> {
  return resolveModels("chat");
}

async function getSolveModels(hasImages: boolean = false): Promise<ResolvedModels> {
  return resolveModels(hasImages ? "solveImage" : "solveText");
}

async function getProSolveModels(hasImages: boolean = false): Promise<ResolvedModels> {
  return resolveModels(hasImages ? "solveImagePro" : "solveTextPro");
}

async function getChatVisionModels(): Promise<ResolvedModels> {
  return resolveModels("chatVision");
}

export {
  createLanguageModel,
  resolveModels,
  getChatModels,
  getChatVisionModels,
  getSolveModels,
  getProSolveModels,
  invalidateModelCache,
};
