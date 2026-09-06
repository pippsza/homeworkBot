import mongoose, { Document } from "mongoose";

export interface ITimeSlot {
  number: number;
  startTime: string;
  endTime: string;
}

export interface IDaySlot {
  slotNumber: number;
  subjectId: mongoose.Types.ObjectId | null;
  subjectIdEven: mongoose.Types.ObjectId | null;
  isAlternating: boolean;
  kind: string;
  kindEven: string;
  link: string;
}

export interface IDay {
  dayOfWeek: number;
  slots: IDaySlot[];
}

export interface ISaturdayMapping {
  weekNumber: number;
  followsDay: number;
}

export interface ISchedule extends Document {
  key: string;
  timeSlots: ITimeSlot[];
  days: IDay[];
  saturdayMappings: ISaturdayMapping[];
  semesterStartDate: Date | null;
  notificationChatId: string | null;
  notifyMinutesBefore: number;
  notificationsEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const timeSlotSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
  },
  { _id: false }
);

const daySlotSchema = new mongoose.Schema(
  {
    slotNumber: { type: Number, required: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: "Subject", default: null },
    subjectIdEven: { type: mongoose.Schema.Types.ObjectId, ref: "Subject", default: null },
    isAlternating: { type: Boolean, default: false },
    kind: { type: String, default: "" },
    kindEven: { type: String, default: "" },
    link: { type: String, default: "" },
  },
  { _id: false }
);

const daySchema = new mongoose.Schema(
  {
    dayOfWeek: { type: Number, required: true, min: 1, max: 5 },
    slots: [daySlotSchema],
  },
  { _id: false }
);

const saturdayMappingSchema = new mongoose.Schema(
  {
    weekNumber: { type: Number, required: true },
    followsDay: { type: Number, required: true, min: 1, max: 5 },
  },
  { _id: false }
);

const scheduleSchema = new mongoose.Schema(
  {
    key: { type: String, default: "main", unique: true },
    timeSlots: [timeSlotSchema],
    days: [daySchema],
    saturdayMappings: [saturdayMappingSchema],
    semesterStartDate: { type: Date, default: null },
    notificationChatId: { type: String, default: null },
    notifyMinutesBefore: { type: Number, default: 10 },
    notificationsEnabled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model<ISchedule>("Schedule", scheduleSchema);
