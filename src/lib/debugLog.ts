import { getBot } from "./bot";

const ADMIN_USER_ID = process.env.ADMIN_TELEGRAM_ID ? Number(process.env.ADMIN_TELEGRAM_ID) : 1256707116;

/**
 * Send a debug log message to the admin via Telegram.
 * Silent — never throws, never blocks.
 */
export function debugLog(tag: string, message: string, extra?: unknown): void {
  try {
    const bot = getBot();
    if (!bot) return;

    let text = `🔧 <b>[${tag}]</b>\n${escapeHtml(String(message))}`;
    if (extra !== undefined) {
      const extraStr = typeof extra === "string" ? extra : JSON.stringify(extra, null, 2);
      text += `\n<pre>${escapeHtml(extraStr.slice(0, 1500))}</pre>`;
    }

    bot.telegram
      .sendMessage(ADMIN_USER_ID, text.slice(0, 4096), { parse_mode: "HTML" })
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
      .sendMessage(ADMIN_USER_ID, "✅ debugLog работает! Бот запущен.", { parse_mode: "HTML" })
      .then(() => console.log("[debugLog] startup message sent OK"))
      .catch((err) => console.error("[debugLog] startup message FAILED:", err.message));
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
