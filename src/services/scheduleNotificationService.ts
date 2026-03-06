import { Telegraf } from "telegraf";
import * as scheduleService from "./scheduleService";

const notifiedSet: Set<string> = new Set();
let lastCleanupDate: string = new Date().toDateString();

export function startScheduleNotifier(bot: Telegraf): ReturnType<typeof setInterval> | null {
  const interval = setInterval(async () => {
    try {
      // Clear dedup set at midnight
      const today: string = new Date().toDateString();
      if (today !== lastCleanupDate) {
        notifiedSet.clear();
        lastCleanupDate = today;
      }

      const schedule = await scheduleService.get();
      if (!schedule.notificationsEnabled || !schedule.notificationChatId) return;

      const now: Date = new Date();
      const minutesBefore: number = schedule.notifyMinutesBefore || 10;

      const todaySchedule = await scheduleService.getScheduleForDate(now);
      if (!todaySchedule.classes.length) return;

      for (const cls of todaySchedule.classes) {
        const [h, m] = cls.startTime.split(":").map(Number);
        const classTime: Date = new Date(now);
        classTime.setHours(h, m, 0, 0);

        const diffMinutes: number = (classTime.getTime() - now.getTime()) / 60000;

        // Notify if class is within the window and hasn't been notified yet
        if (diffMinutes > 0 && diffMinutes <= minutesBefore) {
          const key: string = `${now.toDateString()}_${cls.slotNumber}`;
          if (notifiedSet.has(key)) continue;
          notifiedSet.add(key);

          const emoji: string = cls.subjectEmoji || "\u{1F4DA}";
          const name: string = cls.subjectName || "\u0417\u0430\u043D\u044F\u0442\u0438\u0435";
          const mins: number = Math.round(diffMinutes);
          const text: string = `${emoji} <b>${name}</b> \u043D\u0430\u0447\u0438\u043D\u0430\u0435\u0442\u0441\u044F \u0447\u0435\u0440\u0435\u0437 ${mins} \u043C\u0438\u043D.\n\u{1F550} ${cls.startTime} \u2014 ${cls.endTime}`;

          await bot.telegram.sendMessage(schedule.notificationChatId, text, {
            parse_mode: "HTML",
          });
        }
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[scheduleNotifier] error:", message);
    }
  }, 60_000);

  interval.unref();
  console.log("[scheduleNotifier] started");
  return interval;
}
