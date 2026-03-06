import { Telegraf } from "telegraf";
import * as scheduleService from "./scheduleService";
import * as subjectService from "./subjectService";
import { ISubject, ITask } from "../models/Subject";

interface Threshold {
  hours: number;
  label: string;
  key: string;
}

const notifiedSet: Set<string> = new Set();
let lastCleanupDate: string = new Date().toDateString();

export function startDeadlineNotifier(bot: Telegraf): ReturnType<typeof setInterval> | null {
  const interval = setInterval(async () => {
    try {
      // Clear dedup set at midnight
      const today: string = new Date().toDateString();
      if (today !== lastCleanupDate) {
        notifiedSet.clear();
        lastCleanupDate = today;
      }

      const schedule = await scheduleService.get();
      if (!schedule.notificationChatId) return;

      const now: Date = new Date();
      const subjects: ISubject[] = await subjectService.getAll();

      for (const subject of subjects) {
        for (const task of (subject.tasks || []) as ITask[]) {
          if (!task.deadline) continue;

          const diffMs: number = task.deadline.getTime() - now.getTime();
          if (diffMs <= 0) continue; // already past

          const diffHours: number = diffMs / (1000 * 60 * 60);

          // Notify at 24h and 1h before deadline
          const thresholds: Threshold[] = [
            { hours: 24, label: "24 \u0447\u0430\u0441\u0430", key: "24h" },
            { hours: 1, label: "1 \u0447\u0430\u0441", key: "1h" },
          ];

          for (const { hours, label, key } of thresholds) {
            if (diffHours <= hours && diffHours > hours - 1) {
              const dedupKey: string = `${today}_${task._id}_${key}`;
              if (notifiedSet.has(dedupKey)) continue;
              notifiedSet.add(dedupKey);

              const emoji: string = task.emoji || "\u{1F4C4}";
              const text: string = `\u23F0 ${emoji} <b>${task.title}</b> (${subject.emoji || "\u{1F4DA}"} ${subject.name}) \u2014 \u0434\u0435\u0434\u043B\u0430\u0439\u043D \u0447\u0435\u0440\u0435\u0437 ${label}`;

              await bot.telegram.sendMessage(schedule.notificationChatId, text, {
                parse_mode: "HTML",
              });
            }
          }
        }
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[deadlineNotifier] error:", message);
    }
  }, 60_000);

  interval.unref();
  console.log("[deadlineNotifier] started");
  return interval;
}
