import { Telegraf } from "telegraf";
import startHandler from "./handlers/start";
import subjectsHandler from "./handlers/subjects";
import tasksHandler from "./handlers/tasks";
import infosHandler from "./handlers/infos";
import settingsHandler from "./handlers/settings";
import toolsHandler from "./handlers/tools";
import { aiHandler } from "./handlers/ai";
import { setupHomeworkHandler } from "./handlers/homework";
import { textHandler } from "./handlers/text";
import { mediaHandler } from "./handlers/media";
import scheduleHandler from "./handlers/schedule";
import * as groupMemberService from "../services/groupMemberService";

export function setupBot(bot: Telegraf): void {
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
  aiHandler(bot);
  setupHomeworkHandler(bot);
  scheduleHandler(bot);
  textHandler(bot);
  mediaHandler(bot);
}
