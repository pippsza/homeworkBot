import mongoose, { Document } from "mongoose";

export interface IReminder extends Document {
  chatId: string;
  userId: number;
  username: string;
  text: string;
  scheduledAt: Date;
  createdAt: Date;
  status: "pending" | "sent" | "cancelled";
}

const reminderSchema = new mongoose.Schema<IReminder>({
  chatId: { type: String, required: true },
  userId: { type: Number, required: true },
  username: { type: String, default: "" },
  text: { type: String, required: true },
  scheduledAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
  status: { type: String, enum: ["pending", "sent", "cancelled"], default: "pending" },
});

reminderSchema.index({ status: 1, scheduledAt: 1 });

export default mongoose.model<IReminder>("Reminder", reminderSchema);
