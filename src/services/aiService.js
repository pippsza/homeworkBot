const { createGoogleGenerativeAI } = require("@ai-sdk/google");
const userService = require("./userService");
const { MODEL_TASKS } = require("../config/aiModels");

function getGoogle() {
  return createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
}

async function createModelForTask(task) {
  const models = await userService.getModelSettings();
  const modelId = models[task] || MODEL_TASKS[task]?.default || "gemini-2.0-flash";
  return getGoogle()(modelId);
}

// Legacy compat: "flash" → chat, "pro" → autoSolve
async function createModel(type = "flash") {
  if (type === "pro") return createModelForTask("autoSolve");
  return createModelForTask("chat");
}

module.exports = { createModel, createModelForTask };
