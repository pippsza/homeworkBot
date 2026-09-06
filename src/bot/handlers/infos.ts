import { Telegraf, Context, Markup } from "telegraf";
import { isStudent } from "../middleware/auth";
import { editOrSend, trackSend, isPrivate, notice } from "../helpers/editOrSend";
import * as inputState from "../helpers/inputState";
import * as infoService from "../../services/infoService";

function infoEditMenu(infoId: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📝 Заголовок", `eit_${infoId}`)],
    [Markup.button.callback("😀 Emoji", `eie_${infoId}`)],
    [Markup.button.callback("📄 Описание", `eid_${infoId}`)],
    [Markup.button.callback("📎 Вложения", `eia_${infoId}`)],
    [Markup.button.callback("✅ Готово", `info_${infoId}`)],
  ]);
}

function infosHandler(bot: Telegraf): void {
  // List all infos
  bot.action("infos", async (ctx: Context) => {
    const infos = await infoService.getAll();
    if (infos.length === 0) {
      const buttons: any[][] = [];
      if (await isStudent(ctx)) {
        buttons.push([
          Markup.button.callback("➕ Добавить информацию", "add_info"),
        ]);
      }
      buttons.push([Markup.button.callback("⬅️ Назад", "main_menu")]);
      return editOrSend(
        ctx,
        "😔 Нет информации в списке.\n\n---",
        Markup.inlineKeyboard(buttons) as any
      );
    }

    let msg = "📋 Список информации:\n\n";
    infos.forEach((info: any) => {
      msg += `${info.emoji || "ℹ️"} ${info.title}\n`;
    });
    msg += "\n---";

    const infoButtons: any[][] = [];
    for (let i = 0; i < infos.length; i += 3) {
      infoButtons.push(
        infos
          .slice(i, i + 3)
          .map((info: any) =>
            Markup.button.callback(info.emoji || "ℹ️", `info_${info._id}`)
          )
      );
    }
    const buttons = [...infoButtons];
    if (await isStudent(ctx)) {
      buttons.push([
        Markup.button.callback("➕ Добавить информацию", "add_info"),
      ]);
    }
    buttons.push([Markup.button.callback("⬅️ Назад", "main_menu")]);
    await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons) as any);
  });

  // View single info
  bot.action(/^info_([a-f0-9]{24})$/, async (ctx: Context) => {
    const id = (ctx as any).match![1];
    const info = await infoService.getById(id);
    if (!info) {
      return editOrSend(
        ctx,
        "❌ Информация не найдена.\n\n---",
        Markup.inlineKeyboard([
          [Markup.button.callback("⬅️ Назад", "infos")],
        ]) as any
      );
    }

    let msg = `*ℹ️ ${info.title}*\n\n`;
    if (info.description) msg += `${info.description}\n\n`;
    if (info.chunkCount > 0) msg += `🧩 Чанков: ${info.chunkCount}\n`;
    msg += "---\n";

    const buttons: any[][] = [];
    if (info.attachments && info.attachments.length > 0) {
      buttons.push([
        Markup.button.callback(
          `📎 Вложения (${info.attachments.length})`,
          `sia_${id}`
        ),
      ]);
    }
    if (await isStudent(ctx)) {
      buttons.push([
        Markup.button.callback("✏️ Редактировать", `eim_${id}`),
      ]);
      buttons.push([
        Markup.button.callback("🗑️ Удалить", `irc_${id}`),
      ]);
    }
    buttons.push([Markup.button.callback("⬅️ Назад", "infos")]);
    await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons) as any);
  });

  // Confirm delete info
  bot.action(/^irc_([a-f0-9]{24})$/, async (ctx: Context) => {
    const id = (ctx as any).match![1];
    await editOrSend(
      ctx,
      "⚠️ Вы уверены, что хотите удалить информацию?\n\nЭто действие необратимо!\n\n---",
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Да, удалить", `iry_${id}`)],
        [Markup.button.callback("❌ Нет, отменить", `info_${id}`)],
      ]) as any
    );
  });

  // Execute delete info
  bot.action(/^iry_([a-f0-9]{24})$/, async (ctx: Context) => {
    if (!(await isStudent(ctx)))
      return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
    const id = (ctx as any).match![1];
    const removed = await infoService.delete(id);
    if (!removed)
      return ctx.answerCbQuery("❌ Информация не найдена.", {
        show_alert: false,
      });

    await ctx.answerCbQuery("✅ Информация удалена");

    const infos = await infoService.getAll();
    const msg =
      infos.length === 0
        ? `🗑️ Информация "${removed.title}" удалена.\n\n😔 Нет информации.`
        : `🗑️ Информация "${removed.title}" удалена.\n\n📋 Список информации:\n\n` +
          infos
            .map((info: any) => `${info.emoji || "ℹ️"} ${info.title}`)
            .join("\n") +
          "\n\n---";

    const infoButtons: any[][] = [];
    for (let i = 0; i < infos.length; i += 3) {
      infoButtons.push(
        infos
          .slice(i, i + 3)
          .map((info: any) =>
            Markup.button.callback(info.emoji || "ℹ️", `info_${info._id}`)
          )
      );
    }
    const buttons = [...infoButtons];
    if (await isStudent(ctx))
      buttons.push([
        Markup.button.callback("➕ Добавить информацию", "add_info"),
      ]);
    buttons.push([Markup.button.callback("⬅️ Назад", "main_menu")]);
    await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons) as any);
  });

  // Show info attachments
  bot.action(/^sia_([a-f0-9]{24})$/, async (ctx: Context) => {
    const info = await infoService.getById((ctx as any).match![1]);
    if (!info?.attachments?.length) return;
    for (const att of info.attachments) {
      try {
        if (att.type === "photo") {
          await trackSend(ctx, () =>
            ctx.replyWithPhoto(att.file_id, {
              disable_notification: !isPrivate(ctx),
            })
          );
        } else if (att.type === "document") {
          await trackSend(ctx, () =>
            ctx.replyWithDocument(att.file_id, {
              disable_notification: !isPrivate(ctx),
            })
          );
        }
      } catch (e) {
        console.error("[send attachment error]", e);
      }
    }
  });

  // Add info
  bot.action("add_info", async (ctx: Context) => {
    if (!(await isStudent(ctx))) {
      return notice(ctx, "❌ Нет прав.");
    }
    inputState.set(ctx.from!.id, {
      mode: "add_info",
      step: "title",
      title: "",
      emoji: "",
      description: "",
      attachments: [],
    });
    await editOrSend(ctx, "ℹ️ Введите заголовок информации:", Markup.inlineKeyboard([
          [Markup.button.callback("❌ Отмена", "infos")],
        ]) as any);
  });

  // Edit info menu
  bot.action(/^eim_([a-f0-9]{24})$/, async (ctx: Context) => {
    const id = (ctx as any).match![1];
    await editOrSend(
      ctx,
      "✏️ Что хотите изменить в информации?\n\n---",
      infoEditMenu(id) as any
    );
  });

  // Edit info fields
  const editInfoFields = [
    { pattern: "eit", step: "edit_title", prompt: "📝 Введите новый заголовок:" },
    { pattern: "eie", step: "edit_emoji", prompt: "😀 Введите новый emoji:" },
    {
      pattern: "eid",
      step: "edit_description",
      prompt: "📄 Введите новое описание:",
    },
  ];

  for (const { pattern, step, prompt } of editInfoFields) {
    bot.action(new RegExp(`^${pattern}_([a-f0-9]{24})$`), async (ctx: Context) => {
      const infoId = (ctx as any).match![1];
      inputState.set(ctx.from!.id, { mode: "edit_info", step, infoId });
      await editOrSend(ctx, prompt, Markup.inlineKeyboard([
            [Markup.button.callback("❌ Отмена", `eim_${infoId}`)],
          ]) as any);
    });
  }

  // Edit info attachments
  bot.action(/^eia_([a-f0-9]{24})$/, async (ctx: Context) => {
    const infoId = (ctx as any).match![1];
    inputState.set(ctx.from!.id, {
      mode: "edit_info",
      step: "attachments",
      infoId,
      attachments: [],
    });
    await editOrSend(ctx, '📎 Отправьте новые файлы/фото для информации. Когда закончите, нажмите "✅ Готово".\n\n---', Markup.inlineKeyboard([
            [Markup.button.callback("✅ Готово", `fia_${infoId}`)],
          ]) as any);
  });

  // Finish info attachments
  bot.action(/^fia_([a-f0-9]{24})$/, async (ctx: Context) => {
    const state = inputState.get(ctx.from!.id);
    if (!state) return;

    if (state.mode === "add_info") {
      await infoService.create({
        title: state.title,
        emoji: state.emoji || "ℹ️",
        description: state.description,
        attachments: state.attachments,
      });
      inputState.delete(ctx.from!.id);
      await editOrSend(ctx, "✅ Информация сохранена!\n\n---");
      const { mainMenu } = await import("./start");
      await mainMenu(ctx);
    } else if (state.mode === "edit_info" && state.step === "attachments") {
      await infoService.setAttachments(state.infoId, state.attachments);
      inputState.delete(ctx.from!.id);
      await editOrSend(ctx, "✅ Вложения обновлены!\n\n---");
    }
  });

  // Skip info description
  bot.action(/^skid_([a-f0-9]{24})$/, async (ctx: Context) => {
    const state = inputState.get(ctx.from!.id);
    if (!state || state.step !== "description") return;
    state.description = "";
    state.step = "attachments";
    const finishId =
      state.mode === "add_info" ? "new" : state.infoId;
    await editOrSend(ctx, '📎 Отправьте файлы/фото для информации. Когда закончите, нажмите "✅ Готово".\n\n---', Markup.inlineKeyboard([
            [Markup.button.callback("✅ Готово", `fia_${finishId}`)],
          ]) as any);
  });

  // Skip info description for add flow (no id)
  bot.action("skip_info_description", async (ctx: Context) => {
    const state = inputState.get(ctx.from!.id);
    if (!state || state.step !== "description") return;
    state.description = "";
    state.step = "attachments";
    await editOrSend(ctx, '📎 Отправьте файлы/фото для информации. Когда закончите, нажмите "✅ Готово".\n\n---', Markup.inlineKeyboard([
            [Markup.button.callback("✅ Готово", "finish_add_info_attachments")],
          ]) as any);
  });

  // Finish adding info attachments (new info)
  bot.action("finish_add_info_attachments", async (ctx: Context) => {
    const state = inputState.get(ctx.from!.id);
    if (!state || state.mode !== "add_info") return;
    await infoService.create({
      title: state.title,
      emoji: state.emoji || "ℹ️",
      description: state.description,
      attachments: state.attachments,
    });
    inputState.delete(ctx.from!.id);
    await editOrSend(ctx, "✅ Информация сохранена!\n\n---");
    const { mainMenu } = await import("./start");
    await mainMenu(ctx);
  });
}

export default infosHandler;
export { infoEditMenu };
