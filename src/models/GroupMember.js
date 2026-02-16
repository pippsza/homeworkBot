const mongoose = require("mongoose");

const groupMemberSchema = new mongoose.Schema({
  chatId: { type: Number, required: true },
  userId: { type: Number, required: true },
  firstName: { type: String, default: "" },
  username: { type: String, default: "" },
  lastSeen: { type: Date, default: Date.now },
});

groupMemberSchema.index({ chatId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("GroupMember", groupMemberSchema);
