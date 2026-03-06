/**
 * Project-specific usage tracker initialization.
 * This file is NOT copied between projects — it's unique per project.
 */
import { createUsageTracker, createTrackedAI, closeConnection, UsageTracker, TrackedAI } from "./usage-tracker";

const PROJECT_ID = process.env.PROJECT_ID || "homework-bot";
const ENVIRONMENT = process.env.NODE_ENV === "production" ? "production" : "development";

// Check if tracking is enabled (USAGE_DATABASE_URI must be set)
const isEnabled = !!process.env.USAGE_DATABASE_URI;

interface NoOpTracker {
  start(): void;
  record(): void;
  flush(): void;
  shutdown(): Promise<void>;
}

interface NoOpAI {
  generateObject<T>(fn: () => Promise<T>): Promise<T>;
  onStreamFinish(): () => void;
}

let usageTracker: UsageTracker | NoOpTracker;
let ai: TrackedAI | NoOpAI;

if (isEnabled) {
  usageTracker = createUsageTracker({
    projectId: PROJECT_ID,
    environment: ENVIRONMENT,
    project: {
      name: "HomeworkBot",
      description: "Telegram homework bot with AI features",
      techStack: "Node.js, Telegraf v4, Express v5, Mongoose",
    },
    buffer: {
      maxSize: 50,
      flushIntervalMs: 5_000,
    },
  });

  ai = createTrackedAI(usageTracker as UsageTracker);
} else {
  // No-op tracker when USAGE_DATABASE_URI is not set
  usageTracker = {
    start() {},
    record() {},
    flush() {},
    async shutdown() {},
  };

  // No-op AI wrapper — just pass-through
  ai = {
    async generateObject<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    },
    onStreamFinish() {
      return () => {};
    },
  };
}

/**
 * Start the tracker. Call after MongoDB connections are ready.
 */
export function startTracking(): void {
  if (isEnabled) {
    usageTracker.start();
  }
}

/**
 * Graceful shutdown: flush events and close connection.
 */
export async function stopTracking(): Promise<void> {
  if (isEnabled) {
    await usageTracker.shutdown();
    await closeConnection();
  }
}

export { usageTracker, ai, isEnabled };
