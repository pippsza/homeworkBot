const { Schema } = require("mongoose");

const providerCostSchema = new Schema(
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

module.exports = { providerCostSchema };
