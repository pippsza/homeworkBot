import { Schema } from "mongoose";

export interface IUsageSummary {
  periodType: "hourly" | "daily" | "weekly" | "monthly";
  periodStart: Date;
  periodEnd: Date;
  projectId: string;
  userId?: string;
  model?: string;
  operationType?: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCachedTokens: number;
  totalReasoningTokens: number;
  totalEstimatedCostUsd: number;
  avgLatencyMs?: number;
  p95LatencyMs?: number;
  maxLatencyMs?: number;
}

export const usageSummarySchema = new Schema<IUsageSummary>(
  {
    periodType: {
      type: String,
      required: true,
      enum: ["hourly", "daily", "weekly", "monthly"],
    },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },

    // Dimensions
    projectId: { type: String, required: true, index: true },
    userId: String,
    model: String,
    operationType: String,

    // Metrics
    totalRequests: { type: Number, required: true, min: 0 },
    successfulRequests: { type: Number, required: true, min: 0 },
    failedRequests: { type: Number, required: true, min: 0 },

    totalInputTokens: { type: Number, required: true, min: 0 },
    totalOutputTokens: { type: Number, required: true, min: 0 },
    totalTokens: { type: Number, required: true, min: 0 },
    totalCachedTokens: { type: Number, default: 0, min: 0 },
    totalReasoningTokens: { type: Number, default: 0, min: 0 },

    totalEstimatedCostUsd: { type: Number, required: true, min: 0 },

    avgLatencyMs: { type: Number, min: 0 },
    p95LatencyMs: { type: Number, min: 0 },
    maxLatencyMs: { type: Number, min: 0 },
  },
  {
    timestamps: true,
    collection: "usageSummaries",
  }
);

usageSummarySchema.index({ periodType: 1, periodStart: -1, projectId: 1 });
usageSummarySchema.index({ periodType: 1, periodStart: -1, userId: 1 });
