import { Telegraf } from "telegraf";
import * as scheduleService from "./scheduleService";
import * as subjectService from "./subjectService";
import * as notifyTargetService from "./notifyTargetService";
import { sendCard } from "./cardService";
import { renderDayCard } from "./scheduleImageService";
import { ISubject, ITask } from "../models/Subject";

const DIGEST_HOUR = 8;
const DIGEST_MINUTE = 30;

let lastSent = "";

export interface DayLesson {
  slotNumber: number;
  startTime: string;
  endTime: string;
  kind: string;
  subject: ISubject | null;
}

export interface DayPlan {
  lessons: DayLesson[];
  dayName: string;
  weekNumber: number;
  odd: boolean;
  /** Субота вчиться за розкладом іншого дня - тут його назва. */
  followsDayName?: string;
  /** Субота без пари в розкладі на цей тиждень. */
  noMapping?: boolean;
}

/** Пари на дату з чергуванням тижнів і суботніми замінами. */
export async function dayPlan(date: Date): Promise<DayPlan> {
  const schedule = await scheduleService.get();
  const jsDay = date.getDay();
  const weekNumber = scheduleService.getWeekNumber(date, schedule.semesterStartDate);
  const odd = scheduleService.isOddWeek(date, schedule.semesterStartDate);
  const head = { dayName: scheduleService.DAY_NAMES[jsDay] || "", weekNumber, odd };

  let targetDay = jsDay;
  let followsDayName: string | undefined;
  if (jsDay === 6) {
    const mapping = (schedule.saturdayMappings || []).find((m) => m.weekNumber === weekNumber);
    if (!mapping) return { ...head, lessons: [], noMapping: true };
    targetDay = mapping.followsDay;
    followsDayName = scheduleService.DAY_NAMES[mapping.followsDay];
  }

  const day = schedule.days.find((d) => d.dayOfWeek === targetDay);
  if (!day) return { ...head, lessons: [], followsDayName };

  const subjects = await subjectService.getAll();
  const byId = new Map(subjects.map((s) => [String(s._id), s]));

  const lessons: DayLesson[] = [];
  for (const slot of day.slots) {
    const id = slot.isAlternating && !odd ? slot.subjectIdEven : slot.subjectId;
    if (!id) continue;
    const time = schedule.timeSlots.find((t) => t.number === slot.slotNumber);
    lessons.push({
      slotNumber: slot.slotNumber,
      startTime: time?.startTime ?? "",
      endTime: time?.endTime ?? "",
      kind: (slot.isAlternating && !odd ? slot.kindEven : slot.kind) || "",
      subject: byId.get(String(id)) ?? null,
    });
  }
  lessons.sort((a, b) => a.slotNumber - b.slotNumber);
  return { ...head, lessons, followsDayName };
}

export async function lessonsFor(date: Date): Promise<DayLesson[]> {
  return (await dayPlan(date)).lessons;
}

function deadlinesWithin(subjects: ISubject[], from: Date, days: number) {
  const until = new Date(from);
  until.setDate(until.getDate() + days);
  const out: { subject: string; title: string; deadline: Date }[] = [];
  for (const s of subjects) {
    for (const t of (s.tasks || []) as ITask[]) {
      if (t.deadline && t.deadline > from && t.deadline <= until) {
        out.push({ subject: s.name, title: t.title, deadline: t.deadline });
      }
    }
  }
  return out.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
}

export async function buildDigest(date: Date): Promise<{ text: string; lessons: DayLesson[] }> {
  const schedule = await scheduleService.get();
  const week = scheduleService.getWeekNumber(date, schedule.semesterStartDate);
  const odd = scheduleService.isOddWeek(date, schedule.semesterStartDate);
  const lessons = await lessonsFor(date);
  const subjects = await subjectService.getAll();

  const dayName = scheduleService.DAY_NAMES[date.getDay()] || "";
  const head = `☀️ <b>${dayName}</b>, тиждень ${week} (${odd ? "непарний" : "парний"})`;

  const body = lessons.length
    ? lessons
        .map((l) => {
          const name = l.subject ? `${l.subject.emoji || "📚"} ${l.subject.name}` : "—";
          const kind = l.kind ? ` <i>${l.kind}</i>` : "";
          return `${l.startTime}–${l.endTime}  ${name}${kind}`;
        })
        .join("\n")
    : "Пар немає 🎉";

  const soon = deadlinesWithin(subjects, date, 3);
  const tail = soon.length
    ? "\n\n⏳ <b>Дедлайни (3 дні)</b>\n" +
      soon
        .map((d) => `• ${d.title} — ${d.subject}, до ${d.deadline.toLocaleDateString("uk-UA")}`)
        .join("\n")
    : "";

  return { text: `${head}\n\n${body}${tail}`, lessons };
}

export function startDailyDigest(bot: Telegraf): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    try {
      const now = new Date();
      if (now.getHours() !== DIGEST_HOUR || now.getMinutes() !== DIGEST_MINUTE) return;

      const stamp = now.toDateString();
      if (lastSent === stamp) return;
      lastSent = stamp;

      const targets = await notifyTargetService.forKind("daily");
      if (!targets.length) return;

      const { text, lessons } = await buildDigest(now);
      // Одну й ту саму картку розсилаємо в усі чати: перший чат її вивантажує,
      // решта беруть file_id з кешу.
      const card = { key: `day:${stamp}`, render: () => renderDayCard(now, lessons) };

      for (const t of targets) {
        await sendCard(bot.telegram, t.chatId, card, { caption: text }).catch(async (e) => {
          console.error("[dailyDigest] card failed:", (e as Error).message);
          await bot.telegram.sendMessage(t.chatId, text, { parse_mode: "HTML" });
        });
      }
    } catch (e) {
      console.error("[dailyDigest]", e);
    }
  }, 60 * 1000);
}
