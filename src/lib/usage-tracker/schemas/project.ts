import { Schema, Document } from "mongoose";

export interface IProject extends Document {
  projectId: string;
  name: string;
  description?: string;
  url?: string;
  environment?: "production" | "staging" | "development";
  techStack?: string;
  team?: string;
  contactEmail?: string;
  lastActivityAt?: Date;
  totalRequestsAllTime: number;
  totalCostAllTimeUsd: number;
  isActive: boolean;
}

export const projectSchema = new Schema<IProject>(
  {
    projectId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: String,
    url: String,
    environment: {
      type: String,
      enum: ["production", "staging", "development"],
    },
    techStack: String,
    team: String,
    contactEmail: String,

    // Stats (updated by UsageHub aggregation)
    lastActivityAt: Date,
    totalRequestsAllTime: { type: Number, default: 0 },
    totalCostAllTimeUsd: { type: Number, default: 0 },

    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: "projects",
  }
);
