import { Schema, Document } from "mongoose";

export interface IProviderCost extends Document {
  provider: "openrouter" | "openai" | "anthropic" | "google";
  periodStart: Date;
  periodEnd: Date;
  internalTotalTokens: number;
  internalEstimatedCostUsd: number;
  internalRequestCount: number;
  providerReportedCostUsd?: number;
  providerReportedTokens?: number;
  discrepancyUsd?: number;
  discrepancyPercent?: number;
  discrepancyStatus: "within_threshold" | "warning" | "critical" | "pending";
  notes?: string;
  importedBy?: string;
}

export const providerCostSchema = new Schema<IProviderCost>(
  {
    provider: {
      type: String,
      required: true,
      enum: ["openrouter", "openai", "anthropic", "google"],
    },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },

    // Internal data
    internalTotalTokens: { type: Number, required: true, min: 0 },
    internalEstimatedCostUsd: { type: Number, required: true, min: 0 },
    internalRequestCount: { type: Number, required: true, min: 0 },

    // Provider data
    providerReportedCostUsd: { type: Number, min: 0 },
    providerReportedTokens: { type: Number, min: 0 },

    // Discrepancy
    discrepancyUsd: Number,
    discrepancyPercent: Number,
    discrepancyStatus: {
      type: String,
      enum: ["within_threshold", "warning", "critical", "pending"],
      default: "pending",
    },

    notes: String,
    importedBy: String,
  },
  {
    timestamps: true,
    collection: "providerCosts",
  }
);
