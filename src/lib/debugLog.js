const { getBot } = require("./bot");

const ADMIN_USER_ID = 1256707116;

/**
 * Send a debug log message to the admin via Telegram.
 * Silent — never throws, never blocks.
 */
function debugLog(tag, message, extra) {
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
      .catch(() => {});
  } catch {
    // never throw from debug logging
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

module.exports = { debugLog };
