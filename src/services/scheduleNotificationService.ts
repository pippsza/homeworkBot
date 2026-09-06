import { Telegraf, Markup } from "telegraf";
import * as scheduleService from "./scheduleService";
import * as notifyTargetService from "./notifyTargetService";
import { lessonsFor } from "./dailyDigestService";

const notified = new Set<string>();
let lastCleanup = new Date().toDateString();

export function startScheduleNotifier(bot: Telegraf): ReturnType<typeof setInterval> {
  const interval = setInterval(async () => {
    try {
      const today = new Date().toDateString();
      if (today !== lastCleanup) {
        notified.clear();
        lastCleanup = today;
      }

      const schedule = await scheduleService.get();
      if (!schedule.notificationsEnabled) return;

      const targets = await notifyTargetService.forKind("lessons");
      if (!targets.length) return;

      const now = new Date();
      const minutesBefore = schedule.notifyMinutesBefore || 15;
      const lessons = await lessonsFor(now);

      for (const lesson of lessons) {
        const [h, m] = lesson.startTime.split(":").map(Number);
        const startsAt = new Date(now);
        startsAt.setHours(h, m, 0, 0);
        const diff = (startsAt.getTime() - now.getTime()) / 60000;
        if (diff <= 0 || diff > minutesBefore) continue;

        const key = `${today}_${lesson.slotNumber}`;
        if (notified.has(key)) continue;
        notified.add(key);

        const name = lesson.subject?.name || "Заняття";
        const emoji = lesson.subject?.emoji || "📚";
        const kind = lesson.kind ? ` <i>${lesson.kind}</i>` : "";
        const text =
          `${emoji} <b>${name}</b>${kind}\nпочинається через ${Math.round(diff)} хв\n` +
          `🕐 ${lesson.startTime} — ${lesson.endTime}`;

        // Посилання зберігається в слоті: у лекції і лабораторної воно різне
        const link = lesson.link;
        const extra: any = { parse_mode: "HTML" };
        if (link) {
          extra.reply_markup = Markup.inlineKeyboard([
            [Markup.button.url("🎥 Приєднатися", link)],
          ]).reply_markup;
        }

        for (const t of targets) {
          await bot.telegram.sendMessage(t.chatId, text, extra).catch(() => {});
        }
      }
    } catch (e) {
      console.error("[scheduleNotifier]", e instanceof Error ? e.message : e);
    }
  }, 60_000);

  interval.unref();
  console.log("[scheduleNotifier] started");
  return interval;
}
