const ChatMessages = require("../models/ChatMessages");

module.exports = {
  async trackMessage(chatId, messageId) {
    await ChatMessages.findOneAndUpdate(
      { chatId: String(chatId) },
      { $push: { messageIds: messageId } },
      { upsert: true }
    );
  },

  async getMessages(chatId) {
    const doc = await ChatMessages.findOne({ chatId: String(chatId) });
    return doc ? doc.messageIds : [];
  },

  async clearMessages(chatId) {
    await ChatMessages.findOneAndUpdate(
      { chatId: String(chatId) },
      { messageIds: [] }
    );
  },
};
