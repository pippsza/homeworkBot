const mongoose = require("mongoose");

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

module.exports = mongoose.model("Schedule", scheduleSchema);
