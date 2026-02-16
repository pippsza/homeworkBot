const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: "main" },
    admins: [{ type: String }],
    answerViewers: [{ type: String }],
    superusers: [{ type: String }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Settings", settingsSchema);
