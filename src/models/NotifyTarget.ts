import mongoose, { Document } from "mongoose";

/**
 * Куди бот пише. Один запис на чат, прапорці вмикають окремі види розсилки.
 * Керується з меню налаштувань, тому chatId зберігаємо рядком:
 * у груп він від'ємний і довший за 32 біти.
 */
export interface INotifyTarget extends Document {
  chatId: string;
  title: string;
  enabled: boolean;
  daily: boolean;
  lessons: boolean;
  deadlines: boolean;
  weekly: boolean;
}

const schema = new mongoose.Schema<INotifyTarget>(
  {
    chatId: { type: String, required: true, unique: true },
    title: { type: String, default: "" },
    enabled: { type: Boolean, default: true },
    daily: { type: Boolean, default: true },
    lessons: { type: Boolean, default: false },
    deadlines: { type: Boolean, default: true },
    weekly: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model<INotifyTarget>("NotifyTarget", schema);
