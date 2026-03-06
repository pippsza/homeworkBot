import { Schema, Document } from "mongoose";

export interface IUser extends Document {
  userId: string;
  projectId: string;
  email?: string;
  name?: string;
  role?: string;
  avatarUrl?: string;
  meta: Record<string, unknown>;
  lastActivityAt?: Date;
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
  isActive: boolean;
}

export const userSchema = new Schema<IUser>(
  {
    userId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },

    // Human-readable fields
    email: String,
    name: String,
    role: String,
    avatarUrl: String,

    // Arbitrary meta from project
    meta: { type: Schema.Types.Mixed, default: {} },

    // Stats (updated by UsageHub aggregation)
    lastActivityAt: Date,
    totalRequests: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    totalCostUsd: { type: Number, default: 0 },

    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: "users",
  }
);

// One user can be in multiple projects
userSchema.index({ userId: 1, projectId: 1 }, { unique: true });
userSchema.index({ email: 1 });
