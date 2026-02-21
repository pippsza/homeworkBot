/**
 * Project-specific usage tracker initialization.
 * This file is NOT copied between projects — it's unique per project.
 */
const { createUsageTracker, createTrackedAI, closeConnection } = require("./usage-tracker");

const PROJECT_ID = process.env.PROJECT_ID || "homework-bot";
const ENVIRONMENT = process.env.NODE_ENV === "production" ? "production" : "development";

// Check if tracking is enabled (USAGE_DATABASE_URI must be set)
const isEnabled = !!process.env.USAGE_DATABASE_URI;

let usageTracker = null;
let ai = null;

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

  ai = createTrackedAI(usageTracker);
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
    async generateObject(fn) {
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
function startTracking() {
  if (isEnabled) {
    usageTracker.start();
  }
}

/**
 * Graceful shutdown: flush events and close connection.
 */
async function stopTracking() {
  if (isEnabled) {
    await usageTracker.shutdown();
    await closeConnection();
  }
}

module.exports = { usageTracker, ai, startTracking, stopTracking, isEnabled };
