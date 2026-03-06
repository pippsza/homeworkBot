import mongoose, { Document } from "mongoose";

export interface ISettingsModels {
  chat?: string;
  orchestrator?: string;
  autoSolve?: string;
  [key: string]: string | undefined;
}

export interface ISettings extends Document {
  key: string;
  students: string[];
  superadmins: string[];
  admins: string[];
  reviewers: string[];
  superusers: string[];
  models: ISettingsModels;
  modelConfig: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: "main" },

    // New role system
    students: [{ type: String }],
    superadmins: [{ type: String }],

    // Legacy role fields (kept for migration, will be removed after migration runs)
    admins: [{ type: String }],
    reviewers: [{ type: String }],
    superusers: [{ type: String }],

    // Legacy AI model config (simple strings)
    models: {
      chat: { type: String },
      orchestrator: { type: String },
      autoSolve: { type: String },
    },

    // New AI model config: role -> { modelId, provider, fallbackModelId?, fallbackProvider? }
    modelConfig: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

export default mongoose.model<ISettings>("Settings", settingsSchema);
