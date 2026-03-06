import mongoose, { Document } from "mongoose";

export interface IChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}

export interface IChatHistory extends Document {
  telegramUserId: number;
  messages: IChatHistoryMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ["user", "assistant"], required: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const chatHistorySchema = new mongoose.Schema(
  {
    telegramUserId: { type: Number, required: true, unique: true },
    messages: [messageSchema],
  },
  { timestamps: true }
);

export default mongoose.model<IChatHistory>("ChatHistory", chatHistorySchema);
