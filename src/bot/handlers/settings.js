const { Markup } = require("telegraf");
const { isSuperadmin } = require("../middleware/auth");
const { editOrSend, trackSend, isPrivate } = require("../helpers/editOrSend");
const inputState = require("../helpers/inputState");
const userService = require("../../services/userService");
const { AI_MODELS, MODEL_TASKS } = require("../../config/aiModels");

async function showSettings(ctx) {
  const s = await userService.getSettings();
  let msg = "⚙️ Настройки\n\n";
  msg +=
    "👥 Студенты (предметы, задания, ответы, AI):\n" +
    (s.students?.length ? s.students.join("\n") : "Пусто") +
    "\n\n";
  msg +=
    "🔥 Супер-админы (админ-панель, модели, юзеры):\n" +
    (s.superadmins?.length ? s.superadmins.join("\n") : "Пусто") +
    "\n\n---";

  const buttons = [];
  if (await isSuperadmin(ctx)) {
    buttons.push([
      Markup.button.callback("➕ Студент", "add_student"),
      Markup.button.callback("➕ Супер-админ", "add_superadmin"),
    ]);
    for (const u of s.students || []) {
      buttons.push([
        Markup.button.callback(
          `🗑 ${u} (студент)`,
          `rst_${u.slice(1)}`
        ),
      ]);
    }
    for (const u of s.superadmins || []) {
      buttons.push([
        Markup.button.callback(
          `🗑 ${u} (супер)`,
          `rsa_${u.slice(1)}`
        ),
      ]);
    }
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
    { action: "add_student", step: "add_student", prompt: "Введите username студента (с @):" },
    { action: "add_superadmin", step: "add_superadmin", prompt: "Введите username супер-админа (с @):" },
  ];

  for (const { action, step, prompt } of addActions) {
    bot.action(action, async (ctx) => {
      if (!(await isSuperadmin(ctx))) {
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
    { pattern: "rst", label: "студента", field: "students", confirm: "yrst" },
    { pattern: "rsa", label: "супер-админа", field: "superadmins", confirm: "yrsa" },
  ];

  for (const { pattern, label, field, confirm } of removeConfirms) {
    // Show confirmation
    bot.action(new RegExp(`^${pattern}_(.+)$`), async (ctx) => {
      if (!(await isSuperadmin(ctx))) {
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
      if (!(await isSuperadmin(ctx))) {
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

  // --- AI Model settings (will be rewritten in Phase 3) ---

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
    if (!(await isSuperadmin(ctx))) {
      return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
    }
    await showModelMenu(ctx);
  });

  bot.action(/^aim_(chat|orch|solve)$/, async (ctx) => {
    if (!(await isSuperadmin(ctx))) {
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

  bot.action(/^ams_(chat|orch|solve)_(.+)$/, async (ctx) => {
    if (!(await isSuperadmin(ctx))) {
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
