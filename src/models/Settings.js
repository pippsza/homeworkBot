const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: "main" },

    // New role system
    students: [{ type: String }],
    superadmins: [{ type: String }],

    // Legacy role fields (kept for migration, will be removed after migration runs)
    admins: [{ type: String }],
    reviewers: [{ type: String }],
    superusers: [{ type: String }],

    // Legacy AI model config (simple strings)
    models: {
      chat: { type: String },
      orchestrator: { type: String },
      autoSolve: { type: String },
    },

    // New AI model config: role -> { modelId, provider, fallbackModelId?, fallbackProvider? }
    modelConfig: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Settings", settingsSchema);
