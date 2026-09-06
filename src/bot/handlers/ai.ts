import { Context, Telegraf } from "telegraf";
import { isStudent } from "../middleware/auth";
import { trackSend, isPrivate, editOrSend, notice } from "../helpers/editOrSend";
import { processQuery } from "../../services/orchestratorService";
import ChatHistory from "../../models/ChatHistory";
import * as inputState from "../helpers/inputState";
import { checkRateLimit } from "../helpers/rateLimit";

const MAX_HISTORY = 10;

export function mdToHtml(text: string): string {
  // Extract code blocks first to protect them from formatting
  const codeBlocks: string[] = [];
  let html = text.replace(/```[\w]*\n?([\s\S]*?)```/g, (_: string, code: string) => {
    const i = codeBlocks.length;
    codeBlocks.push(code);
    return `\x00CB${i}\x00`;
  });

  // Extract inline code
  const inlineCodes: string[] = [];
  html = html.replace(/`([^`]+)`/g, (_: string, code: string) => {
    const i = inlineCodes.length;
    inlineCodes.push(code);
    return `\x00IC${i}\x00`;
  });

  // Escape HTML entities in remaining text
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Headers: ### ... → bold
  html = html.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // Bold: **...**
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  // Italic: *...*
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");

  // Lists: - item → • item
  html = html.replace(/^[-*]\s+/gm, "• ");

  // Numbered lists: 1. item → 1. item (keep as-is, just ensure no markdown artifacts)
  // Strikethrough: ~~text~~ → <s>text</s>
  html = html.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Links: [text](url) → text (url) — Telegram HTML doesn't support <a> well in all contexts
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // Horizontal rules: --- or *** → empty line
  html = html.replace(/^[-*]{3,}$/gm, "");

  // Restore inline code (escape entities inside)
  html = html.replace(/\x00IC(\d+)\x00/g, (_: string, i: string) => {
    const code = inlineCodes[parseInt(i)].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<code>${code}</code>`;
  });

  // Restore code blocks (escape entities inside)
  html = html.replace(/\x00CB(\d+)\x00/g, (_: string, i: string) => {
    const code = codeBlocks[parseInt(i)].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<pre>${code}</pre>`;
  });

  return html;
}

export function aiHandler(bot: Telegraf): void {
  bot.command("clear", async (ctx: Context) => {
    await ChatHistory.deleteOne({ telegramUserId: ctx.from!.id }).catch(() => {});
    inputState.delete(ctx.from!.id);
    await editOrSend(ctx, "🗑 История AI-чата очищена. Начните новый диалог с /ai или просто напишите.");
  });

  // /ai2 — start AI session (all messages go to AI without reply)
  bot.command("ai2", async (ctx: Context) => {
    if (!(await isStudent(ctx))) {
      return notice(ctx, "Нет доступа к AI.");
    }

    const question = (ctx.message as any).text.replace(/^\/ai2\s*/, "").trim();

    // Activate session
    inputState.set(ctx.from!.id, { mode: "ai_session" });

    if (!question) {
      return editOrSend(ctx, "🤖 AI-сессия запущена. Пишите сообщения и отправляйте файлы — я всё обработаю.\n\nДля выхода: /cancel");
    }

    if (!checkRateLimit(ctx.from!.id)) {
      return notice(ctx, "Слишком много запросов. Подождите минуту.");
    }

    const thinking = await trackSend(ctx, () => ctx.reply("Думаю...") as any);

    try {
      const history = await ChatHistory.findOne({ telegramUserId: ctx.from!.id });
      const recentMessages = (history?.messages || [])
        .slice(-MAX_HISTORY)
        .map((m: any) => ({ role: m.role, content: m.content }));

      const result = await processQuery(question, recentMessages, {
        userId: String(ctx.from!.id),
        chatId: String(ctx.chat!.id),
        username: ctx.from!.username ? `@${ctx.from!.username}` : undefined,
        operationType: "chat",
        feature: "ai-session",
        user: {
          name: [ctx.from!.first_name, ctx.from!.last_name].filter(Boolean).join(" ") || undefined,
          role: "student",
        },
      });
      const replyText = result.text || "Действие выполнено, но AI не сгенерировал ответ. Попробуйте переспросить.";

      const { sendLongResponse } = require("./media");
      await sendLongResponse(ctx, thinking.message_id, replyText);

      await ChatHistory.findOneAndUpdate(
        { telegramUserId: ctx.from!.id },
        {
          $push: {
            messages: {
              $each: [
                { role: "user", content: question + (result.extraHistoryContext || "") },
                { role: "assistant", content: replyText },
              ],
              $slice: -50,
            },
          },
        },
        { upsert: true }
      ).catch((e: Error) =>
        console.error("[ai2 session] history save error:", e.message)
      );
    } catch (e: any) {
      console.error("[ai2 session] error:", e);
      await ctx.telegram
        .editMessageText(ctx.chat!.id, thinking.message_id, null as any, "Ошибка AI. Попробуйте позже.")
        .catch(() => {});
    }
  });

  bot.command("ai", async (ctx: Context) => {
    if (!(await isStudent(ctx))) {
      return notice(ctx, "Нет доступа к AI.");
    }

    if (!checkRateLimit(ctx.from!.id)) {
      return notice(ctx, "Слишком много запросов. Подождите минуту.");
    }

    const question = (ctx.message as any).text.replace(/^\/ai\s*/, "").trim();
    if (!question) {
      return editOrSend(ctx, "Использование: /ai <вопрос>");
    }

    const thinking = await trackSend(ctx, () => ctx.reply("Думаю...") as any);

    try {
      // Load recent history
      const history = await ChatHistory.findOne({
        telegramUserId: ctx.from!.id,
      });
      const recentMessages = (history?.messages || [])
        .slice(-MAX_HISTORY)
        .map((m: any) => ({ role: m.role, content: m.content }));

      // Process through orchestrator (decides if RAG is needed)
      const result = await processQuery(question, recentMessages, {
        userId: String(ctx.from!.id),
        chatId: String(ctx.chat!.id),
        username: ctx.from!.username ? `@${ctx.from!.username}` : undefined,
        operationType: "chat",
        feature: "bot-chat",
        user: {
          name: [ctx.from!.first_name, ctx.from!.last_name].filter(Boolean).join(" ") || undefined,
          role: "student",
        },
      });
      const replyText = result.text || "Действие выполнено, но AI не сгенерировал ответ. Попробуйте переспросить.";

      // Send response (splits long messages automatically)
      const { sendLongResponse } = require("./media");
      await sendLongResponse(ctx, thinking.message_id, replyText);

      // Save to history
      await ChatHistory.findOneAndUpdate(
        { telegramUserId: ctx.from!.id },
        {
          $push: {
            messages: {
              $each: [
                { role: "user", content: question + (result.extraHistoryContext || "") },
                { role: "assistant", content: replyText },
              ],
              $slice: -50,
            },
          },
        },
        { upsert: true }
      ).catch((e: Error) =>
        console.error("[ai bot] history save error:", e.message)
      );

    } catch (e: any) {
      console.error("[ai bot] error:", e);
      await ctx.telegram
        .editMessageText(
          ctx.chat!.id,
          thinking.message_id,
          null as any,
          "Ошибка AI. Попробуйте позже."
        )
        .catch(() => {});
    }
  });
}
