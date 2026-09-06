import { Telegraf, Context, Markup } from "telegraf";
import { isSuperadmin } from "../middleware/auth";
import { editOrSend, trackSend, isPrivate } from "../helpers/editOrSend";
import * as inputState from "../helpers/inputState";

const replyKeyboard = Markup.keyboard([["🏠 Главное меню"]])
  .resize()
  .persistent();

async function mainMenu(ctx: Context): Promise<void> {
  const buttons = [
    [
      Markup.button.callback("📚 Предмети", "subjects"),
      Markup.button.callback("📅 Розклад", "sch"),
    ],
    [
      Markup.button.callback("⏳ Дедлайни", "deadlines_img"),
      Markup.button.callback("ℹ️ Інформація", "infos"),
    ],
  ];
  if (await isSuperadmin(ctx)) {
    buttons.push([
      Markup.button.callback("⚙️ Настройки", "settings"),
      Markup.button.callback("🛠 Инструменты", "tools"),
    ]);
  }
  if (isPrivate(ctx) && process.env.WEBAPP_URL) {
    buttons.push([
      Markup.button.webApp("📱 Открыть приложение", process.env.WEBAPP_URL) as any,
    ]);
  }
  try {
    await editOrSend(
      ctx,
      "🏠 Главное меню\n\nВыберите опцию ниже:",
      Markup.inlineKeyboard(buttons) as any
    );
  } catch (e) {
    console.error("[mainMenu error]", e);
  }
}

function startHandler(bot: Telegraf): void {
  bot.start(async (ctx: Context) => {
    try {
      inputState.delete(ctx.from!.id);
      await mainMenu(ctx);
    } catch (e) {
      console.error("[start error]", e);
    }
  });

  bot.action("main_menu", async (ctx: Context) => {
    try {
      await mainMenu(ctx);
    } catch (e) {
      console.error("[main_menu error]", e);
    }
  });
}

export default startHandler;
export { mainMenu, replyKeyboard };
