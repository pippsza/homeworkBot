const { Markup } = require("telegraf");
const { isSuperuser, isAdmin } = require("../middleware/auth");
const { editOrSend, trackSend, isPrivate } = require("../helpers/editOrSend");
const inputState = require("../helpers/inputState");
const userService = require("../../services/userService");
const { AI_MODELS, MODEL_TASKS } = require("../../config/aiModels");

async function showSettings(ctx) {
  const s = await userService.getSettings();
  let msg = "⚙️ Настройки\n\n";
  msg += "📋 Админы (управление предметами, заданиями, информацией):\n" + (s.admins.join("\n") || "Пусто") + "\n\n";
  msg +=
    "👀 Ревьюверы (просмотр ответов к заданиям):\n" +
    (s.reviewers.join("\n") || "Пусто") +
    "\n\n";
  msg +=
    "🔥 Суперпользователи (управление ролями):\n" +
    (s.superusers.join("\n") || "Пусто") +
    "\n\n---";

  const buttons = [];
  if (await isSuperuser(ctx)) {
    buttons.push([
      Markup.button.callback("➕ Админ", "add_admin"),
      Markup.button.callback("➕ Reviewer", "add_reviewer"),
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
    for (const u of s.reviewers) {
      buttons.push([
        Markup.button.callback(
          `🗑 ${u} (reviewer)`,
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
  if (await isSuperuser(ctx) || await isAdmin(ctx)) {
    buttons.push([Markup.button.callback("🤖 AI модели", "ai_models")]);
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
    { action: "add_reviewer", step: "add_reviewer", prompt: "Введите username ревьювера (с @):" },
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
    { pattern: "rv", label: "ревьювера", field: "reviewers", confirm: "yrv" },
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

  // --- AI Model settings ---

  // Task key mapping for short callback names
  const taskMap = { chat: "chat", orch: "orchestrator", solve: "autoSolve" };
  const taskShort = { chat: "chat", orchestrator: "orch", autoSolve: "solve" };

  async function showModelMenu(ctx) {
    const models = await userService.getModelSettings();
    let msg = "🤖 AI модели\n\n";
    for (const [task, cfg] of Object.entries(MODEL_TASKS)) {
      const modelId = models[task] || cfg.default;
      const info = AI_MODELS[modelId];
      msg += `${cfg.label}: ${info?.name || modelId}\n`;
    }
    msg += "\nВыберите задачу для изменения модели:";

    const buttons = Object.entries(MODEL_TASKS).map(([task, cfg]) => [
      Markup.button.callback(cfg.label, `aim_${taskShort[task]}`),
    ]);
    buttons.push([Markup.button.callback("⬅️ Назад", "settings")]);
    await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons));
  }

  bot.action("ai_models", async (ctx) => {
    if (!(await isAdmin(ctx))) {
      return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
    }
    await showModelMenu(ctx);
  });

  // Show model selection for a task
  bot.action(/^aim_(chat|orch|solve)$/, async (ctx) => {
    if (!(await isAdmin(ctx))) {
      return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
    }
    const short = ctx.match[1];
    const task = taskMap[short];
    const models = await userService.getModelSettings();
    const current = models[task] || MODEL_TASKS[task].default;

    let msg = `${MODEL_TASKS[task].label}\n\nТекущая: ${AI_MODELS[current]?.name || current}\n\nВыберите модель:`;
    const buttons = Object.entries(AI_MODELS).map(([modelId, info]) => [
      Markup.button.callback(
        `${modelId === current ? "✅ " : ""}${info.name}`,
        `ams_${short}_${modelId}`
      ),
    ]);
    buttons.push([Markup.button.callback("⬅️ Назад", "ai_models")]);
    await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons));
  });

  // Save model selection
  bot.action(/^ams_(chat|orch|solve)_(.+)$/, async (ctx) => {
    if (!(await isAdmin(ctx))) {
      return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
    }
    const short = ctx.match[1];
    const modelId = ctx.match[2];
    const task = taskMap[short];

    const ok = await userService.updateModelSetting(task, modelId);
    if (ok) {
      await ctx.answerCbQuery(`✅ ${AI_MODELS[modelId]?.name || modelId}`);
    } else {
      await ctx.answerCbQuery("❌ Ошибка");
    }
    await showModelMenu(ctx);
  });
}

module.exports = settingsHandler;
module.exports.showSettings = showSettings;
