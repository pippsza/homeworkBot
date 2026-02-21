const mongoose = require("mongoose");

const modelCatalogSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: true,
      enum: ["google", "openrouter"],
    },
    modelId: { type: String, required: true },
    displayName: { type: String, required: true },
    inputPrice: { type: Number, default: 0 },  // $/1M tokens
    outputPrice: { type: Number, default: 0 }, // $/1M tokens
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

module.exports = mongoose.model("ModelCatalog", modelCatalogSchema);
