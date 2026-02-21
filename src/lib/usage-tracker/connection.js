const mongoose = require("mongoose");
const { tokenUsageEventSchema } = require("./schemas/token-usage-event");
const { modelPricingSchema } = require("./schemas/model-pricing");
const { projectSchema } = require("./schemas/project");
const { userSchema } = require("./schemas/user");

let connection = null;

function getUsageConnection() {
  if (!connection) {
    const uri = process.env.USAGE_DATABASE_URI;
    if (!uri) throw new Error("[UsageTracker] USAGE_DATABASE_URI is not set");

    connection = mongoose.createConnection(uri);

    connection.on("error", (err) => {
      console.error("[UsageTracker] MongoDB connection error:", err.message);
    });

    connection.on("connected", () => {
      console.log("[UsageTracker] Connected to usage_tracking DB");
    });
  }
  return connection;
}

function getTokenUsageEventModel() {
  const conn = getUsageConnection();
  return conn.models.TokenUsageEvent || conn.model("TokenUsageEvent", tokenUsageEventSchema);
}

function getModelPricingModel() {
  const conn = getUsageConnection();
  return conn.models.ModelPricing || conn.model("ModelPricing", modelPricingSchema);
}

function getProjectModel() {
  const conn = getUsageConnection();
  return conn.models.Project || conn.model("Project", projectSchema);
}

function getUserModel() {
  const conn = getUsageConnection();
  return conn.models.User || conn.model("User", userSchema);
}

/**
 * Close the usage tracking connection gracefully.
 */
async function closeConnection() {
  if (connection) {
    await connection.close();
    connection = null;
  }
}

module.exports = {
  getUsageConnection,
  getTokenUsageEventModel,
  getModelPricingModel,
  getProjectModel,
  getUserModel,
  closeConnection,
};
