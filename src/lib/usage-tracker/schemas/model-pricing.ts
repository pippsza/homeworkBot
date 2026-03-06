import { Schema } from "mongoose";

export interface IModelPricing {
  provider: string;
  model: string;
  inputPricePerMillionTokens: number;
  outputPricePerMillionTokens: number;
  cachedInputPricePerMillionTokens?: number;
  reasoningPricePerMillionTokens?: number;
  effectiveFrom: Date;
  effectiveTo?: Date;
  source?: string;
  displayName?: string;
  contextLength?: number;
  supportsVision: boolean;
  supportsToolCalling: boolean;
  supportsReasoning: boolean;
}

export const modelPricingSchema = new Schema<IModelPricing>(
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

    // Model capabilities (for UI filtering)
    displayName: { type: String },
    contextLength: { type: Number },
    supportsVision: { type: Boolean, default: false },
    supportsToolCalling: { type: Boolean, default: false },
    supportsReasoning: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: "modelPricing",
  }
);
