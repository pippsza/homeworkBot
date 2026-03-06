import { Schema } from "mongoose";

export interface ITokenUsageEvent {
  traceId: string;
  projectId: string;
  environment: "production" | "staging" | "development";
  serverInstanceId?: string;
  userId: string;
  provider: "openai" | "anthropic" | "google" | "custom";
  model: string;
  modelGroup?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  estimatedCostUsd: number;
  pricingVersion?: string;
  operationType: string;
  feature?: string;
  endpoint?: string;
  latencyMs: number;
  isStreaming: boolean;
  status: "success" | "error" | "timeout" | "rate_limited";
  errorCode?: string;
  errorMessage?: string;
  entityType?: string;
  entityId?: string;
  requestedAt: Date;
  completedAt: Date;
}

export const tokenUsageEventSchema = new Schema<ITokenUsageEvent>(
  {
    traceId: { type: String, required: true, index: true },

    // Source
    projectId: { type: String, required: true, index: true },
    environment: {
      type: String,
      required: true,
      enum: ["production", "staging", "development"],
      default: "production",
    },
    serverInstanceId: String,

    // User
    userId: { type: String, required: true, index: true },

    // AI provider
    provider: {
      type: String,
      required: true,
      enum: ["openai", "anthropic", "google", "custom"],
      default: "openai",
    },
    model: { type: String, required: true, index: true },
    modelGroup: String,

    // Tokens
    inputTokens: { type: Number, required: true, min: 0 },
    outputTokens: { type: Number, required: true, min: 0 },
    totalTokens: { type: Number, required: true, min: 0 },
    cachedTokens: { type: Number, min: 0 },
    reasoningTokens: { type: Number, min: 0 },

    // Cost
    estimatedCostUsd: { type: Number, required: true, min: 0 },
    pricingVersion: String,

    // Request metadata
    operationType: { type: String, required: true },
    feature: String,
    endpoint: String,

    // Performance
    latencyMs: { type: Number, required: true, min: 0 },
    isStreaming: { type: Boolean, default: false },

    // Status
    status: {
      type: String,
      required: true,
      enum: ["success", "error", "timeout", "rate_limited"],
      default: "success",
    },
    errorCode: String,
    errorMessage: String,

    // Entity context
    entityType: String,
    entityId: String,

    // Request timestamps
    requestedAt: { type: Date, required: true },
    completedAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    collection: "tokenUsageEvents",
  }
);

// Compound indexes for dashboard queries
tokenUsageEventSchema.index({ projectId: 1, createdAt: -1 });
tokenUsageEventSchema.index({ userId: 1, createdAt: -1 });
tokenUsageEventSchema.index({ projectId: 1, userId: 1, createdAt: -1 });
tokenUsageEventSchema.index({ model: 1, createdAt: -1 });

// TTL: auto-delete raw events after 90 days
tokenUsageEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 }
);
