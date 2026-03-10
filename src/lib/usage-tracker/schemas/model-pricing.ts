import { Schema, type InferSchemaType } from 'mongoose'

const modelPricingSchema = new Schema(
  {
    provider: { type: String, required: true },
    model: { type: String, required: true, index: true },

    // Pricing type determines which price fields are used
    pricingType: {
      type: String,
      required: true,
      enum: ['per_token', 'per_minute', 'per_character'],
      default: 'per_token',
    },

    // ── Per-token pricing (LLMs, embeddings) ──
    inputPricePerMillionTokens: { type: Number, min: 0 },
    outputPricePerMillionTokens: { type: Number, min: 0 },
    cachedInputPricePerMillionTokens: { type: Number, min: 0 },
    reasoningPricePerMillionTokens: { type: Number, min: 0 },

    // ── Per-minute pricing (transcription) ──
    pricePerMinute: { type: Number, min: 0 },
    includedMinutesPerMonth: { type: Number, min: 0 },
    additionalPricePerMinute: { type: Number, min: 0 },

    // ── Per-character pricing (TTS, future) ──
    pricePerMillionCharacters: { type: Number, min: 0 },

    effectiveFrom: { type: Date, required: true },
    effectiveTo: Date,

    source: String,

    displayName: String,
    description: String,
    contextLength: Number,
    supportsVision: { type: Boolean, default: false },
    supportsToolCalling: { type: Boolean, default: false },
    supportsReasoning: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'modelPricing',
  },
)

export type ModelPricingDoc = InferSchemaType<typeof modelPricingSchema>
export { modelPricingSchema }
