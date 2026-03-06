import mongoose, { Document } from "mongoose";

export interface IChatMessages extends Document {
  chatId: string;
  messageIds: number[];
  createdAt: Date;
  updatedAt: Date;
}

const chatMessagesSchema = new mongoose.Schema(
  {
    chatId: { type: String, unique: true, required: true },
    messageIds: [{ type: Number }],
  },
  { timestamps: true }
);

export default mongoose.model<IChatMessages>("ChatMessages", chatMessagesSchema);
