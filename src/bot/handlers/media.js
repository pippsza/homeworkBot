const { trackSend, isPrivate } = require("../helpers/editOrSend");
const inputState = require("../helpers/inputState");
const { updateCollectMessage } = require("./homework");
const { isStudent } = require("../middleware/auth");
const { processQuery, processQueryMultiImage } = require("../../services/orchestratorService");
const ChatHistory = require("../../models/ChatHistory");
const { mdToHtml } = require("./ai");
const { collect: collectMediaGroup } = require("../helpers/mediaGroupCollector");
const { checkRateLimit } = require("../helpers/rateLimit");

async function deleteUserMsg(ctx) {
  await ctx
    .deleteMessage(ctx.message.message_id)
    .catch((e) => console.error("Delete user msg error", e));
}

async function downloadFile(ctx, fileId) {
  const url = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(url.href);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Send a potentially long AI response, splitting into multiple messages if needed.
 * First message edits the "thinking" message; subsequent ones are new messages.
 */
async function sendLongResponse(ctx, thinkingMsgId, replyText) {
  const MAX_LEN = 4096;
  if (replyText.length <= MAX_LEN) {
    const htmlText = mdToHtml(replyText);
    await ctx.telegram
      .editMessageText(ctx.chat.id, thinkingMsgId, null, htmlText.slice(0, MAX_LEN), {
        parse_mode: "HTML",
      })
      .catch(() =>
        ctx.telegram.editMessageText(
          ctx.chat.id, thinkingMsgId, null, replyText.slice(0, MAX_LEN)
        )
      );
    return;
  }

  // Split on paragraph boundaries
  const chunks = splitTextSmart(replyText, MAX_LEN);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const htmlChunk = mdToHtml(chunk).slice(0, MAX_LEN);
    if (i === 0) {
      await ctx.telegram
        .editMessageText(ctx.chat.id, thinkingMsgId, null, htmlChunk, {
          parse_mode: "HTML",
        })
        .catch(() =>
          ctx.telegram.editMessageText(
            ctx.chat.id, thinkingMsgId, null, chunk.slice(0, MAX_LEN)
          )
        );
    } else {
      await ctx.reply(htmlChunk, {
        parse_mode: "HTML",
        disable_notification: true,
      }).catch(() =>
        ctx.reply(chunk.slice(0, MAX_LEN), { disable_notification: true })
      );
    }
  }
}

function splitTextSmart(text, maxLen) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf("\n\n", maxLen);
    if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf(". ", maxLen);
    if (splitAt < maxLen * 0.3) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function buildTracking(ctx, feature) {
  return {
    userId: String(ctx.from.id),
    chatId: ctx.chat.id,
    username: ctx.from.username ? `@${ctx.from.username}` : null,
    operationType: "chat",
    feature,
    user: {
      name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || undefined,
      role: "student",
    },
  };
}

// ── Handle a batch of AI media (photos/documents grouped together) ──

