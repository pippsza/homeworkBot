import mongoose, { Document } from "mongoose";

export interface IKnowledgeDocument extends Document {
  subjectId: mongoose.Types.ObjectId;
  filename: string;
  mimetype: string;
  chunkCount: number;
  uploadedBy?: number;
  createdAt: Date;
  updatedAt: Date;
}

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
    uploadedBy: { type: Number },
  },
  { timestamps: true }
);

knowledgeDocumentSchema.index({ subjectId: 1 });

export default mongoose.model<IKnowledgeDocument>("KnowledgeDocument", knowledgeDocumentSchema);
