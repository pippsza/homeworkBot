const { isStudent } = require("../middleware/auth");
const { trackSend, isPrivate } = require("../helpers/editOrSend");
const { processQuery } = require("../../services/orchestratorService");
const ChatHistory = require("../../models/ChatHistory");
const inputState = require("../helpers/inputState");
const { checkRateLimit } = require("../helpers/rateLimit");

function mdToHtml(text) {
  // Extract code blocks first to protect them from formatting
  const codeBlocks = [];
  let html = text.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
    const i = codeBlocks.length;
    codeBlocks.push(code);
    return `\x00CB${i}\x00`;
  });

  // Extract inline code
  const inlineCodes = [];
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const i = inlineCodes.length;
    inlineCodes.push(code);
    return `\x00IC${i}\x00`;
  });

  // Escape HTML entities in remaining text
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Bold: **...**
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  // Italic: *...*
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");

  // Restore inline code (escape entities inside)
  html = html.replace(/\x00IC(\d+)\x00/g, (_, i) => {
    const code = inlineCodes[i].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<code>${code}</code>`;
  });

  // Restore code blocks (escape entities inside)
  html = html.replace(/\x00CB(\d+)\x00/g, (_, i) => {
    const code = codeBlocks[i].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<pre>${code}</pre>`;
  });

  return html;
}

const MAX_HISTORY = 10;

function aiHandler(bot) {
  bot.command("clear", async (ctx) => {
    await ChatHistory.deleteOne({ telegramUserId: ctx.from.id }).catch(() => {});
    inputState.delete(ctx.from.id);
    await trackSend(ctx, () =>
      ctx.reply("🗑 История AI-чата очищена. Начните новый диалог с /ai или просто напишите.", {
        disable_notification: !isPrivate(ctx),
      })
    );
  });

  bot.command("ai", async (ctx) => {
    if (!(await isStudent(ctx))) {
      return trackSend(ctx, () =>
        ctx.reply("Нет доступа к AI.", {
          disable_notification: !isPrivate(ctx),
        })
      );
    }

    if (!checkRateLimit(ctx.from.id)) {
      return trackSend(ctx, () =>
        ctx.reply("Слишком много запросов. Подождите минуту.", {
          disable_notification: !isPrivate(ctx),
        })
      );
    }

    const question = ctx.message.text.replace(/^\/ai\s*/, "").trim();
    if (!question) {
      return trackSend(ctx, () =>
        ctx.reply("Использование: /ai <вопрос>", {
          disable_notification: !isPrivate(ctx),
        })
      );
    }

    const thinking = await trackSend(ctx, () =>
      ctx.reply("Думаю...", {
        disable_notification: !isPrivate(ctx),
      })
    );

    try {
      // Load recent history
      const history = await ChatHistory.findOne({
        telegramUserId: ctx.from.id,
      });
      const recentMessages = (history?.messages || [])
        .slice(-MAX_HISTORY)
        .map((m) => ({ role: m.role, content: m.content }));

      // Process through orchestrator (decides if RAG is needed)
      const result = await processQuery(question, recentMessages, {
        userId: String(ctx.from.id),
        chatId: ctx.chat.id,
        username: ctx.from.username ? `@${ctx.from.username}` : null,
        operationType: "chat",
        feature: "bot-chat",
        user: {
          name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || undefined,
          role: "student",
        },
      });
      const replyText = result.text || "Действие выполнено, но AI не сгенерировал ответ. Попробуйте переспросить.";

      // Send response (splits long messages automatically)
      const { sendLongResponse } = require("./media");
      await sendLongResponse(ctx, thinking.message_id, replyText);

      // Save to history
      await ChatHistory.findOneAndUpdate(
        { telegramUserId: ctx.from.id },
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
      ).catch((e) =>
        console.error("[ai bot] history save error:", e.message)
      );

      // Enter ai_chat mode so next messages continue the conversation
      inputState.set(ctx.from.id, { mode: "ai_chat" });
    } catch (e) {
      console.error("[ai bot] error:", e);
      await ctx.telegram
        .editMessageText(
          ctx.chat.id,
          thinking.message_id,
          null,
          "Ошибка AI. Попробуйте позже."
        )
        .catch(() => {});
    }
  });
}

module.exports = aiHandler;
module.exports.mdToHtml = mdToHtml;
