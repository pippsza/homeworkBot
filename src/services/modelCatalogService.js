const ModelCatalog = require("../models/ModelCatalog");

// Hardcoded Google models (free tier via API key)
const GOOGLE_MODELS = [
  {
    modelId: "gemini-2.5-flash-lite",
    displayName: "Gemini 2.5 Flash Lite",
    inputPrice: 0, outputPrice: 0,
    contextLength: 1048576,
    supportsVision: true, supportsToolCalling: true, supportsReasoning: false,
    isFree: true,
  },
  {
    modelId: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    inputPrice: 0.15, outputPrice: 0.6,
    contextLength: 1048576,
    supportsVision: true, supportsToolCalling: true, supportsReasoning: true,
    isFree: true,
  },
  {
    modelId: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    inputPrice: 1.25, outputPrice: 10,
    contextLength: 1048576,
    supportsVision: true, supportsToolCalling: true, supportsReasoning: true,
    isFree: true,
  },
  {
    modelId: "gemini-2.0-flash",
    displayName: "Gemini 2.0 Flash",
    inputPrice: 0.1, outputPrice: 0.4,
    contextLength: 1048576,
    supportsVision: true, supportsToolCalling: true, supportsReasoning: false,
    isFree: true,
  },
  {
    modelId: "gemini-2.0-flash-lite",
    displayName: "Gemini 2.0 Flash Lite",
    inputPrice: 0, outputPrice: 0,
    contextLength: 1048576,
    supportsVision: true, supportsToolCalling: true, supportsReasoning: false,
    isFree: true,
  },
  {
    modelId: "gemini-3-flash-preview",
    displayName: "Gemini 3 Flash (Preview)",
    inputPrice: 0.15, outputPrice: 0.6,
    contextLength: 1048576,
    supportsVision: true, supportsToolCalling: true, supportsReasoning: true,
    isFree: true,
  },
];

async function syncGoogleModels() {
  let upserted = 0;
  for (const model of GOOGLE_MODELS) {
    await ModelCatalog.findOneAndUpdate(
      { provider: "google", modelId: model.modelId },
      { ...model, provider: "google", isActive: true },
      { upsert: true }
    );
    upserted++;
  }
  return upserted;
}

async function syncOpenRouterModels() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.log("[modelCatalog] No OPENROUTER_API_KEY, skipping OpenRouter sync");
    return 0;
  }

  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`OpenRouter API error: ${res.status} ${res.statusText}`);
  }

  const { data } = await res.json();
  if (!Array.isArray(data)) return 0;

  let upserted = 0;
  for (const model of data) {
    const pricing = model.pricing || {};
    const inputPrice = parseFloat(pricing.prompt || "0") * 1e6;
    const outputPrice = parseFloat(pricing.completion || "0") * 1e6;

    // Parse capabilities from architecture/supported_parameters
    const arch = model.architecture || {};
    const modality = arch.modality || "";
    const supportsVision = modality.includes("image") || modality.includes("multimodal");
    const supportsToolCalling = (model.supported_parameters || []).includes("tools");
    const supportsReasoning = (model.supported_parameters || []).includes("reasoning");
    const isFree = inputPrice === 0 && outputPrice === 0;

    await ModelCatalog.findOneAndUpdate(
      { provider: "openrouter", modelId: model.id },
      {
        provider: "openrouter",
        modelId: model.id,
        displayName: model.name || model.id,
        inputPrice,
        outputPrice,
        contextLength: model.context_length || 0,
        supportsVision,
        supportsToolCalling,
        supportsReasoning,
        isFree,
        isActive: true,
      },
      { upsert: true }
    );
    upserted++;
  }
  return upserted;
}

async function syncAll() {
  const results = { google: 0, openrouter: 0 };
  results.google = await syncGoogleModels();
  try {
    results.openrouter = await syncOpenRouterModels();
  } catch (e) {
    console.error("[modelCatalog] OpenRouter sync error:", e.message);
  }
  console.log(`[modelCatalog] Synced: ${results.google} google, ${results.openrouter} openrouter`);
  return results;
}

async function getAll(filters = {}) {
  const query = {};
  if (filters.provider) query.provider = filters.provider;
  if (filters.isActive !== undefined) query.isActive = filters.isActive;
  if (filters.supportsVision) query.supportsVision = true;
  if (filters.supportsToolCalling) query.supportsToolCalling = true;
  if (filters.supportsReasoning) query.supportsReasoning = true;
  if (filters.isFree) query.isFree = true;
  if (filters.search) {
    query.displayName = { $regex: filters.search, $options: "i" };
  }
  return ModelCatalog.find(query).sort({ provider: 1, displayName: 1 }).lean();
}

async function getByProviderAndId(provider, modelId) {
  return ModelCatalog.findOne({ provider, modelId }).lean();
}

module.exports = {
  syncGoogleModels,
  syncOpenRouterModels,
  syncAll,
  getAll,
  getByProviderAndId,
};
