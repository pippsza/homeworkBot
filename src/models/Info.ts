import mongoose, { Document } from "mongoose";

export interface IInfoAttachment {
  type: "document" | "photo";
  file_id: string;
}

export interface IInfo extends Document {
  title: string;
  emoji: string;
  description: string;
  attachments: IInfoAttachment[];
  order: number;
  chunkCount: number;
  createdAt: Date;
  updatedAt: Date;
}

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
    chunkCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model<IInfo>("Info", infoSchema);
