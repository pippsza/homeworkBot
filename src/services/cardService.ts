import * as mediaCache from "./mediaCacheService";
import * as upload from "./telegramUpload";

/** Картинка екрана. `key` описує вміст: поки він той самий, беремо file_id з кешу. */
export interface Card {
  key?: string;
  render: () => Promise<Buffer>;
}

export interface Resolved {
  /** Готовий file_id або ще не вивантажений PNG. */
  media: string | Buffer;
  /** Ключі, під якими треба зберегти file_id після вивантаження. */
  pending: string[];
}

/** file_id живе в межах одного бота, тому ключ починається з його id. */
function botId(token: string): string {
  return token.split(":")[0];
}

/**
 * Спершу шукаємо в кеші за ключем вмісту, потім - за хешем намальованого PNG.
 * Другий рівень рятує, коли ключа немає або він змінився, а картинка та сама:
 * малюнок дешевий, а вивантаження - ні.
 */
export async function resolve(token: string, card: Card): Promise<Resolved> {
  const prefix = botId(token);
  const contentKey = card.key ? `${prefix}:${card.key}` : null;
  if (contentKey) {
    const hit = await mediaCache.get(contentKey);
    if (hit) return { media: hit, pending: [] };
  }

  const png = await card.render();
  const pngKey = `${prefix}:png:${mediaCache.hash(png)}`;
  const keys = contentKey ? [contentKey, pngKey] : [pngKey];

  const hit = await mediaCache.get(pngKey);
  if (hit) {
    await Promise.all(keys.map((k) => mediaCache.put(k, hit)));
    return { media: hit, pending: [] };
  }

  return { media: png, pending: keys };
}

export function photoId(msg: unknown): string | null {
  const photo = (msg as { photo?: { file_id: string }[] } | null)?.photo;
  return Array.isArray(photo) && photo.length ? photo[photo.length - 1].file_id : null;
}

/** Запамʼятовуємо file_id щойно вивантаженої картинки. */
export async function remember(msg: unknown, pending: string[]): Promise<void> {
  if (!pending.length) return;
  const id = photoId(msg);
  if (!id) return;
  await Promise.all(pending.map((k) => mediaCache.put(k, id)));
}

/** Розсилка картки в чат: file_id - через звичайний API, новий PNG - вивантаженням. */
export interface TelegramLike {
  token: string;
  sendPhoto: (chat: number | string, photo: any, extra?: any) => Promise<unknown>;
}

export async function sendCard(
  telegram: TelegramLike,
  chatId: number | string,
  card: Card,
  extra: { caption?: string; replyMarkup?: unknown; silent?: boolean } = {}
): Promise<unknown> {
  const token = telegram.token;
  const photo = await resolve(token, card);

  const sent =
    typeof photo.media === "string"
      ? await telegram.sendPhoto(chatId, photo.media, {
          ...(extra.caption ? { caption: extra.caption, parse_mode: "HTML" } : {}),
          ...(extra.replyMarkup ? { reply_markup: extra.replyMarkup } : {}),
          ...(extra.silent ? { disable_notification: true } : {}),
        })
      : await upload.sendPhoto(token, Number(chatId), photo.media, extra);

  await remember(sent, photo.pending);
  return sent;
}
