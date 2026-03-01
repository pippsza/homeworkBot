const { Markup } = require("telegraf");
const { editOrSend } = require("../helpers/editOrSend");
const scheduleService = require("../../services/scheduleService");

function formatScheduleMessage(date, result) {
  const d = new Date(date);
  const dateStr = d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long" });
  const weekType = result.isOdd ? "нечётная" : "чётная";

  let text = `📅 <b>Расписание</b>\n`;
  text += `📆 ${dateStr}\n`;
  text += `📋 Неделя ${result.weekNumber} (${weekType})\n`;

  if (result.isSaturday && result.followsDayName) {
    text += `🔄 Суббота по расписанию ${result.followsDayName.toLowerCase()}\n`;
  }

  text += `\n`;

  if (result.classes.length === 0) {
    if (result.noMapping) {
      text += `🎉 Суббота — нет расписания на эту неделю`;
    } else {
      text += `🎉 Нет занятий`;
    }
  } else {
    for (const cls of result.classes) {
      text += `<b>${cls.slotNumber}.</b> ${cls.startTime} — ${cls.endTime}\n`;
      text += `   ${cls.subjectEmoji || "📚"} ${cls.subjectName || "Неизвестный предмет"}\n\n`;
    }
  }

  return text.trim();
}

function navKeyboard(offset) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("◀️", `schd_${offset - 1}`),
      Markup.button.callback("Сегодня", "sch"),
      Markup.button.callback("▶️", `schd_${offset + 1}`),
    ],
    [Markup.button.callback("🏠 Меню", "main_menu")],
  ]);
}

async function showSchedule(ctx, offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);

  const result = await scheduleService.getScheduleForDate(date);
  const text = formatScheduleMessage(date, result);
  const kb = navKeyboard(offset);

  await editOrSend(ctx, text, kb);
}

function scheduleHandler(bot) {
  // Command or main menu button
  bot.action("sch", async (ctx) => {
    try {
      await showSchedule(ctx, 0);
    } catch (e) {
      console.error("[schedule error]", e);
    }
  });

  // Day navigation
  bot.action(/^schd_(-?\d+)$/, async (ctx) => {
    try {
      const offset = parseInt(ctx.match[1]);
      await showSchedule(ctx, offset);
    } catch (e) {
      console.error("[schedule nav error]", e);
    }
  });
}

module.exports = scheduleHandler;
