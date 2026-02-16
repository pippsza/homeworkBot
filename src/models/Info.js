const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["document", "photo"], required: true },
    file_id: { type: String, required: true },
  },
  { _id: true }
);

const infoSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    emoji: { type: String, default: "ℹ️" },
    description: { type: String, default: "" },
    attachments: [attachmentSchema],
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Info", infoSchema);
