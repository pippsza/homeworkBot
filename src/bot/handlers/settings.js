const { Markup } = require("telegraf");
const { isSuperuser } = require("../middleware/auth");
const { editOrSend, trackSend, isPrivate } = require("../helpers/editOrSend");
const inputState = require("../helpers/inputState");
const userService = require("../../services/userService");

async function showSettings(ctx) {
  const s = await userService.getSettings();
  let msg = "⚙️ Настройки\n\n";
  msg += "📋 Админы (управление предметами, заданиями, информацией):\n" + (s.admins.join("\n") || "Пусто") + "\n\n";
  msg +=
    "👀 Просмотрщики ответов (просмотр ответов к заданиям):\n" +
    (s.answerViewers.join("\n") || "Пусто") +
    "\n\n";
  msg +=
    "🔥 Суперпользователи (управление ролями):\n" +
    (s.superusers.join("\n") || "Пусто") +
    "\n\n---";

  const buttons = [];
  if (await isSuperuser(ctx)) {
    buttons.push([
      Markup.button.callback("➕ Админ", "add_admin"),
      Markup.button.callback("➕ Viewer", "add_answer_viewer"),
      Markup.button.callback("➕ Superuser", "add_superuser"),
    ]);
    for (const u of s.admins) {
      buttons.push([
        Markup.button.callback(
          `🗑 ${u} (admin)`,
          `ra_${u.slice(1)}`
        ),
      ]);
    }
    for (const u of s.answerViewers) {
      buttons.push([
        Markup.button.callback(
          `🗑 ${u} (viewer)`,
          `rv_${u.slice(1)}`
        ),
      ]);
    }
    for (const u of s.superusers) {
      buttons.push([
        Markup.button.callback(
          `🗑 ${u} (super)`,
          `rs_${u.slice(1)}`
        ),
      ]);
    }
  }
  buttons.push([Markup.button.callback("⬅️ Назад", "main_menu")]);
  await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons));
}

function settingsHandler(bot) {
  bot.action("settings", async (ctx) => {
    await showSettings(ctx);
  });

  // Add users
  const addActions = [
    { action: "add_admin", step: "add_admin", prompt: "Введите username админа (с @):" },
    { action: "add_answer_viewer", step: "add_answer_viewer", prompt: "Введите username просмотрщика (с @):" },
    { action: "add_superuser", step: "add_superuser", prompt: "Введите username суперпользователя (с @):" },
  ];

  for (const { action, step, prompt } of addActions) {
    bot.action(action, async (ctx) => {
      if (!(await isSuperuser(ctx))) {
        return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
      }
      inputState.set(ctx.from.id, { mode: "add_user", step });
      await trackSend(ctx, () =>
        ctx.reply(prompt, {
          ...Markup.inlineKeyboard([
            [Markup.button.callback("❌ Отмена", "settings")],
          ]),
          disable_notification: !isPrivate(ctx),
        })
      );
    });
  }

  // Confirm remove user
  const removeConfirms = [
    { pattern: "ra", label: "админа", field: "admins", confirm: "yra" },
    { pattern: "rv", label: "просмотрщика", field: "answerViewers", confirm: "yrv" },
    { pattern: "rs", label: "суперпользователя", field: "superusers", confirm: "yrs" },
  ];

  for (const { pattern, label, field, confirm } of removeConfirms) {
    // Show confirmation
    bot.action(new RegExp(`^${pattern}_(.+)$`), async (ctx) => {
      if (!(await isSuperuser(ctx))) {
        return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
      }
      const username = `@${ctx.match[1]}`;
      await editOrSend(
        ctx,
        `⚠️ Удалить ${label} ${username}?\n\n---`,
        Markup.inlineKeyboard([
          [Markup.button.callback("✅ Да, удалить", `${confirm}_${ctx.match[1]}`)],
          [Markup.button.callback("❌ Отмена", "settings")],
        ])
      );
    });

    // Execute removal
    bot.action(new RegExp(`^${confirm}_(.+)$`), async (ctx) => {
      if (!(await isSuperuser(ctx))) {
        return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
      }
      const username = `@${ctx.match[1]}`;
      const removed = await userService.removeUser(field, username);
      await ctx.answerCbQuery(
        removed ? `✅ ${username} удалён.` : "❌ Не найден."
      );
      await showSettings(ctx);
    });
  }
}

module.exports = settingsHandler;
module.exports.showSettings = showSettings;
