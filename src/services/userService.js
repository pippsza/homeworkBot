const Settings = require("../models/Settings");

const DEFAULT_USERS = {
  superadmins: ["@pippsza"],
  students: ["@pippsza"],
};

async function getSettings() {
  let settings = await Settings.findOne({ key: "main" });
  if (!settings) {
    settings = await Settings.create({ key: "main", ...DEFAULT_USERS });
  }
  return settings;
}

// --- Role checks ---

async function isStudent(username) {
  const s = await getSettings();
  return (
    (s.students || []).includes(username) ||
    (s.superadmins || []).includes(username)
  );
}

async function isSuperadmin(username) {
  const s = await getSettings();
  return (s.superadmins || []).includes(username);
}

// --- User management ---

async function addUser(role, username) {
  if (!["students", "superadmins"].includes(role)) return false;
  const s = await getSettings();
  if (!s[role]) s[role] = [];
  if (s[role].includes(username)) return false;
  s[role].push(username);
  await s.save();
  return true;
}

async function removeUser(role, username) {
  if (!["students", "superadmins"].includes(role)) return false;
  const s = await getSettings();
  if (!s[role]) return false;
  const idx = s[role].indexOf(username);
  if (idx === -1) return false;
  s[role].splice(idx, 1);
  await s.save();
  return true;
}

async function getAllUsers() {
  const s = await getSettings();
  return [...new Set([...(s.students || []), ...(s.superadmins || [])])];
}

// --- Model config (new multi-provider) ---

async function getModelConfig() {
  const s = await getSettings();
  return s.modelConfig || {};
}

async function updateModelConfig(role, config) {
  const { MODEL_ROLES } = require("../config/aiModels");
  if (!MODEL_ROLES[role]) return false;

  const s = await getSettings();
  if (!s.modelConfig) s.modelConfig = {};
  s.modelConfig[role] = config;
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

async function getModelSettings() {
  const s = await getSettings();
  const m = s.models?.toObject?.() || s.models || {};
  return {
    chat: m.chat || null,
    orchestrator: m.orchestrator || null,
    autoSolve: m.autoSolve || null,
  };
}

async function updateModelSetting(task, modelId) {
  const s = await getSettings();
  if (!s.models) s.models = {};
  s.models[task] = modelId;
  s.markModified("models");
  await s.save();
  return true;
}

// --- Migration ---

async function migrateRoles() {
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

async function migrateModelsToModelConfig() {
  const s = await getSettings();

  // Skip if already has modelConfig
  if (s.modelConfig && Object.keys(s.modelConfig).length > 0) return false;

  const oldModels = s.models?.toObject?.() || s.models || {};
  if (!oldModels.chat && !oldModels.autoSolve) return false;

  console.log("[migrate] Migrating model settings to modelConfig");

  const newConfig = {};
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

module.exports = {
  getSettings,
  isStudent,
  isSuperadmin,
  addUser,
  removeUser,
  getAllUsers,
  getModelConfig,
  updateModelConfig,
  getModelSettings,
  updateModelSetting,
  migrateRoles,
  migrateModelsToModelConfig,
};
