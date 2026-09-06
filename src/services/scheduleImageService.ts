import { Resvg } from "@resvg/resvg-js";
import type { DayLesson } from "./dailyDigestService";
import * as scheduleService from "./scheduleService";
import * as subjectService from "./subjectService";

const W = 900;
const ROW = 78;
const PAD = 32;

const BG = "#12151c";
const CARD = "#1b2030";
const ACCENT = "#4f8cff";
const TEXT = "#eef2ff";
const MUTED = "#8b95ad";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function toPng(svg: string): Buffer {
  // Шрифти беремо з системи образу; без них кирилиця рендериться порожніми
  // прямокутниками, тому у Dockerfile ставимо fonts-dejavu.
  const r = new Resvg(svg, { font: { loadSystemFonts: true }, fitTo: { mode: "width", value: W } });
  return Buffer.from(r.render().asPng());
}

/** Картка одного дня: пари з часом, типом заняття і викладачем. */
export async function renderDayCard(date: Date, lessons: DayLesson[]): Promise<Buffer> {
  const schedule = await scheduleService.get();
  const week = scheduleService.getWeekNumber(date, schedule.semesterStartDate);
  const odd = scheduleService.isOddWeek(date, schedule.semesterStartDate);
  const dayName = scheduleService.DAY_NAMES[date.getDay()] || "";
  const H = PAD * 2 + 96 + Math.max(lessons.length, 1) * ROW;

  const rows = lessons.length
    ? lessons
        .map((l, i) => {
          const y = PAD + 96 + i * ROW;
          const name = l.subject ? l.subject.name : "—";
          const emoji = l.subject?.emoji || "📚";
          const who = l.subject?.practitionerName || l.subject?.lecturerName || "";
          return `
  <rect x="${PAD}" y="${y}" width="${W - PAD * 2}" height="${ROW - 10}" rx="14" fill="${CARD}"/>
  <rect x="${PAD}" y="${y}" width="6" height="${ROW - 10}" rx="3" fill="${ACCENT}"/>
  <text x="${PAD + 24}" y="${y + 28}" fill="${TEXT}" font-size="20" font-family="DejaVu Sans, sans-serif">${esc(l.startTime)}–${esc(l.endTime)}</text>
  <text x="${PAD + 24}" y="${y + 52}" fill="${MUTED}" font-size="15" font-family="DejaVu Sans, sans-serif">${esc(l.kind)}</text>
  <text x="${PAD + 150}" y="${y + 28}" fill="${TEXT}" font-size="21" font-family="DejaVu Sans, sans-serif">${esc(emoji)} ${esc(name)}</text>
  <text x="${PAD + 150}" y="${y + 52}" fill="${MUTED}" font-size="15" font-family="DejaVu Sans, sans-serif">${esc(who)}</text>`;
        })
        .join("")
    : `<text x="${PAD + 24}" y="${PAD + 140}" fill="${MUTED}" font-size="22" font-family="DejaVu Sans, sans-serif">Пар немає</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <text x="${PAD}" y="${PAD + 34}" fill="${TEXT}" font-size="30" font-weight="bold" font-family="DejaVu Sans, sans-serif">${esc(dayName)}</text>
  <text x="${PAD}" y="${PAD + 66}" fill="${MUTED}" font-size="18" font-family="DejaVu Sans, sans-serif">${date.toLocaleDateString("uk-UA")} · тиждень ${week} (${odd ? "непарний" : "парний"})</text>
  ${rows}
</svg>`;
  return toPng(svg);
}

/** Картка всього тижня: п'ять днів колонками, чергування показано підписом. */
export async function renderWeekCard(date: Date): Promise<Buffer> {
  const schedule = await scheduleService.get();
  const subjects = await subjectService.getAll();
  const byId = new Map(subjects.map((s) => [String(s._id), s]));
  const odd = scheduleService.isOddWeek(date, schedule.semesterStartDate);
  const week = scheduleService.getWeekNumber(date, schedule.semesterStartDate);

  const slots = schedule.timeSlots.slice().sort((a, b) => a.number - b.number);
  const days = [1, 2, 3, 4, 5];
  const colW = (W - PAD * 2 - 90) / days.length;
  const rowH = 64;
  const H = PAD * 2 + 90 + slots.length * rowH;

  let cells = "";
  for (const [di, dow] of days.entries()) {
    const x = PAD + 90 + di * colW;
    cells += `<text x="${x + colW / 2}" y="${PAD + 60}" fill="${TEXT}" font-size="17" text-anchor="middle" font-family="DejaVu Sans, sans-serif">${esc(scheduleService.DAY_NAMES[dow])}</text>`;
    const day = schedule.days.find((d) => d.dayOfWeek === dow);
    for (const [si, slot] of slots.entries()) {
      const y = PAD + 90 + si * rowH;
      const found = day?.slots.find((s) => s.slotNumber === slot.number);
      const id = found ? (found.isAlternating && !odd ? found.subjectIdEven : found.subjectId) : null;
      const subj = id ? byId.get(String(id)) : null;
      cells += `<rect x="${x + 4}" y="${y}" width="${colW - 8}" height="${rowH - 8}" rx="10" fill="${subj ? CARD : "#161a26"}"/>`;
      if (subj) {
        const short = subj.name.length > 22 ? subj.name.slice(0, 21) + "…" : subj.name;
        const kind = found && found.isAlternating && !odd ? found.kindEven : found?.kind;
        cells += `<text x="${x + 14}" y="${y + 26}" fill="${TEXT}" font-size="14" font-family="DejaVu Sans, sans-serif">${esc(subj.emoji || "")} ${esc(short)}</text>`;
        cells += `<text x="${x + 14}" y="${y + 46}" fill="${MUTED}" font-size="13" font-family="DejaVu Sans, sans-serif">${esc(kind || "")}</text>`;
      }
    }
  }

  const times = slots
    .map((s, i) => {
      const y = PAD + 90 + i * rowH;
      return `<text x="${PAD}" y="${y + 30}" fill="${MUTED}" font-size="14" font-family="DejaVu Sans, sans-serif">${esc(s.startTime)}</text>`;
    })
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <text x="${PAD}" y="${PAD + 28}" fill="${TEXT}" font-size="26" font-weight="bold" font-family="DejaVu Sans, sans-serif">Розклад · тиждень ${week} (${odd ? "непарний" : "парний"})</text>
  ${times}${cells}
</svg>`;
  return toPng(svg);
}
