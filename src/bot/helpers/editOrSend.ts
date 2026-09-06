import { Context } from "telegraf";
import * as chatMessageService from "../../services/chatMessageService";
import * as mediaCache from "../../services/mediaCacheService";
import * as cards from "../../services/cardService";
import { renderBanner } from "../../services/scheduleImageService";
import * as upload from "../../services/telegramUpload";
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

export type ScreenImage = cards.Card;

const CAPTION_LIMIT = 1024;
const MAX_TRACKED_CHATS = 500;

interface ScreenState {
  id: number;
  kind: "media" | "text";
}

const screens = new Map<number, ScreenState>();

/** answerCbQuery кидає виняток на звичайних повідомленнях, тому питаємо тип. */
async function ack(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery) return;
  await ctx.answerCbQuery().catch(() => {});
}

export function isPrivate(ctx: Context): boolean {
  return ctx.chat !== undefined && ctx.chat.type === "private";
}

function callbackMessage(ctx: Context): any {
  return (ctx.update as any).callback_query?.message;
}

/** Тип повідомлення читаємо з самого апдейта, а не з памʼяті: після гортання
 * вкладень у чаті може лежати документ, і тоді текстом його не відредагувати. */
function kindOf(msg: any): "media" | "text" | null {
  if (!msg) return null;
  if (msg.photo || msg.document || msg.video || msg.animation || msg.audio) return "media";
  if (typeof msg.text === "string") return "text";
  return null;
}

function remember(chatId: number, id: number, kind: "media" | "text"): void {
  screens.set(chatId, { id, kind });
  if (screens.size > MAX_TRACKED_CHATS) {
    screens.delete(screens.keys().next().value as number);
  }
}

function saveInteractiveMessageId(ctx: Context): void {
  const msg = callbackMessage(ctx);
  if (ctx.chat && msg) {
    remember(ctx.chat.id, msg.message_id, kindOf(msg) || "text");
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

function firstLines(text: string): { title: string; subtitle: string } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return { title: lines[0] || "Домашки", subtitle: lines[1] || "" };
}

/** Екран без власної картки отримує шапку із заголовка - медіа є завжди. */
function defaultImage(text: string): ScreenImage {
  const { title, subtitle } = firstLines(text);
  return {
    key: `banner:v1:${mediaCache.hash(title + "|" + subtitle)}`,
    render: () => renderBanner(title, subtitle),
  };
}

async function resolvePhoto(ctx: Context, image: ScreenImage | undefined, text: string): Promise<cards.Resolved> {
  return cards.resolve(token(ctx), image ?? defaultImage(text));
}

function token(ctx: Context): string {
  return (ctx.telegram as unknown as { token: string }).token;
}

function notModified(err: TelegramError): boolean {
  return !!err.response && err.response.error_code === 400 && err.response.description.includes("message is not modified");
}

/**
 * Малюємо екран в одному повідомленні: поки воно медіа, кожне натискання
 * редагує його на місці. Текст довший за підпис лишається текстовим.
 */
export async function editOrSend(
  ctx: Context,
  text: string,
  keyboard?: Keyboard,
  image?: ScreenImage
): Promise<void> {
  saveInteractiveMessageId(ctx);
  const chatId = ctx.chat!.id;
  const state = screens.get(chatId);
  const isCallback = !!(ctx.update as any).callback_query;
  const current = kindOf(callbackMessage(ctx)) || state?.kind || null;

  if (text.length <= CAPTION_LIMIT) {
    try {
      await sendMedia(ctx, text, keyboard, image, isCallback && state?.id !== undefined && current === "media" ? state.id : null);
      return;
    } catch (e) {
      console.error("[editOrSend] media screen failed:", (e as Error).message || e);
    }
  }

  await sendText(ctx, text, keyboard, isCallback && state?.id !== undefined && current === "text" ? state.id : null);
}

async function sendMedia(
  ctx: Context,
  text: string,
  keyboard: Keyboard | undefined,
  image: ScreenImage | undefined,
  editId: number | null
): Promise<void> {
  const chatId = ctx.chat!.id;
  const photo = await resolvePhoto(ctx, image, text);
  const caption = text;

  if (editId !== null) {
    try {
      const res =
        typeof photo.media === "string"
          ? await ctx.telegram.editMessageMedia(
              chatId,
              editId,
              undefined,
              { type: "photo", media: photo.media, caption, parse_mode: "HTML" } as any,
              { reply_markup: keyboard?.reply_markup as any }
            )
          : await upload.editMessageMedia(token(ctx), chatId, editId, photo.media, {
              caption,
              replyMarkup: keyboard?.reply_markup,
            });
      remember(chatId, editId, "media");
      await cards.remember(res, photo.pending);
      await ack(ctx);
      return;
    } catch (e) {
      const err = e as TelegramError;
      if (notModified(err)) {
        await ack(ctx);
        return;
      }
      console.error("[editOrSend] editMessageMedia failed:", err.message || err, "- шлемо нове");
    }
  }

  await dropPrevious(ctx);
  const sent = (await trackSend(ctx, () =>
    typeof photo.media === "string"
      ? (ctx.replyWithPhoto(photo.media, {
          caption,
          parse_mode: "HTML",
          disable_notification: !isPrivate(ctx),
          ...(keyboard?.reply_markup ? { reply_markup: keyboard.reply_markup as any } : {}),
        }) as Promise<Message>)
      : (upload.sendPhoto(token(ctx), chatId, photo.media, {
          caption,
          replyMarkup: keyboard?.reply_markup,
          silent: !isPrivate(ctx),
        }) as unknown as Promise<Message>)
  )) as Message;
  remember(chatId, sent.message_id, "media");
  await cards.remember(sent, photo.pending);
  await ack(ctx);
}

async function sendText(
  ctx: Context,
  text: string,
  keyboard: Keyboard | undefined,
  editId: number | null
): Promise<void> {
  const chatId = ctx.chat!.id;

  if (editId !== null) {
    try {
      await ctx.telegram.editMessageText(chatId, editId, undefined, text, {
        parse_mode: "HTML",
        reply_markup: keyboard?.reply_markup as any,
      });
      remember(chatId, editId, "text");
      await ack(ctx);
      return;
    } catch (e) {
      const err = e as TelegramError;
      if (notModified(err)) {
        await ack(ctx);
        return;
      }
      const retryAfter = err.response?.error_code === 429 ? Math.min(err.response.parameters?.retry_after || 1, 5) : 0;
      if (retryAfter) await new Promise((r) => setTimeout(r, retryAfter * 1000));
      console.error("[editOrSend] edit failed:", err.message || err, "- шлемо нове");
    }
  }

  try {
    await dropPrevious(ctx);
    const sent = await trackSend(ctx, () =>
      ctx.reply(text, {
        ...keyboard,
        parse_mode: "HTML",
        disable_notification: !isPrivate(ctx),
      }) as Promise<Message>
    );
    remember(chatId, sent.message_id, "text");
    await ack(ctx);
  } catch (e) {
    console.error("[editOrSend fallback error]", (e as Error).message || e);
  }
}

/** Одне вікно: старий екран прибираємо, щоб у чаті не росла стрічка карток. */
async function dropPrevious(ctx: Context): Promise<void> {
  const chatId = ctx.chat!.id;
  const prev = screens.get(chatId);
  if (!prev) return;
  screens.delete(chatId);
  await ctx.telegram.deleteMessage(chatId, prev.id).catch(() => {});
}
