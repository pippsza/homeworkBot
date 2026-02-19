const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: "main" },
    admins: [{ type: String }],
    reviewers: [{ type: String }],
    superusers: [{ type: String }],
    models: {
      chat: { type: String, default: "gemini-2.5-flash-lite" },
      orchestrator: { type: String, default: "gemini-2.5-flash-lite" },
      autoSolve: { type: String, default: "gemini-2.5-flash" },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Settings", settingsSchema);
