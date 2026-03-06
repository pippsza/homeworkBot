import { Context } from "telegraf";
import * as chatMessageService from "../../services/chatMessageService";
import { Message, InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove, ForceReply } from "telegraf/typings/core/types/typegram";

interface TelegramErrorResponse {
  error_code: number;
  description: string;
  parameters?: {
    retry_after?: number;
  };
}

interface TelegramError extends Error {
  response?: TelegramErrorResponse;
}

type ReplyMarkup = InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;

interface Keyboard {
  reply_markup?: ReplyMarkup;
  [key: string]: unknown;
}

const MAX_TRACKED_CHATS = 500;
const interactiveMessageId = new Map<number, number>();

export function isPrivate(ctx: Context): boolean {
  return ctx.chat !== undefined && ctx.chat.type === "private";
}

function saveInteractiveMessageId(ctx: Context): void {
  if (ctx.chat && ctx.from && ctx.update && (ctx.update as any).callback_query) {
    interactiveMessageId.set(
      ctx.chat.id,
      (ctx.update as any).callback_query.message.message_id
    );
    if (interactiveMessageId.size > MAX_TRACKED_CHATS) {
      const firstKey = interactiveMessageId.keys().next().value as number;
      interactiveMessageId.delete(firstKey);
    }
  }
}

export async function trackSend(
  ctx: Context,
  sendFunc: () => Promise<Message>
): Promise<Message> {
  const sent = await sendFunc();
  await chatMessageService.trackMessage(ctx.chat!.id, sent.message_id);
  return sent;
}

export async function editOrSend(
  ctx: Context,
  text: string,
  keyboard?: Keyboard
): Promise<void> {
  saveInteractiveMessageId(ctx);
  const chatId = ctx.chat!.id;
  const msgId = interactiveMessageId.get(chatId);
  const isCallback = !!(ctx.update as any).callback_query;

  try {
    if (isCallback && msgId) {
      console.log("[editOrSend] editing msg", msgId, "in chat", chatId);
      await ctx.telegram.editMessageText(chatId, msgId, undefined, text, {
        parse_mode: "HTML",
        reply_markup: keyboard?.reply_markup as any,
      });
      await ctx.answerCbQuery().catch(() => {});
    } else {
      console.log("[editOrSend] sending new msg — isCallback:", isCallback, "msgId:", msgId);
      const sent = await trackSend(ctx, () =>
        ctx.reply(text, {
          ...keyboard,
          parse_mode: "HTML",
          disable_notification: !isPrivate(ctx),
        }) as Promise<Message>
      );
      interactiveMessageId.set(chatId, sent.message_id);
    }
  } catch (e: unknown) {
    const err = e as TelegramError;
    if (
      err.response &&
      err.response.error_code === 400 &&
      err.response.description.includes("message is not modified")
    ) {
      await ctx.answerCbQuery().catch(() => {});
      return;
    }
    console.error("[editOrSend] edit failed:", err.message || err, "— sending new msg");
    if (err.response && err.response.error_code === 429) {
      const retryAfter = Math.min(err.response.parameters?.retry_after || 1, 5);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      // Send new message instead of recursing to avoid infinite loop
      try {
        const sent = await trackSend(ctx, () =>
          ctx.reply(text, {
            ...keyboard,
            parse_mode: "HTML",
            disable_notification: !isPrivate(ctx),
          }) as Promise<Message>
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
          }) as Promise<Message>
        );
        interactiveMessageId.set(chatId, sent.message_id);
      } catch (fallbackErr: unknown) {
        const fbErr = fallbackErr as Error;
        console.error("[editOrSend fallback error]", fbErr.message || fbErr);
      }
    }
  }
}
