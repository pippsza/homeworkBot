const mongoose = require("mongoose");

const knowledgeDocumentSchema = new mongoose.Schema(
  {
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
    },
    filename: { type: String, required: true },
    mimetype: { type: String, default: "" },
    chunkCount: { type: Number, default: 0 },
    uploadedBy: { type: Number }, // telegram userId
  },
  { timestamps: true }
);

knowledgeDocumentSchema.index({ subjectId: 1 });

module.exports = mongoose.model("KnowledgeDocument", knowledgeDocumentSchema);
