const { createGoogleGenerativeAI } = require("@ai-sdk/google");
const { resolveModels, getChatModels, getSolveModels } = require("./modelResolverService");

/**
 * Create a LanguageModel for a specific AI role.
 * New code should use this.
 */
async function createModelForRole(role) {
  const { primary } = await resolveModels(role);
  return primary;
}

/**
 * Legacy compat: createModelForTask maps old task names → new roles.
 */
async function createModelForTask(task) {
  const taskToRole = {
    chat: "chat",
    orchestrator: "chat",
    autoSolve: "solveText",
  };
  const role = taskToRole[task] || "chat";
  return createModelForRole(role);
}

/**
 * Legacy compat: "flash" → chat, "pro" → solveTextPro
 */
async function createModel(type = "flash") {
  if (type === "pro") return createModelForRole("solveTextPro");
  return createModelForRole("chat");
}

module.exports = { createModel, createModelForTask, createModelForRole };
