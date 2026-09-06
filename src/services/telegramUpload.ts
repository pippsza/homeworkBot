import https from "https";

/**
 * Вивантаження файлів повз telegraf.
 *
 * telegraf шле multipart потоком, без Content-Length, і на цій машині Telegram
 * рве такий запит ("socket hang up") - текстові виклики при цьому проходять.
 * Тому тіло збираємо в памʼяті й ставимо довжину, як це робить curl.
 * Картинки в нас маленькі, тож буфер у памʼяті нічого не коштує.
 */
export interface UploadFile {
  field: string;
  filename: string;
  contentType: string;
  data: Buffer;
}

interface ApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export async function callApi<T = unknown>(
  token: string,
  method: string,
  fields: Record<string, string>,
  file?: UploadFile,
  attempt = 0
): Promise<T> {
  const boundary = `----hwbot${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`
      ),
      file.data,
      Buffer.from("\r\n")
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  try {
    return await post<T>(token, method, boundary, body);
  } catch (e) {
    // Мережевий обрив буває разовим, тому одна повторна спроба.
    if (attempt === 0 && (e as NodeJS.ErrnoException).syscall) {
      return callApi<T>(token, method, fields, file, 1);
    }
    throw e;
  }
}

function post<T>(token: string, method: string, boundary: string, body: Buffer): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: "api.telegram.org",
        path: `/bot${token}/${method}`,
        method: "POST",
        timeout: 60_000,
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": body.length,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          let parsed: ApiResponse<T>;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            return reject(new Error(`${method}: некоректна відповідь (${res.statusCode})`));
          }
          if (parsed.ok && parsed.result !== undefined) return resolve(parsed.result);
          const err = new Error(parsed.description || `${method}: помилка ${res.statusCode}`) as Error & {
            response?: { error_code: number; description: string };
          };
          err.response = { error_code: res.statusCode || 0, description: parsed.description || "" };
          reject(err);
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`${method}: таймаут`)));
    req.on("error", reject);
    req.end(body);
  });
}

export function sendPhoto(
  token: string,
  chatId: number,
  png: Buffer,
  extra: { caption?: string; replyMarkup?: unknown; silent?: boolean }
): Promise<{ message_id: number; photo?: { file_id: string }[] }> {
  const fields: Record<string, string> = { chat_id: String(chatId) };
  if (extra.caption) {
    fields.caption = extra.caption;
    fields.parse_mode = "HTML";
  }
  if (extra.replyMarkup) fields.reply_markup = JSON.stringify(extra.replyMarkup);
  if (extra.silent) fields.disable_notification = "true";
  return callApi(token, "sendPhoto", fields, { field: "photo", filename: "card.png", contentType: "image/png", data: png });
}

export function editMessageMedia(
  token: string,
  chatId: number,
  messageId: number,
  png: Buffer,
  extra: { caption?: string; replyMarkup?: unknown }
): Promise<{ message_id: number; photo?: { file_id: string }[] }> {
  const media: Record<string, unknown> = { type: "photo", media: "attach://card" };
  if (extra.caption) {
    media.caption = extra.caption;
    media.parse_mode = "HTML";
  }
  const fields: Record<string, string> = {
    chat_id: String(chatId),
    message_id: String(messageId),
    media: JSON.stringify(media),
  };
  if (extra.replyMarkup) fields.reply_markup = JSON.stringify(extra.replyMarkup);
  return callApi(token, "editMessageMedia", fields, {
    field: "card",
    filename: "card.png",
    contentType: "image/png",
    data: png,
  });
}
