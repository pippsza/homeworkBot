const Info = require("../models/Info");
const { syncInfoChunks, deleteInfoChunks } = require("./infoChunkingService");

module.exports = {
  async getAll() {
    return Info.find().sort({ order: 1 });
  },

  async getById(id) {
    return Info.findById(id);
  },

  async create(data) {
    const count = await Info.countDocuments();
    const info = await Info.create({ ...data, order: count });
    // Chunk in background
    syncInfoChunks(info._id.toString()).catch((e) =>
      console.error("[infoService] chunking error on create:", e.message)
    );
    return info;
  },

  async update(id, data) {
    const info = await Info.findByIdAndUpdate(id, data, { returnDocument: "after" });
    if (info) {
      syncInfoChunks(id).catch((e) =>
        console.error("[infoService] chunking error on update:", e.message)
      );
    }
    return info;
  },

  async delete(id) {
    await deleteInfoChunks(id).catch((e) =>
      console.error("[infoService] chunk deletion error:", e.message)
    );
    return Info.findByIdAndDelete(id);
  },

  async setAttachments(id, attachments) {
    const info = await Info.findByIdAndUpdate(
      id,
      { attachments },
      { returnDocument: "after" }
    );
    if (info) {
      syncInfoChunks(id).catch((e) =>
        console.error("[infoService] chunking error on setAttachments:", e.message)
      );
    }
    return info;
  },
};
