const { trackSend, isPrivate } = require("../helpers/editOrSend");
const inputState = require("../helpers/inputState");
const { updateCollectMessage } = require("./homework");
const { isStudent } = require("../middleware/auth");
const { processQuery } = require("../../services/orchestratorService");
const ChatHistory = require("../../models/ChatHistory");
const { mdToHtml } = require("./ai");
const { parseFile } = require("../../services/chunkingService");

async function deleteUserMsg(ctx) {
  await ctx
    .deleteMessage(ctx.message.message_id)
    .catch((e) => console.error("Delete user msg error", e));
}

async function downloadFile(ctx, fileId) {
  const url = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(url.href);
  const buffer = Buffer.from(await res.arrayBuffer());
  return buffer;
}

async function handleAiDocument(ctx) {
  const doc = ctx.message.document;
  if (!doc) return;

  const caption = ctx.message.caption || "";
  const mimetype = doc.mime_type || "application/octet-stream";
  const filename = doc.file_name || "file";
  const isImage = mimetype.startsWith("image/");

  const thinking = await trackSend(ctx, () =>
    ctx.reply("📄 Анализирую файл...", {
      disable_notification: !isPrivate(ctx),
    })
  );

  try {
    const buffer = await downloadFile(ctx, doc.file_id);

    const history = await ChatHistory.findOne({ telegramUserId: ctx.from.id });
    const recentMessages = (history?.messages || [])
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));

    const tracking = {
      userId: String(ctx.from.id),
      chatId: ctx.chat.id,
      username: ctx.from.username ? `@${ctx.from.username}` : null,
      operationType: "chat",
      feature: isImage ? "bot-chat-vision" : "bot-chat-document",
      user: {
        name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || undefined,
        role: "student",
      },
    };

    const fileMeta = `\n\n[Прикреплённый файл — Telegram file_id: ${doc.file_id}, тип: document, имя: ${filename}]`;

    let text;
    if (isImage) {
      // Image document → vision model
      const query = (caption || "") + fileMeta;
      text = await processQuery(query, recentMessages, tracking, { buffer, mimeType: mimetype });
    } else {
      // PDF/Word/text → try to parse, fallback to metadata-only query
      let parsed = null;
      try {
        parsed = await parseFile(buffer, mimetype, filename);
      } catch {
        // Unsupported format — still send to AI with file metadata so it can attach
      }
      const query = parsed
        ? caption
          ? `${caption}\n\nСодержимое файла "${filename}":\n${parsed}${fileMeta}`
          : `Пользователь прислал файл "${filename}":\n${parsed}${fileMeta}`
        : caption
          ? `${caption}${fileMeta}`
          : `Пользователь прислал файл "${filename}".${fileMeta}`;
      text = await processQuery(query, recentMessages, tracking);
    }

    if (!text) console.warn("[ai document] empty text response — AI may have ended on a tool call without generating text");
    const replyText = text || "Действие выполнено, но AI не сгенерировал ответ. Попробуйте переспросить.";
    const htmlText = mdToHtml(replyText).slice(0, 4096);

    await ctx.telegram
      .editMessageText(ctx.chat.id, thinking.message_id, null, htmlText, {
        parse_mode: "HTML",
      })
      .catch(() =>
        ctx.telegram.editMessageText(
          ctx.chat.id, thinking.message_id, null, replyText.slice(0, 4096)
        )
      );

    inputState.set(ctx.from.id, { mode: "ai_chat" });

    const historyContent = caption ? `[файл: ${filename}] ${caption}` : `[файл: ${filename}]`;
    await ChatHistory.findOneAndUpdate(
      { telegramUserId: ctx.from.id },
      {
        $push: {
          messages: {
            $each: [
              { role: "user", content: historyContent },
              { role: "assistant", content: replyText },
            ],
          },
        },
      },
      { upsert: true }
    ).catch((e) => console.error("[ai document] history save error:", e.message));
  } catch (e) {
    console.error("[ai document] error:", e);
    await ctx.telegram
      .editMessageText(ctx.chat.id, thinking.message_id, null, "Ошибка обработки файла. Попробуйте позже.")
      .catch(() => {});
  }
}

