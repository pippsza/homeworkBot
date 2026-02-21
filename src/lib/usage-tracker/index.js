// Usage Tracker SDK — public API
// Copy this folder to any project for token usage tracking.

const { createUsageTracker } = require("./tracker");
const { createTrackedAI } = require("./tool");
const { calculateCost, FALLBACK_PRICING } = require("./pricing");
const { registerProject, syncUser } = require("./registry");
const {
  getUsageConnection,
  getTokenUsageEventModel,
  getModelPricingModel,
  getProjectModel,
  getUserModel,
  closeConnection,
} = require("./connection");

module.exports = {
  // Core
  createUsageTracker,
  createTrackedAI,

  // Pricing
  calculateCost,
  FALLBACK_PRICING,

  // Registry
  registerProject,
  syncUser,

  // Connection & Models (for advanced use)
  getUsageConnection,
  getTokenUsageEventModel,
  getModelPricingModel,
  getProjectModel,
  getUserModel,
  closeConnection,
};
