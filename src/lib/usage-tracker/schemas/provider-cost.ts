import { Schema, type InferSchemaType } from 'mongoose'

const providerCostSchema = new Schema(
  {
    provider: {
      type: String,
      required: true,
      enum: ['openai', 'anthropic', 'google'],
    },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },

    // Наші дані
    internalTotalTokens: { type: Number, required: true, min: 0 },
    internalEstimatedCostUsd: { type: Number, required: true, min: 0 },
    internalRequestCount: { type: Number, required: true, min: 0 },

    // Дані провайдера
    providerReportedCostUsd: { type: Number, min: 0 },
    providerReportedTokens: { type: Number, min: 0 },

    // Розбіжність
    discrepancyUsd: Number,
    discrepancyPercent: Number,
    discrepancyStatus: {
      type: String,
      enum: ['within_threshold', 'warning', 'critical', 'pending'],
      default: 'pending',
    },

    notes: String,
    importedBy: String,
  },
  {
    timestamps: true,
    collection: 'providerCosts',
  },
)

export type ProviderCostDoc = InferSchemaType<typeof providerCostSchema>
export { providerCostSchema }
