import { Telegraf, Context, Markup } from "telegraf";
import { isSuperadmin } from "../middleware/auth";
import { editOrSend, trackSend, isPrivate } from "../helpers/editOrSend";
import * as inputState from "../helpers/inputState";
import * as userService from "../../services/userService";
import { AI_MODELS, MODEL_TASKS } from "../../config/aiModels";

async function showSettings(ctx: Context): Promise<void> {
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

  const buttons: any[][] = [];
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
  await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons) as any);
}

function settingsHandler(bot: Telegraf): void {
  bot.action("settings", async (ctx: Context) => {
    await showSettings(ctx);
  });

  // Add users
  const addActions = [
    { action: "add_student", step: "add_student", prompt: "Введите username студента (с @):" },
    { action: "add_superadmin", step: "add_superadmin", prompt: "Введите username супер-админа (с @):" },
  ];

  for (const { action, step, prompt } of addActions) {
    bot.action(action, async (ctx: Context) => {
      if (!(await isSuperadmin(ctx))) {
        return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
      }
      inputState.set(ctx.from!.id, { mode: "add_user", step });
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
    bot.action(new RegExp(`^${pattern}_(.+)$`), async (ctx: Context) => {
      if (!(await isSuperadmin(ctx))) {
        return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
      }
      const username = `@${(ctx as any).match![1]}`;
      await editOrSend(
        ctx,
        `⚠️ Удалить ${label} ${username}?\n\n---`,
        Markup.inlineKeyboard([
          [Markup.button.callback("✅ Да, удалить", `${confirm}_${(ctx as any).match![1]}`)],
          [Markup.button.callback("❌ Отмена", "settings")],
        ]) as any
      );
    });

    // Execute removal
    bot.action(new RegExp(`^${confirm}_(.+)$`), async (ctx: Context) => {
      if (!(await isSuperadmin(ctx))) {
        return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
      }
      const username = `@${(ctx as any).match![1]}`;
      const removed = await userService.removeUser(field, username);
      await ctx.answerCbQuery(
        removed ? `✅ ${username} удалён.` : "❌ Не найден."
      );
      await showSettings(ctx);
    });
  }

  // --- AI Model settings (will be rewritten in Phase 3) ---

  const taskMap: Record<string, string> = { chat: "chat", orch: "orchestrator", solve: "autoSolve" };
  const taskShort: Record<string, string> = { chat: "chat", orchestrator: "orch", autoSolve: "solve" };

  async function showModelMenu(ctx: Context): Promise<void> {
    const models = await userService.getModelSettings();
    let msg = "🤖 AI модели\n\n";
    for (const [task, cfg] of Object.entries(MODEL_TASKS) as [string, any][]) {
      const modelId = models[task] || cfg.default;
      const info = (AI_MODELS as any)[modelId];
      msg += `${cfg.label}: ${info?.name || modelId}\n`;
    }
    msg += "\nВыберите задачу для изменения модели:";

    const buttons = (Object.entries(MODEL_TASKS) as [string, any][]).map(([task, cfg]) => [
      Markup.button.callback(cfg.label, `aim_${taskShort[task]}`),
    ]);
    buttons.push([Markup.button.callback("⬅️ Назад", "settings")]);
    await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons) as any);
  }

  bot.action("ai_models", async (ctx: Context) => {
    if (!(await isSuperadmin(ctx))) {
      return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
    }
    await showModelMenu(ctx);
  });

  bot.action(/^aim_(chat|orch|solve)$/, async (ctx: Context) => {
    if (!(await isSuperadmin(ctx))) {
      return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
    }
    const short = (ctx as any).match![1];
    const task = taskMap[short];
    const models = await userService.getModelSettings();
    const current = models[task] || (MODEL_TASKS as any)[task].default;

    let msg = `${(MODEL_TASKS as any)[task].label}\n\nТекущая: ${(AI_MODELS as any)[current]?.name || current}\n\nВыберите модель:`;
    const buttons = Object.entries(AI_MODELS).map(([modelId, info]: [string, any]) => [
      Markup.button.callback(
        `${modelId === current ? "✅ " : ""}${info.name}`,
        `ams_${short}_${modelId}`
      ),
    ]);
    buttons.push([Markup.button.callback("⬅️ Назад", "ai_models")]);
    await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons) as any);
  });

  bot.action(/^ams_(chat|orch|solve)_(.+)$/, async (ctx: Context) => {
    if (!(await isSuperadmin(ctx))) {
      return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
    }
    const short = (ctx as any).match![1];
    const modelId = (ctx as any).match![2];
    const task = taskMap[short];

    const ok = await userService.updateModelSetting(task, modelId);
    if (ok) {
      await ctx.answerCbQuery(`✅ ${(AI_MODELS as any)[modelId]?.name || modelId}`);
    } else {
      await ctx.answerCbQuery("❌ Ошибка");
    }
    await showModelMenu(ctx);
  });
}

export default settingsHandler;
export { showSettings };
