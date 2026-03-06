const userService = require("../../services/userService");

function getUsername(ctx) {
  if (!ctx.from || !ctx.from.username) return null;
  return `@${ctx.from.username}`;
}

async function isStudent(ctx) {
  const u = getUsername(ctx);
  return u ? await userService.isStudent(u) : false;
}

async function isSuperadmin(ctx) {
  const u = getUsername(ctx);
  return u ? await userService.isSuperadmin(u) : false;
}

module.exports = { isStudent, isSuperadmin, getUsername };
