import { LanguageModel } from "ai";
import { resolveModels } from "./modelResolverService";

/**
 * Create a LanguageModel for a specific AI role.
 * New code should use this.
 */
async function createModelForRole(role: string): Promise<LanguageModel> {
  const { primary } = await resolveModels(role);
  return primary;
}

/**
 * Legacy compat: createModelForTask maps old task names -> new roles.
 */
async function createModelForTask(task: string): Promise<LanguageModel> {
  const taskToRole: Record<string, string> = {
    chat: "chat",
    orchestrator: "chat",
    autoSolve: "solveText",
  };
  const role = taskToRole[task] || "chat";
  return createModelForRole(role);
}

/**
 * Legacy compat: "flash" -> chat, "pro" -> solveTextPro
 */
async function createModel(type: string = "flash"): Promise<LanguageModel> {
  if (type === "pro") return createModelForRole("solveTextPro");
  return createModelForRole("chat");
}

export { createModel, createModelForTask, createModelForRole };