async function handleAiBatch(ctx, items, caption) {
  if (!checkRateLimit(ctx.from.id)) {
    return trackSend(ctx, () =>
      ctx.reply("Слишком много запросов. Подождите минуту.", {
        disable_notification: !isPrivate(ctx),
      })
    );
  }

  const hasImages = items.some((i) => i.type === "photo" || (i.mimeType && i.mimeType.startsWith("image/")));
  const thinkingText = hasImages
    ? `🖼 Анализирую ${items.length > 1 ? items.length + " файлов" : "изображение"}...`
    : `📄 Обрабатываю ${items.length > 1 ? items.length + " файлов" : "файл"}...`;

  const thinking = await trackSend(ctx, () =>
    ctx.reply(thinkingText, { disable_notification: !isPrivate(ctx) })
  );

  try {
    const history = await ChatHistory.findOne({ telegramUserId: ctx.from.id });
    const recentMessages = (history?.messages || [])
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));

    // Check if user wants to attach (not analyze)
    const attachPattern = /прикреп|закин|добав.*(?:файл|фото|к задан|к ответ|к решени)|к условию|как ответ|как решение/i;
    const wantsAttach = attachPattern.test(caption) ||
      recentMessages.slice(-2).some((m) => m.role === "user" && attachPattern.test(m.content));

    // Build metadata for all files
    const metaParts = items.map((item) => {
      if (item.type === "photo") {
        return `[Прикреплённое фото — Telegram file_id: ${item.fileId}, тип: photo]`;
      }
      return `[Прикреплённый файл — Telegram file_id: ${item.fileId}, тип: document, имя: ${item.fileName || "file"}]`;
    });
    const allMeta = "\n\n" + metaParts.join("\n");

    const tracking = buildTracking(ctx, wantsAttach ? "bot-chat-media-attach" : "bot-chat-media");
    let result;

    if (wantsAttach) {
      const query = caption ? `${caption}${allMeta}` : `Пользователь прислал ${items.length} файлов.${allMeta}`;
      result = await processQuery(query, recentMessages, tracking);
    } else {
      const imageBuffers = [];
      const nonImageMeta = [];

      await Promise.all(items.map(async (item) => {
        const isImage = item.type === "photo" || (item.mimeType && item.mimeType.startsWith("image/"));
        if (isImage) {
          const buffer = await downloadFile(ctx, item.fileId);
          imageBuffers.push({ buffer, mimeType: item.mimeType || "image/jpeg" });
        } else {
          nonImageMeta.push(`[Прикреплённый файл — Telegram file_id: ${item.fileId}, тип: document, имя: ${item.fileName || "file"}]`);
        }
      }));

      const queryText = (caption || "") + (nonImageMeta.length ? "\n\n" + nonImageMeta.join("\n") : "") + allMeta;

      if (imageBuffers.length > 1) {
        // processQueryMultiImage returns plain text (no extraHistoryContext)
        const text = await processQueryMultiImage(queryText, recentMessages, tracking, imageBuffers);
        result = { text, extraHistoryContext: "" };
      } else if (imageBuffers.length === 1) {
        result = await processQuery(queryText, recentMessages, tracking, imageBuffers[0]);
      } else {
        result = await processQuery(queryText, recentMessages, tracking);
      }
    }

    const replyText = result.text || "Действие выполнено, но AI не сгенерировал ответ. Попробуйте переспросить.";
    await sendLongResponse(ctx, thinking.message_id, replyText);

    inputState.set(ctx.from.id, { mode: "ai_chat" });

    // Save history
    const historyContent = caption
      ? `${caption}${allMeta}`
      : `Пользователь прислал ${items.length} файлов.${allMeta}`;
    await ChatHistory.findOneAndUpdate(
      { telegramUserId: ctx.from.id },
      {
        $push: {
          messages: {
            $each: [
              { role: "user", content: historyContent + (result.extraHistoryContext || "") },
              { role: "assistant", content: replyText },
            ],
            $slice: -50,
          },
        },
      },
      { upsert: true }
    ).catch((e) => console.error("[ai media batch] history save error:", e.message));
  } catch (e) {
    console.error("[ai media batch] error:", e);
    await ctx.telegram
      .editMessageText(ctx.chat.id, thinking.message_id, null, "Ошибка обработки. Попробуйте позже.")
      .catch(() => {});
  }
}

// ── Handle single AI document (no media group) ──

async function handleAiDocument(ctx) {
  const doc = ctx.message.document;
  if (!doc) return;
  const item = {
    type: "document",
    fileId: doc.file_id,
    mimeType: doc.mime_type || "application/octet-stream",
    fileName: doc.file_name || "file",
  };
  await handleAiBatch(ctx, [item], ctx.message.caption || "");
}

// ── Handle single AI photo (no media group) ──

async function handleAiPhoto(ctx) {
  const photo = ctx.message.photo;
  if (!photo || !photo.length) return;
  const item = {
    type: "photo",
    fileId: photo[photo.length - 1].file_id,
    mimeType: "image/jpeg",
  };
  await handleAiBatch(ctx, [item], ctx.message.caption || "");
}

