import { Telegraf } from "telegraf";
import * as subjectService from "./subjectService";
import * as notifyTargetService from "./notifyTargetService";
import { sendCard } from "./cardService";
import { renderDeadlineTimeline } from "./scheduleImageService";
import { ISubject, ITask } from "../models/Subject";
import { daysUntil, humanDays } from "../lib/days";

const DIGEST_HOUR = 13;
const DIGEST_MINUTE = 0;
/** Скільки днів уперед показуємо: далі за два тижні нагадувати ще рано. */
const HORIZON_DAYS = 14;
const CAPTION_LIMIT = 1024;

let lastSent = "";

interface Item {
  subject: string;
  emoji: string;
  title: string;
  deadline: Date;
}

function collect(subjects: ISubject[], now: Date): { overdue: Item[]; today: Item[]; next: Item[] } {
  const until = new Date(now);
  until.setDate(until.getDate() + HORIZON_DAYS);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const overdue: Item[] = [];
  const today: Item[] = [];
  const next: Item[] = [];

  for (const s of subjects) {
    for (const t of (s.tasks || []) as ITask[]) {
      // Відмітка «здано» особиста, а розсилка спільна - тут її не враховуємо
      if (!t.deadline) continue;
      const item: Item = { subject: s.name, emoji: t.emoji || "📄", title: t.title, deadline: t.deadline };
      if (t.deadline < now) overdue.push(item);
      else if (t.deadline <= endOfDay) today.push(item);
      else if (t.deadline <= until) next.push(item);
    }
  }
  const byDate = (a: Item, b: Item) => a.deadline.getTime() - b.deadline.getTime();
  return { overdue: overdue.sort(byDate), today: today.sort(byDate), next: next.sort(byDate) };
}

function short(name: string): string {
  return name.length > 26 ? name.slice(0, 25) + "…" : name;
}

/** Текст обіднього нагадування. Порожній рядок означає «нема про що писати». */
export async function buildDeadlineDigest(now: Date): Promise<string> {
  const { overdue, today, next } = collect(await subjectService.getAll(), now);
  if (!overdue.length && !today.length && !next.length) return "";

  const lines = ["⏳ <b>Дедлайни</b>"];
  const day = (d: Date) => d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" });

  if (overdue.length) {
    lines.push("", "<b>Прострочено</b>");
    for (const i of overdue) lines.push(`• ${i.emoji} ${i.title} · ${short(i.subject)} — ${day(i.deadline)}`);
  }
  if (today.length) {
    lines.push("", "<b>Сьогодні</b>");
    for (const i of today) lines.push(`• ${i.emoji} ${i.title} · ${short(i.subject)}`);
  }
  if (next.length) {
    lines.push("", `<b>Найближчі ${HORIZON_DAYS} днів</b>`);
    for (const i of next) {
      const days = daysUntil(i.deadline, now);
      lines.push(`• ${day(i.deadline)}, ${humanDays(days)} — ${i.emoji} ${i.title} · ${short(i.subject)}`);
    }
  }

  const text = lines.join("\n");
  return text.length <= CAPTION_LIMIT ? text : text.slice(0, CAPTION_LIMIT - 1) + "…";
}

/** Обідній список дедлайнів у чати, де ввімкнено «Дедлайни». */
export function startDeadlineDigest(bot: Telegraf): ReturnType<typeof setInterval> {
  const interval = setInterval(async () => {
    try {
      const now = new Date();
      if (now.getHours() !== DIGEST_HOUR || now.getMinutes() !== DIGEST_MINUTE) return;

      const stamp = now.toDateString();
      if (lastSent === stamp) return;
      lastSent = stamp;

      const targets = await notifyTargetService.forKind("deadlines");
      if (!targets.length) return;

      const text = await buildDeadlineDigest(now);
      // Нема дедлайнів - нема й повідомлення: щоденне «нічого немає» це шум
      if (!text) return;

      const card = { key: `deadlines:${stamp}`, render: () => renderDeadlineTimeline(now, HORIZON_DAYS) };
      for (const t of targets) {
        await sendCard(bot.telegram, t.chatId, card, { caption: text }).catch(async (e) => {
          console.error("[deadlineDigest] card failed:", (e as Error).message);
          await bot.telegram.sendMessage(t.chatId, text, { parse_mode: "HTML" }).catch(() => {});
        });
      }
    } catch (e) {
      console.error("[deadlineDigest]", e);
    }
  }, 60 * 1000);

  interval.unref();
  console.log("[deadlineDigest] started");
  return interval;
}
