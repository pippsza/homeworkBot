const Settings = require("../models/Settings");

const DEFAULT_USERS = {
  admins: ["@pippsza"],
  answerViewers: ["@pippsza"],
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

  async isAnswerViewer(username) {
    const s = await getSettings();
    return (
      s.answerViewers.includes(username) || s.superusers.includes(username)
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
    return [...new Set([...s.admins, ...s.answerViewers, ...s.superusers])];
  },
};
