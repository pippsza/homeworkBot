import { getBot } from "./bot";

const ADMIN_USER_ID = process.env.ADMIN_TELEGRAM_ID ? Number(process.env.ADMIN_TELEGRAM_ID) : 1256707116;

/**
 * Send a debug log message to the admin via Telegram.
 * Uses plain text (no HTML) to avoid parse errors.
 * Silent — never throws, never blocks.
 */
export function debugLog(tag: string, message: string, extra?: unknown): void {
  try {
    const bot = getBot();
    if (!bot) return;

    let text = `[${tag}] ${String(message)}`;
    if (extra !== undefined) {
      const extraStr = typeof extra === "string" ? extra : JSON.stringify(extra, null, 2);
      text += `\n${extraStr.slice(0, 2500)}`;
    }

    bot.telegram
      .sendMessage(ADMIN_USER_ID, text.slice(0, 4096))
      .catch((err) => console.error("[debugLog] send failed:", err.message));
  } catch {
    // never throw from debug logging
  }
}

export function debugLogStartupTest(): void {
  const bot = getBot();
  console.log("[debugLog] startup test: bot =", bot ? "OK" : "NULL", "adminId =", ADMIN_USER_ID);
  if (bot) {
    bot.telegram
      .sendMessage(ADMIN_USER_ID, "debugLog работает! Бот запущен.")
      .then(() => console.log("[debugLog] startup message sent OK"))
      .catch((err) => console.error("[debugLog] startup message FAILED:", err.message));
  }
}
