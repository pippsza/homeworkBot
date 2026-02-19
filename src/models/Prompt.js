const mongoose = require("mongoose");

const promptSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, required: true },
    content: { type: String, required: true },
    description: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Prompt", promptSchema);
