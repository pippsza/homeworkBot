import { Telegraf } from "telegraf";
import * as reminderService from "./reminderService";
import { debugLog } from "../lib/debugLog";

export function startReminderNotifier(bot: Telegraf): ReturnType<typeof setInterval> {
  const interval = setInterval(async () => {
    try {
      const pending = await reminderService.getPending();
      for (const reminder of pending) {
        try {
          const who = reminder.username ? ` (${reminder.username})` : "";
          const text = `🔔 <b>Напоминание</b>${who}:\n${reminder.text}`;
          await bot.telegram.sendMessage(reminder.chatId, text, {
            parse_mode: "HTML",
          });
          await reminderService.markSent(String(reminder._id));
          debugLog("reminder", `Sent: "${reminder.text.slice(0, 50)}" → chat ${reminder.chatId}`);
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          debugLog("reminder-error", `Failed to send reminder ${reminder._id}: ${message}`);
          // Still mark as sent to avoid spam retries on permanent errors
          await reminderService.markSent(String(reminder._id));
        }
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[reminderNotifier] error:", message);
    }
  }, 30_000); // Check every 30 seconds for better accuracy

  interval.unref();
  console.log("[reminderNotifier] started");
  return interval;
}
