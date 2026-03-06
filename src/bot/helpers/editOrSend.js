const chatMessageService = require("../../services/chatMessageService");

const MAX_TRACKED_CHATS = 500;
const interactiveMessageId = new Map();

function isPrivate(ctx) {
  return ctx.chat && ctx.chat.type === "private";
}

function saveInteractiveMessageId(ctx) {
  if (ctx.chat && ctx.from && ctx.update && ctx.update.callback_query) {
    interactiveMessageId.set(
      ctx.chat.id,
      ctx.update.callback_query.message.message_id
    );
    if (interactiveMessageId.size > MAX_TRACKED_CHATS) {
      const firstKey = interactiveMessageId.keys().next().value;
      interactiveMessageId.delete(firstKey);
    }
  }
}

async function trackSend(ctx, sendFunc) {
  const sent = await sendFunc();
  await chatMessageService.trackMessage(ctx.chat.id, sent.message_id);
  return sent;
}

async function editOrSend(ctx, text, keyboard) {
  saveInteractiveMessageId(ctx);
  const chatId = ctx.chat.id;
  const msgId = interactiveMessageId.get(chatId);
  const isCallback = !!ctx.update.callback_query;

  try {
    if (isCallback && msgId) {
      console.log("[editOrSend] editing msg", msgId, "in chat", chatId);
      await ctx.telegram.editMessageText(chatId, msgId, undefined, text, {
        parse_mode: "HTML",
        reply_markup: keyboard?.reply_markup,
      });
      await ctx.answerCbQuery().catch(() => {});
    } else {
      console.log("[editOrSend] sending new msg — isCallback:", isCallback, "msgId:", msgId);
      const sent = await trackSend(ctx, () =>
        ctx.reply(text, {
          ...keyboard,
          parse_mode: "HTML",
          disable_notification: !isPrivate(ctx),
        })
      );
      interactiveMessageId.set(chatId, sent.message_id);
    }
  } catch (e) {
    if (
      e.response &&
      e.response.error_code === 400 &&
      e.response.description.includes("message is not modified")
    ) {
      await ctx.answerCbQuery().catch(() => {});
      return;
    }
    console.error("[editOrSend] edit failed:", e.message || e, "— sending new msg");
    if (e.response && e.response.error_code === 429) {
      const retryAfter = Math.min(e.response.parameters?.retry_after || 1, 5);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      // Send new message instead of recursing to avoid infinite loop
      try {
        const sent = await trackSend(ctx, () =>
          ctx.reply(text, {
            ...keyboard,
            parse_mode: "HTML",
            disable_notification: !isPrivate(ctx),
          })
        );
        interactiveMessageId.set(chatId, sent.message_id);
      } catch {}
    } else {
      try {
        const sent = await trackSend(ctx, () =>
          ctx.reply(text, {
            ...keyboard,
            parse_mode: "HTML",
            disable_notification: !isPrivate(ctx),
          })
        );
        interactiveMessageId.set(chatId, sent.message_id);
      } catch (fallbackErr) {
        console.error("[editOrSend fallback error]", fallbackErr.message || fallbackErr);
      }
    }
  }
}

module.exports = { editOrSend, trackSend, isPrivate };
