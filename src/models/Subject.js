const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["document", "photo"], required: true },
    file_id: { type: String, required: true },
  },
  { _id: true }
);

const answerSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["text", "photo", "document"], required: true },
    content: { type: String, default: "" },
    file_id: { type: String, default: "" },
  },
  { _id: true }
);

const submissionSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    submitted: { type: Boolean, default: false },
  },
  { _id: false }
);

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    emoji: { type: String, default: "📄" },
    description: { type: String, default: "" },
    attachments: [attachmentSchema],
    answers: [answerSchema],
    aiAnswer: { type: String, default: "" },
    aiAnswerFiles: [{
      format: { type: String, enum: ["latex"] },
      content: String,
      filename: String,
    }],
    autoSolve: { type: Boolean, default: false },
    deadline: { type: Date, default: null },
    submissions: [submissionSchema],
  },
  { _id: true, timestamps: true }
);

const subjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    emoji: { type: String, default: "📚" },
    lecturerName: { type: String, default: "" },
    lecturerContact: { type: String, default: "" },
    practitionerName: { type: String, default: "" },
    practitionerContact: { type: String, default: "" },
    tasks: [taskSchema],
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Subject", subjectSchema);
