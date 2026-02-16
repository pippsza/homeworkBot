const Info = require("../models/Info");

module.exports = {
  async getAll() {
    return Info.find().sort({ order: 1 });
  },

  async getById(id) {
    return Info.findById(id);
  },

  async create(data) {
    const count = await Info.countDocuments();
    return Info.create({ ...data, order: count });
  },

  async update(id, data) {
    return Info.findByIdAndUpdate(id, data, { returnDocument: "after" });
  },

  async delete(id) {
    return Info.findByIdAndDelete(id);
  },

  async setAttachments(id, attachments) {
    return Info.findByIdAndUpdate(id, { attachments }, { returnDocument: "after" });
  },
};