function mediaHandler(bot) {
  bot.on("document", async (ctx) => {
    // AI chat: document as reply to bot OR in ai_chat mode
    const aiState = inputState.get(ctx.from.id);
    const isAiReply =
      !aiState &&
      ctx.message.reply_to_message?.from?.id === ctx.botInfo.id;
    const isAiChat = aiState?.mode === "ai_chat";

    if ((isAiReply || isAiChat) && (await isStudent(ctx))) {
      await handleAiDocument(ctx);
      return;
    }

    const state = inputState.get(ctx.from.id);
    if (!state) return;
    try {
      // Collect documents for homework creation
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
          ctx.reply(
            "✅ Файл добавлен. Можете добавить ещё или нажмите '✅ Готово'.",
            { disable_notification: !isPrivate(ctx) }
          )
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

  bot.on("photo", async (ctx) => {
    // AI vision: photo as reply to bot OR in ai_chat mode
    const aiState = inputState.get(ctx.from.id);
    const isAiReply =
      !aiState &&
      ctx.message.reply_to_message?.from?.id === ctx.botInfo.id;
    const isAiChat = aiState?.mode === "ai_chat";

    if ((isAiReply || isAiChat) && (await isStudent(ctx))) {
      const photo = ctx.message.photo;
      if (!photo || !photo.length) return;

      const fileId = photo[photo.length - 1].file_id;
      const caption = ctx.message.caption || "";
      const photoMeta = `\n\n[Прикреплённое фото — Telegram file_id: ${fileId}, тип: photo]`;

      const thinking = await trackSend(ctx, () =>
        ctx.reply("🖼 Анализирую изображение...", {
          disable_notification: !isPrivate(ctx),
        })
      );

      try {
        const buffer = await downloadFile(ctx, fileId);

        const history = await ChatHistory.findOne({ telegramUserId: ctx.from.id });
        const recentMessages = (history?.messages || [])
          .slice(-10)
          .map((m) => ({ role: m.role, content: m.content }));

        const text = await processQuery(
          (caption || "") + photoMeta,
          recentMessages,
          {
            userId: String(ctx.from.id),
            chatId: ctx.chat.id,
            username: ctx.from.username ? `@${ctx.from.username}` : null,
            operationType: "chat",
            feature: "bot-chat-vision",
            user: {
              name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || undefined,
              role: "student",
            },
          },
          { buffer, mimeType: "image/jpeg" }
        );
        if (!text) console.warn("[ai vision] empty text response — AI may have ended on a tool call without generating text");
        const replyText = text || "Действие выполнено, но AI не сгенерировал ответ. Попробуйте переспросить.";
        const htmlText = mdToHtml(replyText).slice(0, 4096);

        await ctx.telegram
          .editMessageText(ctx.chat.id, thinking.message_id, null, htmlText, {
            parse_mode: "HTML",
          })
          .catch(() =>
            ctx.telegram.editMessageText(
              ctx.chat.id, thinking.message_id, null, replyText.slice(0, 4096)
            )
          );

        inputState.set(ctx.from.id, { mode: "ai_chat" });

        const historyContent = caption ? `[фото] ${caption}` : "[фото]";
        await ChatHistory.findOneAndUpdate(
          { telegramUserId: ctx.from.id },
          {
            $push: {
              messages: {
                $each: [
                  { role: "user", content: historyContent },
                  { role: "assistant", content: replyText },
                ],
              },
            },
          },
          { upsert: true }
        ).catch((e) => console.error("[ai vision] history save error:", e.message));
      } catch (e) {
        console.error("[ai vision] error:", e);
        await ctx.telegram
          .editMessageText(ctx.chat.id, thinking.message_id, null, "Ошибка AI. Попробуйте позже.")
          .catch(() => {});
      }
      return;
    }

    const state = inputState.get(ctx.from.id);
    if (!state) return;
    try {
      // Collect photos for homework creation
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
            ctx.reply(
              "✅ Фото добавлено. Можете добавить ещё или нажмите '✅ Готово'.",
              { disable_notification: !isPrivate(ctx) }
            )
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
