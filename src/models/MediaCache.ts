import mongoose, { Document } from "mongoose";

/**
 * Кеш вивантажених у Telegram картинок: за ключем вмісту тримаємо file_id.
 * Повторний показ тієї ж картки не малює й не вивантажує її знову.
 * file_id належить конкретному боту, тому ключ починається з його id.
 */
export interface IMediaCache extends Document {
  key: string;
  fileId: string;
  usedAt: Date;
}

const schema = new mongoose.Schema<IMediaCache>(
  {
    key: { type: String, required: true, unique: true },
    fileId: { type: String, required: true },
    usedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model<IMediaCache>("MediaCache", schema);
