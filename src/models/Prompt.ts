import mongoose, { Document } from "mongoose";

export interface IPrompt extends Document {
  key: string;
  content: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

const promptSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, required: true },
    content: { type: String, required: true },
    description: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model<IPrompt>("Prompt", promptSchema);
