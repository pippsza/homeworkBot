const Settings = require("../models/Settings");
const { AI_MODELS, MODEL_TASKS } = require("../config/aiModels");

const DEFAULT_USERS = {
  admins: ["@pippsza"],
  reviewers: ["@pippsza"],
  superusers: ["@pippsza"],
};

async function getSettings() {
  let settings = await Settings.findOne({ key: "main" });
  if (!settings) {
    settings = await Settings.create({ key: "main", ...DEFAULT_USERS });
  }
  return settings;
}

module.exports = {
  getSettings,

  async isAdmin(username) {
    const s = await getSettings();
    return (
      s.admins.includes(username) || s.superusers.includes(username)
    );
  },

  async isReviewer(username) {
    const s = await getSettings();
    return (
      s.reviewers.includes(username) || s.superusers.includes(username)
    );
  },

  async isSuperuser(username) {
    const s = await getSettings();
    return s.superusers.includes(username);
  },

  async addUser(role, username) {
    const s = await getSettings();
    if (s[role].includes(username)) return false;
    s[role].push(username);
    await s.save();
    return true;
  },

  async removeUser(role, username) {
    const s = await getSettings();
    const idx = s[role].indexOf(username);
    if (idx === -1) return false;
    s[role].splice(idx, 1);
    await s.save();
    return true;
  },

  async getAllUsers() {
    const s = await getSettings();
    return [...new Set([...s.admins, ...s.reviewers, ...s.superusers])];
  },

  async getModelSettings() {
    const s = await getSettings();
    const defaults = {};
    for (const [task, cfg] of Object.entries(MODEL_TASKS)) {
      defaults[task] = cfg.default;
    }
    return { ...defaults, ...s.models?.toObject?.() || s.models || {} };
  },

  async updateModelSetting(task, modelId) {
    if (!MODEL_TASKS[task]) return false;
    if (!AI_MODELS[modelId]) return false;
    const s = await getSettings();
    if (!s.models) s.models = {};
    s.models[task] = modelId;
    s.markModified("models");
    await s.save();
    return true;
  },
};
