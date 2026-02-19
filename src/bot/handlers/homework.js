const { Markup } = require("telegraf");
const { trackSend, editOrSend, isPrivate } = require("../helpers/editOrSend");
const inputState = require("../helpers/inputState");
const { isAdmin } = require("../middleware/auth");
const { extractHomework, createHomework, getSubjectsList } = require("../../services/homeworkCreatorService");
const subjectService = require("../../services/subjectService");

/**
 * Check if a message is forwarded.
 */
function isForwarded(msg) {
  return !!(msg.forward_origin || msg.forward_date || msg.forward_from || msg.forward_from_chat);
}

/**
 * Extract text content from a message (text, caption, etc.)
 */
function getMessageText(msg) {
  return msg.text || msg.caption || "";
}

/**
 * Get attachment from a message if present.
 */
function getMessageAttachment(msg) {
  if (msg.document) {
    return { type: "document", file_id: msg.document.file_id };
  }
  if (msg.photo && msg.photo.length) {
    return { type: "photo", file_id: msg.photo[msg.photo.length - 1].file_id };
  }
  return null;
}

/**
 * Update the "collecting" status message.
 */
async function updateCollectMessage(ctx, state) {
  const count = state.messages.length;
  const attachCount = state.attachments.length;

  let text = `📝 Получено сообщений: <b>${count}</b>`;
  if (attachCount > 0) {
    text += `\n📎 Вложений: <b>${attachCount}</b>`;
  }
  text += "\n\nПересылайте ещё или нажмите кнопку:";

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("✅ Создать домашку", "hw_create")],
    [Markup.button.callback("❌ Отмена", "hw_cancel")],
  ]);

  try {
    if (state.statusMessageId) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        state.statusMessageId,
        null,
        text,
        { parse_mode: "HTML", reply_markup: keyboard.reply_markup }
      );
    } else {
      const sent = await trackSend(ctx, () =>
        ctx.reply(text, {
          parse_mode: "HTML",
          ...keyboard,
          disable_notification: !isPrivate(ctx),
        })
      );
      state.statusMessageId = sent.message_id;
    }
  } catch (e) {
    console.error("[homework] updateCollectMessage error:", e.message);
  }
}

/**
 * Show homework preview before saving.
 */
async function showPreview(ctx, extracted, attachments, subjectName) {
  let text = "📋 <b>Превью домашки:</b>\n\n";
  text += `${extracted.emoji} <b>${extracted.title}</b>\n`;
  if (subjectName) text += `📚 Предмет: ${subjectName}\n`;
  if (extracted.description) {
    text += `\n${extracted.description.slice(0, 500)}`;
    if (extracted.description.length > 500) text += "...";
  }
  if (attachments.length > 0) {
    text += `\n\n📎 Вложений: ${attachments.length}`;
  }

  const buttons = [
    [Markup.button.callback("✅ Сохранить", "hw_save")],
    [Markup.button.callback("✏️ Выбрать предмет", "hw_pick")],
    [Markup.button.callback("❌ Отмена", "hw_cancel")],
  ];

  await editOrSend(ctx, text, Markup.inlineKeyboard(buttons));
}

/**
 * Show subject selection buttons.
 */
async function showSubjectPicker(ctx) {
  const subjects = await getSubjectsList();
  if (subjects.length === 0) {
    await editOrSend(ctx, "❌ Нет доступных предметов. Сначала создайте предмет.", Markup.inlineKeyboard([]));
    inputState.delete(ctx.from.id);
    return;
  }

  const buttons = subjects.map((s) => [
    Markup.button.callback(`${s.emoji} ${s.name}`, `hw_subj_${s.id}`),
  ]);
  buttons.push([Markup.button.callback("❌ Отмена", "hw_cancel")]);

  await editOrSend(
    ctx,
    "📚 Выберите предмет для домашки:",
    Markup.inlineKeyboard(buttons)
  );
}

