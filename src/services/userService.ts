import Settings, { ISettings, ISettingsModels } from "../models/Settings";

const DEFAULT_USERS = {
  superadmins: ["@pippsza"],
  students: ["@pippsza"],
};

export async function getSettings(): Promise<ISettings> {
  let settings = await Settings.findOne({ key: "main" });
  if (!settings) {
    settings = await Settings.create({ key: "main", ...DEFAULT_USERS });
  }
  return settings;
}

// --- Role checks ---

export async function isStudent(username: string): Promise<boolean> {
  const s = await getSettings();
  return (
    (s.students || []).includes(username) ||
    (s.superadmins || []).includes(username)
  );
}

export async function isSuperadmin(username: string): Promise<boolean> {
  const s = await getSettings();
  return (s.superadmins || []).includes(username);
}

// --- User management ---

export async function addUser(role: string, username: string): Promise<boolean> {
  if (!["students", "superadmins"].includes(role)) return false;
  const s = await getSettings() as any;
  if (!s[role]) s[role] = [];
  if (s[role].includes(username)) return false;
  s[role].push(username);
  await s.save();
  return true;
}

export async function removeUser(role: string, username: string): Promise<boolean> {
  if (!["students", "superadmins"].includes(role)) return false;
  const s = await getSettings() as any;
  if (!s[role]) return false;
  const idx = s[role].indexOf(username);
  if (idx === -1) return false;
  s[role].splice(idx, 1);
  await s.save();
  return true;
}

export async function getAllUsers(): Promise<string[]> {
  const s = await getSettings();
  return [...new Set([...(s.students || []), ...(s.superadmins || [])])];
}

// --- Model config (new multi-provider) ---

export async function getModelConfig(): Promise<Record<string, unknown>> {
  const s = await getSettings();
  return s.modelConfig || {};
}

export async function updateModelConfig(role: string, config: Record<string, unknown>): Promise<boolean> {
  const { MODEL_ROLES } = require("../config/aiModels");
  if (!MODEL_ROLES[role]) return false;

  const s = await getSettings();
  if (!s.modelConfig) s.modelConfig = {};
  (s.modelConfig as Record<string, unknown>)[role] = config;
  s.markModified("modelConfig");
  await s.save();

  // Invalidate resolver cache
  try {
    const { invalidateModelCache } = require("./modelResolverService");
    invalidateModelCache();
  } catch {
    // modelResolverService may not exist yet during Phase 1
  }

  return true;
}

// --- Legacy model settings (used by old AI model menu, will be replaced in Phase 3) ---

export async function getModelSettings(): Promise<ISettingsModels> {
  const s = await getSettings();
  const m = (s.models as any)?.toObject?.() || s.models || {};
  return {
    chat: m.chat || null,
    orchestrator: m.orchestrator || null,
    autoSolve: m.autoSolve || null,
  };
}

export async function updateModelSetting(task: string, modelId: string): Promise<boolean> {
  const s = await getSettings();
  if (!s.models) (s as any).models = {};
  (s.models as any)[task] = modelId;
  s.markModified("models");
  await s.save();
  return true;
}

// --- Migration ---

export async function migrateRoles(): Promise<boolean> {
  const s = await getSettings();

  // Skip if already migrated (new fields populated, old fields empty)
  if (
    (s.superadmins?.length || s.students?.length) &&
    !s.admins?.length &&
    !s.reviewers?.length &&
    !s.superusers?.length
  ) {
    return false;
  }

  // Skip if no old data
  if (!s.admins?.length && !s.reviewers?.length && !s.superusers?.length) {
    return false;
  }

  console.log("[migrate] Migrating roles: admins/reviewers/superusers → students/superadmins");

  // Merge: admins + superusers → superadmins
  const newSuperadmins = [...new Set([
    ...(s.superadmins || []),
    ...(s.admins || []),
    ...(s.superusers || []),
  ])];

  // Merge: reviewers → students (+ superadmins get student access automatically)
  const newStudents = [...new Set([
    ...(s.students || []),
    ...(s.reviewers || []),
  ])];

  s.superadmins = newSuperadmins;
  s.students = newStudents;

  // Clear old fields
  s.admins = [];
  s.reviewers = [];
  s.superusers = [];

  await s.save();
  console.log(`[migrate] Done: ${newSuperadmins.length} superadmins, ${newStudents.length} students`);
  return true;
}

export async function migrateModelsToModelConfig(): Promise<boolean> {
  const s = await getSettings();

  // Skip if already has modelConfig
  if (s.modelConfig && Object.keys(s.modelConfig).length > 0) return false;

  const oldModels = (s.models as any)?.toObject?.() || s.models || {};
  if (!oldModels.chat && !oldModels.autoSolve) return false;

  console.log("[migrate] Migrating model settings to modelConfig");

  const newConfig: Record<string, { modelId: string; provider: string }> = {};
  if (oldModels.chat) {
    newConfig.chat = { modelId: oldModels.chat, provider: "google" };
  }
  if (oldModels.autoSolve) {
    newConfig.solveText = { modelId: oldModels.autoSolve, provider: "google" };
    newConfig.solveImage = { modelId: oldModels.autoSolve, provider: "google" };
  }

  s.modelConfig = newConfig;
  s.markModified("modelConfig");
  await s.save();
  console.log("[migrate] Model config migrated:", Object.keys(newConfig).join(", "));
  return true;
}
