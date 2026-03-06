import { Telegraf } from "telegraf";
import * as scheduleService from "./scheduleService";
import * as subjectService from "./subjectService";
import { ISubject, ITask } from "../models/Subject";

interface DeadlineEntry {
  title: string;
  emoji: string;
  subject: string;
  subjectEmoji: string;
  deadline: Date;
}

interface RecentTaskEntry {
  title: string;
  emoji: string;
  subject: string;
  subjectEmoji: string;
}

let lastDigestDate: string | null = null;

export function startWeeklyDigest(bot: Telegraf): ReturnType<typeof setInterval> | null {
  const interval = setInterval(async () => {
    try {
      const now: Date = new Date();

      // Only Monday at 08:00
      if (now.getDay() !== 1) return;
      if (now.getHours() !== 8 || now.getMinutes() !== 0) return;

      // Prevent duplicate sends within the same day
      const todayStr: string = now.toDateString();
      if (lastDigestDate === todayStr) return;
      lastDigestDate = todayStr;

      const schedule = await scheduleService.get();
      if (!schedule.notificationChatId) return;

      const subjects: ISubject[] = await subjectService.getAll();

      // Collect upcoming deadlines (this week)
      const weekEnd: Date = new Date(now);
      weekEnd.setDate(weekEnd.getDate() + 7);

      const deadlines: DeadlineEntry[] = [];
      const recentTasks: RecentTaskEntry[] = [];
      let totalTasks: number = 0;
      let totalUnsolved: number = 0;

      for (const subject of subjects) {
        for (const task of (subject.tasks || []) as ITask[]) {
          totalTasks++;
          if (!task.aiAnswer) totalUnsolved++;

          // Deadlines this week
          if (task.deadline && task.deadline > now && task.deadline <= weekEnd) {
            deadlines.push({
              title: task.title,
              emoji: task.emoji || "\u{1F4C4}",
              subject: subject.name,
              subjectEmoji: subject.emoji || "\u{1F4DA}",
              deadline: task.deadline,
            });
          }

          // Tasks created in the last week
          if (task.createdAt && task.createdAt > new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)) {
            recentTasks.push({
              title: task.title,
              emoji: task.emoji || "\u{1F4C4}",
              subject: subject.name,
              subjectEmoji: subject.emoji || "\u{1F4DA}",
            });
          }
        }
      }

      // Build digest message
      let text: string = "\u{1F4CB} <b>\u0415\u0436\u0435\u043D\u0435\u0434\u0435\u043B\u044C\u043D\u044B\u0439 \u0434\u0430\u0439\u0434\u0436\u0435\u0441\u0442</b>\n\n";

      if (deadlines.length > 0) {
        deadlines.sort((a: DeadlineEntry, b: DeadlineEntry) => a.deadline.getTime() - b.deadline.getTime());
        text += "\u23F0 <b>\u0414\u0435\u0434\u043B\u0430\u0439\u043D\u044B \u043D\u0430 \u044D\u0442\u043E\u0439 \u043D\u0435\u0434\u0435\u043B\u0435:</b>\n";
        for (const d of deadlines) {
          const dateStr: string = d.deadline.toLocaleDateString("ru-RU", {
            weekday: "short",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          });
          text += `  ${d.emoji} ${d.title} (${d.subjectEmoji} ${d.subject}) \u2014 ${dateStr}\n`;
        }
        text += "\n";
      }

      if (recentTasks.length > 0) {
        text += `\u{1F4DD} <b>\u041D\u043E\u0432\u044B\u0435 \u0437\u0430\u0434\u0430\u043D\u0438\u044F \u0437\u0430 \u043D\u0435\u0434\u0435\u043B\u044E:</b> ${recentTasks.length}\n`;
        for (const t of recentTasks.slice(0, 10)) {
          text += `  ${t.emoji} ${t.title} (${t.subjectEmoji} ${t.subject})\n`;
        }
        if (recentTasks.length > 10) {
          text += `  ... \u0438 \u0435\u0449\u0451 ${recentTasks.length - 10}\n`;
        }
        text += "\n";
      }

      text += `\u{1F4CA} \u0412\u0441\u0435\u0433\u043E \u0437\u0430\u0434\u0430\u043D\u0438\u0439: ${totalTasks} | \u0411\u0435\u0437 AI-\u0440\u0435\u0448\u0435\u043D\u0438\u044F: ${totalUnsolved}`;

      if (deadlines.length === 0 && recentTasks.length === 0 && totalTasks === 0) {
        return; // Nothing to report
      }

      await bot.telegram.sendMessage(schedule.notificationChatId, text, {
        parse_mode: "HTML",
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[weeklyDigest] error:", message);
    }
  }, 60_000);

  interval.unref();
  console.log("[weeklyDigest] started");
  return interval;
}
