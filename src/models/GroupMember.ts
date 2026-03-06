import mongoose, { Document } from "mongoose";

export interface IGroupMember extends Document {
  chatId: number;
  userId: number;
  firstName: string;
  username: string;
  lastSeen: Date;
}

const groupMemberSchema = new mongoose.Schema({
  chatId: { type: Number, required: true },
  userId: { type: Number, required: true },
  firstName: { type: String, default: "" },
  username: { type: String, default: "" },
  lastSeen: { type: Date, default: Date.now },
});

groupMemberSchema.index({ chatId: 1, userId: 1 }, { unique: true });

export default mongoose.model<IGroupMember>("GroupMember", groupMemberSchema);
