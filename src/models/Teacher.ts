import mongoose, { Document } from "mongoose";

/**
 * Викладач окремим записом: один викладач часто веде кілька предметів, і
 * тримати його ПІБ рядком у кожному предметі означає правити в кількох
 * місцях. Предмет посилається сюди, а старі рядкові поля лишаються як запас.
 */
export interface ITeacher extends Document {
  name: string;
  /** Коротке ім'я на кнопку: повне ПІБ туди не влазить. */
  short: string;
  contact: string;
  chair: string;
  /** Що знаємо про викладача: вимоги, характер, як приймає роботи. */
  note: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new mongoose.Schema<ITeacher>(
  {
    name: { type: String, required: true },
    short: { type: String, default: "" },
    contact: { type: String, default: "" },
    chair: { type: String, default: "" },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model<ITeacher>("Teacher", schema);
