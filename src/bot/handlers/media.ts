import { Context, Telegraf } from "telegraf";
import { trackSend, isPrivate } from "../helpers/editOrSend";
import * as inputState from "../helpers/inputState";
import { updateCollectMessage } from "./homework";
import { isStudent } from "../middleware/auth";
import { processQuery, processQueryMultiImage } from "../../services/orchestratorService";
import ChatHistory from "../../models/ChatHistory";
import { mdToHtml } from "./ai";
import { collect as collectMediaGroup } from "../helpers/mediaGroupCollector";
import { checkRateLimit } from "../helpers/rateLimit";

async function deleteUserMsg(ctx: Context): Promise<void> {
  await ctx
    .deleteMessage((ctx.message as any).message_id)
    .catch((e: Error) => console.error("Delete user msg error", e));
}

async function downloadFile(ctx: Context, fileId: string): Promise<Buffer> {
  const url = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(url.href);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Send a potentially long AI response, splitting into multiple messages if needed.
 * First message edits the "thinking" message; subsequent ones are new messages.
 */
export async function sendLongResponse(ctx: Context, thinkingMsgId: number, replyText: string): Promise<void> {
  const MAX_LEN = 4096;
  if (replyText.length <= MAX_LEN) {
    const htmlText = mdToHtml(replyText);
    await ctx.telegram
      .editMessageText(ctx.chat!.id, thinkingMsgId, null as any, htmlText.slice(0, MAX_LEN), {
        parse_mode: "HTML",
      })
      .catch(() =>
        ctx.telegram.editMessageText(
          ctx.chat!.id, thinkingMsgId, null as any, replyText.slice(0, MAX_LEN)
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
        .editMessageText(ctx.chat!.id, thinkingMsgId, null as any, htmlChunk, {
          parse_mode: "HTML",
        })
        .catch(() =>
          ctx.telegram.editMessageText(
            ctx.chat!.id, thinkingMsgId, null as any, chunk.slice(0, MAX_LEN)
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

function splitTextSmart(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
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

interface TrackingOptions {
  userId: string;
  chatId: string | number;
  username: string | null;
  operationType: string;
  feature: string;
  user: {
    name: string | undefined;
    role: string;
  };
}

function buildTracking(ctx: Context, feature: string): TrackingOptions {
  return {
    userId: String(ctx.from!.id),
    chatId: ctx.chat!.id,
    username: ctx.from!.username ? `@${ctx.from!.username}` : null,
    operationType: "chat",
    feature,
    user: {
      name: [ctx.from!.first_name, ctx.from!.last_name].filter(Boolean).join(" ") || undefined,
      role: "student",
    },
  };
}

interface MediaItem {
  type: "document" | "photo";
  fileId: string;
  mimeType?: string;
  fileName?: string;
}

interface MediaBatch {
  items: MediaItem[];
  caption: string;
}

// ── Handle a batch of AI media (photos/documents grouped together) ──

async function handleAiBatch(ctx: Context, items: MediaItem[], caption: string): Promise<void> {
  if (!checkRateLimit(ctx.from!.id)) {
    await trackSend(ctx, () =>
      ctx.reply("Слишком много запросов. Подождите минуту.", {
        disable_notification: !isPrivate(ctx),
      })
    );
    return;
  }

  const hasImages = items.some((i) => i.type === "photo" || (i.mimeType && i.mimeType.startsWith("image/")));
  const thinkingText = hasImages
    ? `🖼 Анализирую ${items.length > 1 ? items.length + " файлов" : "изображение"}...`
    : `📄 Обрабатываю ${items.length > 1 ? items.length + " файлов" : "файл"}...`;

  const thinking = await trackSend(ctx, () =>
    ctx.reply(thinkingText, { disable_notification: !isPrivate(ctx) })
  );

  try {
    const history = await ChatHistory.findOne({ telegramUserId: ctx.from!.id });
    const recentMessages = (history?.messages || [])
      .slice(-10)
      .map((m: any) => ({ role: m.role, content: m.content }));

    // Check if user wants to attach (not analyze)
    const attachPattern = /прикреп|закин|добав.*(?:файл|фото|к задан|к ответ|к решени)|к условию|как ответ|как решение/i;
    const wantsAttach = attachPattern.test(caption) ||
      recentMessages.slice(-2).some((m: any) => m.role === "user" && attachPattern.test(m.content));

    // Build metadata for all files with short aliases for readability
    const fileList = items.map((item, idx) => {
      const alias = `F${idx + 1}`;
      const name = item.type === "photo" ? "фото" : (item.fileName || "file");
      return { alias, name, type: item.type, fileId: item.fileId };
    });

    // Try to detect numbered file pairs (e.g. "Лаба 1.odt" + "Лаба 1 Ответы.txt")
    const answerPattern = /ответ|відповід|answer|решени/i;
    const groups = new Map<number, { conditions: typeof fileList; answers: typeof fileList }>();
    const ungrouped: typeof fileList = [];
    for (const f of fileList) {
      const numMatch = f.name.match(/(\d+)/);
      if (numMatch) {
        const num = parseInt(numMatch[1]);
        if (!groups.has(num)) groups.set(num, { conditions: [], answers: [] });
        const g = groups.get(num)!;
        if (answerPattern.test(f.name)) g.answers.push(f);
        else g.conditions.push(f);
      } else {
        ungrouped.push(f);
      }
    }

    // Build metadata
    let allMeta: string;
    if (groups.size >= 2) {
      // Structured pairs format — much easier for AI to parse
      const pairLines = [...groups.entries()]
        .sort(([a], [b]) => a - b)
        .map(([num, g]) => {
          const conds = g.conditions.map(f => `${f.alias}(file_id=${f.fileId})`).join(", ");
          const ans = g.answers.map(f => `${f.alias}(file_id=${f.fileId})`).join(", ");
          return `  Задание ${num}: attachments=[${conds}], answers=[${ans}]`;
        });
      const ungroupedLines = ungrouped.map(f => `  Без номера: ${f.alias}="${f.name}" file_id=${f.fileId}`);
      allMeta = `\n\nОбнаружено ${groups.size} пронумерованных заданий:\n${pairLines.join("\n")}${ungroupedLines.length ? "\n" + ungroupedLines.join("\n") : ""}`;
      allMeta += `\n\nИСПОЛЬЗУЙ createHomeworkBatch с ${groups.size} заданиями. Каждое задание = "лаба N". Файлы из attachments → attachments, файлы из answers → answers.`;
    } else {
      // Flat list for small/ungrouped batches
      const idMapping = fileList.map(f =>
        `[${f.alias}: "${f.name}", тип=${f.type}, file_id=${f.fileId}]`
      ).join("\n");
      allMeta = `\n\nФайлов: ${items.length}:\n${idMapping}`;
    }

    const tracking = buildTracking(ctx, wantsAttach ? "bot-chat-media-attach" : "bot-chat-media");
    let result: any;

    if (wantsAttach) {
      const query = caption ? `${caption}${allMeta}` : `Пользователь прислал ${items.length} файлов для прикрепления.${allMeta}`;
      result = await processQuery(query, recentMessages, tracking);
    } else {
      const imageBuffers: { buffer: Buffer; mimeType: string }[] = [];

      await Promise.all(items.map(async (item) => {
        const isImage = item.type === "photo" || (item.mimeType && item.mimeType.startsWith("image/"));
        if (isImage) {
          const buffer = await downloadFile(ctx, item.fileId);
          imageBuffers.push({ buffer, mimeType: item.mimeType || "image/jpeg" });
        }
      }));

      const queryText = (caption || "") + allMeta;

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

    // Save history
    const historyContent = caption
      ? `${caption}${allMeta}`
      : `Пользователь прислал ${items.length} файлов.${allMeta}`;
    await ChatHistory.findOneAndUpdate(
      { telegramUserId: ctx.from!.id },
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
    ).catch((e: Error) => console.error("[ai media batch] history save error:", e.message));
  } catch (e: any) {
    console.error("[ai media batch] error:", e);
    await ctx.telegram
      .editMessageText(ctx.chat!.id, thinking.message_id, null as any, "Ошибка обработки. Попробуйте позже.")
      .catch(() => {});
  }
}

// ── Handle single AI document (no media group) ──

async function handleAiDocument(ctx: Context): Promise<void> {
  const doc = (ctx.message as any).document;
  if (!doc) return;
  const item: MediaItem = {
    type: "document",
    fileId: doc.file_id,
    mimeType: doc.mime_type || "application/octet-stream",
    fileName: doc.file_name || "file",
  };
  await handleAiBatch(ctx, [item], (ctx.message as any).caption || "");
}

// ── Handle single AI photo (no media group) ──

async function handleAiPhoto(ctx: Context): Promise<void> {
  const photo = (ctx.message as any).photo;
  if (!photo || !photo.length) return;
  const item: MediaItem = {
    type: "photo",
    fileId: photo[photo.length - 1].file_id,
    mimeType: "image/jpeg",
  };
  await handleAiBatch(ctx, [item], (ctx.message as any).caption || "");
}

export function mediaHandler(bot: Telegraf): void {
  // ── DOCUMENT handler ──
  bot.on("document", async (ctx: Context) => {
    const docState = inputState.get(ctx.from!.id);
    const isAiSession = docState?.mode === "ai_session";
    const isAiReply = isAiSession || (!docState && (ctx.message as any).reply_to_message?.from?.id === ctx.botInfo.id);

    if (isAiReply && (await isStudent(ctx))) {
      if (isAiSession) inputState.set(ctx.from!.id, { mode: "ai_session" });

      const mediaGroupId = (ctx.message as any).media_group_id;

      if (mediaGroupId) {
        const doc = (ctx.message as any).document;
        const item: MediaItem = {
          type: "document",
          fileId: doc.file_id,
          mimeType: doc.mime_type || "application/octet-stream",
          fileName: doc.file_name || "file",
        };
        const batchPromise = collectMediaGroup(mediaGroupId, item, (ctx.message as any).caption);
        if (batchPromise) {
          const batch: MediaBatch = await batchPromise;
          await handleAiBatch(ctx, batch.items, batch.caption);
        }
      } else {
        await handleAiDocument(ctx);
      }
      return;
    }

    const state = inputState.get(ctx.from!.id);
    if (!state) return;
    try {
      if (state.mode === "collect_hw") {
        const file_id = (ctx.message as any).document.file_id;
        state.attachments.push({ type: "document", file_id });
        const caption = (ctx.message as any).caption;
        if (caption) state.messages.push(caption);
        inputState.set(ctx.from!.id, state);
        await updateCollectMessage(ctx, state);
        return;
      }
      if (state.step === "attachments") {
        const file_id = (ctx.message as any).document.file_id;
        state.attachments.push({ type: "document", file_id });
        await trackSend(ctx, () =>
          ctx.reply("✅ Файл добавлен. Можете добавить ещё или нажмите '✅ Готово'.", {
            disable_notification: !isPrivate(ctx),
          })
        );
      }
      if (state.mode === "add_answer" && state.step === "answer") {
        const file_id = (ctx.message as any).document.file_id;
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
  bot.on("photo", async (ctx: Context) => {
    const photoState = inputState.get(ctx.from!.id);
    const isAiSession = photoState?.mode === "ai_session";
    const isAiReply = isAiSession || (!photoState && (ctx.message as any).reply_to_message?.from?.id === ctx.botInfo.id);

    if (isAiReply && (await isStudent(ctx))) {
      if (isAiSession) inputState.set(ctx.from!.id, { mode: "ai_session" });

      const mediaGroupId = (ctx.message as any).media_group_id;

      if (mediaGroupId) {
        const photo = (ctx.message as any).photo;
        if (!photo || !photo.length) return;
        const item: MediaItem = {
          type: "photo",
          fileId: photo[photo.length - 1].file_id,
          mimeType: "image/jpeg",
        };
        const batchPromise = collectMediaGroup(mediaGroupId, item, (ctx.message as any).caption);
        if (batchPromise) {
          const batch: MediaBatch = await batchPromise;
          await handleAiBatch(ctx, batch.items, batch.caption);
        }
      } else {
        await handleAiPhoto(ctx);
      }
      return;
    }

    const state = inputState.get(ctx.from!.id);
    if (!state) return;
    try {
      if (state.mode === "collect_hw") {
        const photo = (ctx.message as any).photo;
        if (photo && photo.length) {
          const file_id = photo[photo.length - 1].file_id;
          state.attachments.push({ type: "photo", file_id });
          const caption = (ctx.message as any).caption;
          if (caption) state.messages.push(caption);
          inputState.set(ctx.from!.id, state);
          await updateCollectMessage(ctx, state);
        }
        return;
      }
      if (state.step === "attachments") {
        const photo = (ctx.message as any).photo;
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
        const photo = (ctx.message as any).photo;
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
  bot.on("callback_query", async (ctx: Context) => {
    try {
      const data = (ctx.callbackQuery as any).data;
      if (data && !data.startsWith("e") && !data.startsWith("a") && !data.startsWith("hw_")) {
        inputState.delete(ctx.from!.id);
      }
    } catch (e) {
      console.error("[callback_query error]", e);
    }
  });
}
