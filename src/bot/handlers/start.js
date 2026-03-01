const { Markup } = require("telegraf");
const { isSuperadmin } = require("../middleware/auth");
const { editOrSend, trackSend, isPrivate } = require("../helpers/editOrSend");
const inputState = require("../helpers/inputState");

const replyKeyboard = Markup.keyboard([["🏠 Главное меню"]])
  .resize()
  .persistent();

async function mainMenu(ctx) {
  const buttons = [
    [Markup.button.callback("📚 Предметы", "subjects")],
    [Markup.button.callback("ℹ️ Информация", "infos")],
    [Markup.button.callback("📅 Расписание", "sch")],
  ];
  if (await isSuperadmin(ctx)) {
    buttons.push([
      Markup.button.callback("⚙️ Настройки", "settings"),
      Markup.button.callback("🛠 Инструменты", "tools"),
    ]);
  }
  if (isPrivate(ctx) && process.env.WEBAPP_URL) {
    buttons.push([
      Markup.button.webApp("📱 Открыть приложение", process.env.WEBAPP_URL),
    ]);
  }
  try {
    await editOrSend(
      ctx,
      "🏠 Главное меню\n\nВыберите опцию ниже:",
      Markup.inlineKeyboard(buttons)
    );
  } catch (e) {
    console.error("[mainMenu error]", e);
  }
}

function startHandler(bot) {
  bot.start(async (ctx) => {
    try {
      inputState.delete(ctx.from.id);
      await mainMenu(ctx);
      await trackSend(ctx, () =>
        ctx.reply("Или используйте кнопку ниже для возврата в меню:", {
          ...replyKeyboard,
          disable_notification: !isPrivate(ctx),
        })
      );
    } catch (e) {
      console.error("[start error]", e);
    }
  });

  bot.action("main_menu", async (ctx) => {
    try {
      await mainMenu(ctx);
    } catch (e) {
      console.error("[main_menu error]", e);
    }
  });
}

module.exports = startHandler;
module.exports.mainMenu = mainMenu;
module.exports.replyKeyboard = replyKeyboard;
