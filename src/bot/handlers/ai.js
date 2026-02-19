const { isReviewer } = require("../middleware/auth");
const { trackSend, isPrivate } = require("../helpers/editOrSend");
const { processQuery } = require("../../services/orchestratorService");
const ChatHistory = require("../../models/ChatHistory");
const inputState = require("../helpers/inputState");

function mdToHtml(text) {
  // Escape HTML entities first
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks: ```lang\n...\n```
  html = html.replace(/```[\w]*\n([\s\S]*?)```/g, "<pre>$1</pre>");
  // Inline code: `...`
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Bold: **...**
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  // Italic: *...*
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");

  return html;
}

const MAX_HISTORY = 10;

function aiHandler(bot) {
  bot.command("ai", async (ctx) => {
    if (!(await isReviewer(ctx))) {
      return trackSend(ctx, () =>
        ctx.reply("Нет доступа к AI.", {
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

    const thinking = await ctx.reply("Думаю...", {
      disable_notification: !isPrivate(ctx),
    });

    try {
      // Load recent history
      const history = await ChatHistory.findOne({
        telegramUserId: ctx.from.id,
      });
      const recentMessages = (history?.messages || [])
        .slice(-MAX_HISTORY)
        .map((m) => ({ role: m.role, content: m.content }));

      // Process through orchestrator (decides if RAG is needed)
      const text = await processQuery(question, recentMessages);

      // Edit the "thinking" message with the answer
      const htmlText = mdToHtml(text).slice(0, 4096);
      await ctx.telegram
        .editMessageText(
          ctx.chat.id,
          thinking.message_id,
          null,
          htmlText,
          { parse_mode: "HTML" }
        )
        .catch(() =>
          // Fallback without formatting if parsing fails
          ctx.telegram.editMessageText(
            ctx.chat.id,
            thinking.message_id,
            null,
            text.slice(0, 4096)
          )
        );

      // Save to history
      await ChatHistory.findOneAndUpdate(
        { telegramUserId: ctx.from.id },
        {
          $push: {
            messages: {
              $each: [
                { role: "user", content: question },
                { role: "assistant", content: text },
              ],
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
