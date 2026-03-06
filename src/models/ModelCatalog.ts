import mongoose, { Document } from "mongoose";

export interface IModelCatalog extends Document {
  provider: "google" | "openrouter";
  modelId: string;
  displayName: string;
  inputPrice: number;
  outputPrice: number;
  contextLength: number;
  supportsVision: boolean;
  supportsToolCalling: boolean;
  supportsReasoning: boolean;
  isFree: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const modelCatalogSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: true,
      enum: ["google", "openrouter"],
    },
    modelId: { type: String, required: true },
    displayName: { type: String, required: true },
    inputPrice: { type: Number, default: 0 },
    outputPrice: { type: Number, default: 0 },
    contextLength: { type: Number, default: 0 },
    supportsVision: { type: Boolean, default: false },
    supportsToolCalling: { type: Boolean, default: false },
    supportsReasoning: { type: Boolean, default: false },
    isFree: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

modelCatalogSchema.index({ provider: 1, modelId: 1 }, { unique: true });

export default mongoose.model<IModelCatalog>("ModelCatalog", modelCatalogSchema);
