const startHandler = require("./handlers/start");
const subjectsHandler = require("./handlers/subjects");
const tasksHandler = require("./handlers/tasks");
const infosHandler = require("./handlers/infos");
const settingsHandler = require("./handlers/settings");
const toolsHandler = require("./handlers/tools");
const textHandler = require("./handlers/text");
const mediaHandler = require("./handlers/media");
const groupMemberService = require("../services/groupMemberService");

function setupBot(bot) {
  // Track group members on every interaction
  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== "private" && ctx.from) {
      groupMemberService.track(ctx.chat.id, ctx.from).catch(() => {});
    }
    return next();
  });

  startHandler(bot);
  subjectsHandler(bot);
  tasksHandler(bot);
  infosHandler(bot);
  settingsHandler(bot);
  toolsHandler(bot);
  textHandler(bot);
  mediaHandler(bot);
}

module.exports = setupBot;
