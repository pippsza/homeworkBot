import mongoose, { Connection, Model } from "mongoose";
import { tokenUsageEventSchema, ITokenUsageEvent } from "./schemas/token-usage-event";
import { modelPricingSchema, IModelPricing } from "./schemas/model-pricing";
import { projectSchema, IProject } from "./schemas/project";
import { userSchema, IUser } from "./schemas/user";

let connection: Connection | null = null;

export function getUsageConnection(): Connection {
  if (!connection) {
    const uri = process.env.USAGE_DATABASE_URI;
    if (!uri) throw new Error("[UsageTracker] USAGE_DATABASE_URI is not set");

    connection = mongoose.createConnection(uri);

    connection.on("error", (err: Error) => {
      console.error("[UsageTracker] MongoDB connection error:", err.message);
    });

    connection.on("connected", () => {
      console.log("[UsageTracker] Connected to usage_tracking DB");
    });
  }
  return connection;
}

export function getTokenUsageEventModel(): Model<ITokenUsageEvent> {
  const conn = getUsageConnection();
  return conn.models.TokenUsageEvent || conn.model<ITokenUsageEvent>("TokenUsageEvent", tokenUsageEventSchema);
}

export function getModelPricingModel(): Model<IModelPricing> {
  const conn = getUsageConnection();
  return conn.models.ModelPricing || conn.model<IModelPricing>("ModelPricing", modelPricingSchema);
}

export function getProjectModel(): Model<IProject> {
  const conn = getUsageConnection();
  return conn.models.Project || conn.model<IProject>("Project", projectSchema);
}

export function getUserModel(): Model<IUser> {
  const conn = getUsageConnection();
  return conn.models.User || conn.model<IUser>("User", userSchema);
}

/**
 * Close the usage tracking connection gracefully.
 */
export async function closeConnection(): Promise<void> {
  if (connection) {
    await connection.close();
    connection = null;
  }
}
