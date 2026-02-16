const GroupMember = require("../models/GroupMember");

module.exports = {
  async track(chatId, user) {
    if (!chatId || !user?.id) return;
    await GroupMember.findOneAndUpdate(
      { chatId, userId: user.id },
      {
        firstName: user.first_name || "",
        username: user.username || "",
        lastSeen: new Date(),
      },
      { upsert: true, returnDocument: "after" }
    );
  },

  async getMembers(chatId) {
    return GroupMember.find({ chatId }).sort({ lastSeen: -1 });
  },
};
