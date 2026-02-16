const mongoose = require("mongoose");

const chatMessagesSchema = new mongoose.Schema(
  {
    chatId: { type: String, unique: true, required: true },
    messageIds: [{ type: Number }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("ChatMessages", chatMessagesSchema);
