import { Schema, type InferSchemaType } from 'mongoose'

const modelPricingSchema = new Schema(
  {
    provider: { type: String, required: true },
    model: { type: String, required: true, index: true },

    inputPricePerMillionTokens: { type: Number, required: true, min: 0 },
    outputPricePerMillionTokens: { type: Number, required: true, min: 0 },
    cachedInputPricePerMillionTokens: { type: Number, min: 0 },
    reasoningPricePerMillionTokens: { type: Number, min: 0 },

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
