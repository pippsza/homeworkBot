const userService = require("../../services/userService");

function getUsername(ctx) {
  return ctx.from ? `@${ctx.from.username}` : null;
}

async function isAdmin(ctx) {
  const u = getUsername(ctx);
  return u ? await userService.isAdmin(u) : false;
}

async function isAnswerViewer(ctx) {
  const u = getUsername(ctx);
  return u ? await userService.isAnswerViewer(u) : false;
}

async function isSuperuser(ctx) {
  const u = getUsername(ctx);
  return u ? await userService.isSuperuser(u) : false;
}

module.exports = { isAdmin, isAnswerViewer, isSuperuser, getUsername };
