import { Schema, type InferSchemaType } from 'mongoose'

const usageSummarySchema = new Schema(
  {
    periodType: {
      type: String,
      required: true,
      enum: ['hourly', 'daily', 'weekly', 'monthly'],
    },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },

    // Виміри
    projectId: { type: String, required: true, index: true },
    userId: String,
    model: String,
    operationType: String,

    // Метрики
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
    collection: 'usageSummaries',
  },
)

usageSummarySchema.index({ periodType: 1, periodStart: -1, projectId: 1 })
usageSummarySchema.index({ periodType: 1, periodStart: -1, userId: 1 })

export type UsageSummaryDoc = InferSchemaType<typeof usageSummarySchema>
export { usageSummarySchema }
