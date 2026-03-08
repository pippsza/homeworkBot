import { getBot } from "./bot";

const ADMIN_USER_ID = process.env.ADMIN_TELEGRAM_ID ? Number(process.env.ADMIN_TELEGRAM_ID) : 1256707116;

// Batch debug messages to avoid Telegram rate limits
let messageBuffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_DELAY = 2000; // 2 seconds

function flushBuffer(): void {
  if (messageBuffer.length === 0) return;
  const text = messageBuffer.join("\n---\n").slice(0, 4096);
  messageBuffer = [];
  flushTimer = null;

  try {
    const bot = getBot();
    if (!bot) return;
    bot.telegram
      .sendMessage(ADMIN_USER_ID, text)
      .catch((err) => console.error("[debugLog] send failed:", err.message));
  } catch {
    // never throw
  }
}

/**
 * Send a debug log message to the admin via Telegram (batched) + console.log.
 * Silent — never throws, never blocks.
 */
export function debugLog(tag: string, message: string, extra?: unknown): void {
  try {
    // Always log to console for docker logs
    const logLine = `[${tag}] ${message}`;
    console.log(logLine);
    if (extra !== undefined) {
      const extraStr = typeof extra === "string" ? extra : JSON.stringify(extra).slice(0, 500);
      console.log(`  ${extraStr}`);
    }

    // Buffer for Telegram (batched to avoid rate limits)
    let entry = logLine;
    if (extra !== undefined) {
      const extraStr = typeof extra === "string" ? extra : JSON.stringify(extra, null, 2);
      entry += `\n${extraStr.slice(0, 800)}`;
    }
    messageBuffer.push(entry);

    // Reset flush timer
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushBuffer, FLUSH_DELAY);
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