function mediaHandler(bot) {
  // ── DOCUMENT handler ──
  bot.on("document", async (ctx) => {
    const aiState = inputState.get(ctx.from.id);
    const isAiReply = !aiState && ctx.message.reply_to_message?.from?.id === ctx.botInfo.id;
    const isAiChat = aiState?.mode === "ai_chat";

    if ((isAiReply || isAiChat) && (await isStudent(ctx))) {
      const mediaGroupId = ctx.message.media_group_id;

      if (mediaGroupId) {
        const doc = ctx.message.document;
        const item = {
          type: "document",
          fileId: doc.file_id,
          mimeType: doc.mime_type || "application/octet-stream",
          fileName: doc.file_name || "file",
        };
        const batchPromise = collectMediaGroup(mediaGroupId, item, ctx.message.caption);
        if (batchPromise) {
          const batch = await batchPromise;
          await handleAiBatch(ctx, batch.items, batch.caption);
        }
      } else {
        await handleAiDocument(ctx);
      }
      return;
    }

    const state = inputState.get(ctx.from.id);
    if (!state) return;
    try {
      if (state.mode === "collect_hw") {
        const file_id = ctx.message.document.file_id;
        state.attachments.push({ type: "document", file_id });
        const caption = ctx.message.caption;
        if (caption) state.messages.push(caption);
        inputState.set(ctx.from.id, state);
        await updateCollectMessage(ctx, state);
        return;
      }
      if (state.step === "attachments") {
        const file_id = ctx.message.document.file_id;
        state.attachments.push({ type: "document", file_id });
        await trackSend(ctx, () =>
          ctx.reply("✅ Файл добавлен. Можете добавить ещё или нажмите '✅ Готово'.", {
            disable_notification: !isPrivate(ctx),
          })
        );
      }
      if (state.mode === "add_answer" && state.step === "answer") {
        const file_id = ctx.message.document.file_id;
        state.answers.push({ type: "document", file_id });
        await trackSend(ctx, () =>
          ctx.reply("✅ Файл добавлен. Добавьте ещё или нажмите Готово.", {
            disable_notification: !isPrivate(ctx),
          })
        );
      }
    } catch (e) {
      console.error("[document handler error]", e);
    } finally {
      await deleteUserMsg(ctx);
    }
  });

  // ── PHOTO handler ──
  bot.on("photo", async (ctx) => {
    const aiState = inputState.get(ctx.from.id);
    const isAiReply = !aiState && ctx.message.reply_to_message?.from?.id === ctx.botInfo.id;
    const isAiChat = aiState?.mode === "ai_chat";

    if ((isAiReply || isAiChat) && (await isStudent(ctx))) {
      const mediaGroupId = ctx.message.media_group_id;

      if (mediaGroupId) {
        const photo = ctx.message.photo;
        if (!photo || !photo.length) return;
        const item = {
          type: "photo",
          fileId: photo[photo.length - 1].file_id,
          mimeType: "image/jpeg",
        };
        const batchPromise = collectMediaGroup(mediaGroupId, item, ctx.message.caption);
        if (batchPromise) {
          const batch = await batchPromise;
          await handleAiBatch(ctx, batch.items, batch.caption);
        }
      } else {
        await handleAiPhoto(ctx);
      }
      return;
    }

    const state = inputState.get(ctx.from.id);
    if (!state) return;
    try {
      if (state.mode === "collect_hw") {
        const photo = ctx.message.photo;
        if (photo && photo.length) {
          const file_id = photo[photo.length - 1].file_id;
          state.attachments.push({ type: "photo", file_id });
          const caption = ctx.message.caption;
          if (caption) state.messages.push(caption);
          inputState.set(ctx.from.id, state);
          await updateCollectMessage(ctx, state);
        }
        return;
      }
      if (state.step === "attachments") {
        const photo = ctx.message.photo;
        if (photo && photo.length) {
          const file_id = photo[photo.length - 1].file_id;
          state.attachments.push({ type: "photo", file_id });
          await trackSend(ctx, () =>
            ctx.reply("✅ Фото добавлено. Можете добавить ещё или нажмите '✅ Готово'.", {
              disable_notification: !isPrivate(ctx),
            })
          );
        }
      }
      if (state.mode === "add_answer" && state.step === "answer") {
        const photo = ctx.message.photo;
        if (photo && photo.length) {
          const file_id = photo[photo.length - 1].file_id;
          state.answers.push({ type: "photo", file_id });
          await trackSend(ctx, () =>
            ctx.reply("✅ Фото добавлено. Добавьте ещё или нажмите Готово.", {
              disable_notification: !isPrivate(ctx),
            })
          );
        }
      }
    } catch (e) {
      console.error("[photo handler error]", e);
    } finally {
      await deleteUserMsg(ctx);
    }
  });

  // Reset input state on non-edit/add/homework callbacks
  bot.on("callback_query", async (ctx) => {
    try {
      const data = ctx.callbackQuery.data;
      if (data && !data.startsWith("e") && !data.startsWith("a") && !data.startsWith("hw_")) {
        inputState.delete(ctx.from.id);
      }
    } catch (e) {
      console.error("[callback_query error]", e);
    }
  });
}

module.exports = mediaHandler;
module.exports.sendLongResponse = sendLongResponse;
