import mongoose, { Document } from "mongoose";

export interface ISubjectAttachment {
  type: "document" | "photo";
  file_id: string;
}

export interface IAnswer {
  type: "text" | "photo" | "document";
  content: string;
  file_id: string;
}

export interface ISubmission {
  username: string;
  submitted: boolean;
}

export interface IAiAnswerFile {
  format: "latex";
  content: string;
  filename: string;
}

export interface ITask extends Document {
  title: string;
  emoji: string;
  description: string;
  attachments: ISubjectAttachment[];
  answers: IAnswer[];
  aiAnswer: string;
  aiAnswerFiles: IAiAnswerFile[];
  autoSolve: boolean;
  deadline: Date | null;
  order: number;
  fullWidth: boolean;
  submissions: ISubmission[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ISubject extends Document {
  name: string;
  emoji: string;
  lecturerName: string;
  lecturerContact: string;
  lecturerNote: string;
  practitionerName: string;
  practitionerContact: string;
  practitionerNote: string;
  notes: string;
  autoPass: string;
  telegramChat: string;
  classroomUrl: string;
  teamsLink: string;
  matchKeys: string[];
  grading: { label: string; points: number }[];
  tasks: mongoose.Types.DocumentArray<ITask>;
  order: number;
  buttonColumns: number;
  createdAt: Date;
  updatedAt: Date;
}

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

    // Розкладка кнопки завдання: порядок у сітці і чи займає весь рядок
    order: { type: Number, default: 0 },
    fullWidth: { type: Boolean, default: false },
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
    lecturerNote: { type: String, default: "" },
    practitionerName: { type: String, default: "" },
    practitionerContact: { type: String, default: "" },
    practitionerNote: { type: String, default: "" },
    notes: { type: String, default: "" },
    autoPass: { type: String, default: "" },
    telegramChat: { type: String, default: "" },
    classroomUrl: { type: String, default: "" },
    teamsLink: { type: String, default: "" },

    // Явні уривки назви з календаря: у розкладі багато схожих назв
    // («системи», «безпеки»), і пошук по словах плутає предмети.
    matchKeys: [{ type: String }],

    // З чого складаються 100 балів: малюємо шкалою на картці предмета
    grading: [{ label: { type: String }, points: { type: Number } }],
    tasks: [taskSchema],
    order: { type: Number, default: 0 },

    // Скільки кнопок завдань в рядок
    buttonColumns: { type: Number, default: 0, min: 0, max: 4 },
  },
  { timestamps: true }
);

export default mongoose.model<ISubject>("Subject", subjectSchema);