function setupHomeworkHandler(bot) {
  // /newHW command
  bot.command("newhw", async (ctx) => {
    if (!(await isAdmin(ctx))) {
      return ctx.reply("⛔ Только для админов.", {
        disable_notification: !isPrivate(ctx),
      });
    }

    // Get text from reply or command arguments
    let text = "";
    const args = ctx.message.text.replace(/^\/newhw\s*/i, "").trim();

    if (ctx.message.reply_to_message) {
      text = getMessageText(ctx.message.reply_to_message);
      if (args) text += "\n\n" + args;
    } else if (args) {
      text = args;
    }

    if (!text) {
      return trackSend(ctx, () =>
        ctx.reply(
          "💡 Использование:\n• Ответьте на сообщение: /newhw\n• С текстом: /newhw <описание задания>\n• Или перешлите сообщения боту в ЛС",
          { disable_notification: !isPrivate(ctx) }
        )
      );
    }

    // Collect attachments from replied message if present
    const attachments = [];
    if (ctx.message.reply_to_message) {
      const att = getMessageAttachment(ctx.message.reply_to_message);
      if (att) attachments.push(att);
    }

    const thinking = await trackSend(ctx, () =>
      ctx.reply("🤔 Анализирую задание...", {
        disable_notification: !isPrivate(ctx),
      })
    );

    try {
      const extracted = await extractHomework(text);
      if (!extracted) {
        await ctx.telegram.editMessageText(
          ctx.chat.id, thinking.message_id, null,
          "❌ Не удалось распознать задание. Попробуйте с более подробным описанием."
        );
        return;
      }

      // Save to state for confirmation flow
      inputState.set(ctx.from.id, {
        mode: "hw_confirm",
        extracted,
        attachments,
      });

      // Delete thinking message
      await ctx.telegram.deleteMessage(ctx.chat.id, thinking.message_id).catch(() => {});

      // If subject detected, show preview; otherwise, show picker
      if (extracted.subjectId) {
        const subject = await subjectService.getById(extracted.subjectId);
        await showPreview(ctx, extracted, attachments, subject?.name);
      } else {
        // Store extracted data and show subject picker
        await showSubjectPicker(ctx);
      }
    } catch (e) {
      console.error("[homework /newhw] error:", e);
      await ctx.telegram.editMessageText(
        ctx.chat.id, thinking.message_id, null,
        "❌ Ошибка при анализе задания."
      ).catch(() => {});
    }
  });

  // Callback: create homework from collected messages
  bot.action("hw_create", async (ctx) => {
    const state = inputState.get(ctx.from.id);
    if (!state || state.mode !== "collect_hw") {
      await ctx.answerCbQuery("Сессия истекла");
      return;
    }

    await ctx.answerCbQuery("Анализирую...");

    const fullText = state.messages.join("\n\n---\n\n");
    try {
      const extracted = await extractHomework(fullText);
      if (!extracted) {
        await editOrSend(
          ctx,
          "❌ Не удалось распознать задание. Попробуйте переслать более подробные сообщения.",
          Markup.inlineKeyboard([[Markup.button.callback("❌ Закрыть", "hw_cancel")]])
        );
        return;
      }

      // Update state to confirmation mode
      state.mode = "hw_confirm";
      state.extracted = extracted;
      inputState.set(ctx.from.id, state);

      if (extracted.subjectId) {
        const subject = await subjectService.getById(extracted.subjectId);
        await showPreview(ctx, extracted, state.attachments, subject?.name);
      } else {
        await showSubjectPicker(ctx);
      }
    } catch (e) {
      console.error("[homework hw_create] error:", e);
      await editOrSend(
        ctx,
        "❌ Ошибка при анализе задания.",
        Markup.inlineKeyboard([[Markup.button.callback("❌ Закрыть", "hw_cancel")]])
      );
    }
  });

  // Callback: save homework
  bot.action("hw_save", async (ctx) => {
    const state = inputState.get(ctx.from.id);
    if (!state || state.mode !== "hw_confirm" || !state.extracted) {
      await ctx.answerCbQuery("Сессия истекла");
      return;
    }

    const { extracted, attachments = [] } = state;
    if (!extracted.subjectId) {
      await ctx.answerCbQuery("Сначала выберите предмет");
      await showSubjectPicker(ctx);
      return;
    }

    try {
      const task = await createHomework(extracted.subjectId, {
        title: extracted.title,
        emoji: extracted.emoji,
        description: extracted.description,
        attachments,
      });

      inputState.delete(ctx.from.id);

      const subject = await subjectService.getById(extracted.subjectId);
      await editOrSend(
        ctx,
        `✅ Домашка создана!\n\n${extracted.emoji} <b>${extracted.title}</b>\n📚 ${subject?.name || "Предмет"}`,
        Markup.inlineKeyboard([])
      );
      await ctx.answerCbQuery("Создано!");
    } catch (e) {
      console.error("[homework hw_save] error:", e);
      await ctx.answerCbQuery("Ошибка при сохранении");
    }
  });

  // Callback: pick subject (show picker)
  bot.action("hw_pick", async (ctx) => {
    const state = inputState.get(ctx.from.id);
    if (!state || state.mode !== "hw_confirm") {
      await ctx.answerCbQuery("Сессия истекла");
      return;
    }
    await ctx.answerCbQuery();
    await showSubjectPicker(ctx);
  });

  // Callback: subject selected
  bot.action(/^hw_subj_(.+)$/, async (ctx) => {
    const state = inputState.get(ctx.from.id);
    if (!state || state.mode !== "hw_confirm" || !state.extracted) {
      await ctx.answerCbQuery("Сессия истекла");
      return;
    }

    const subjectId = ctx.match[1];
    state.extracted.subjectId = subjectId;
    inputState.set(ctx.from.id, state);

    const subject = await subjectService.getById(subjectId);
    await ctx.answerCbQuery(`Предмет: ${subject?.name || "..."}`);
    await showPreview(ctx, state.extracted, state.attachments || [], subject?.name);
  });

  // Callback: cancel
  bot.action("hw_cancel", async (ctx) => {
    inputState.delete(ctx.from.id);
    await ctx.answerCbQuery("Отменено");
    await editOrSend(ctx, "❌ Создание домашки отменено.", Markup.inlineKeyboard([]));
  });
}

module.exports = { setupHomeworkHandler, isForwarded, getMessageText, getMessageAttachment, updateCollectMessage };
