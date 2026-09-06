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
  <text x="${PAD + 205}" y="${y + 28}" fill="${TEXT}" font-size="21" font-family="DejaVu Sans, sans-serif">${esc(emoji)} ${esc(name)}</text>
  <text x="${PAD + 205}" y="${y + 52}" fill="${MUTED}" font-size="15" font-family="DejaVu Sans, sans-serif">${esc(who)}</text>`;
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
        const short = subj.name.length > 15 ? subj.name.slice(0, 14) + "…" : subj.name;
        const kind = found && found.isAlternating && !odd ? found.kindEven : found?.kind;
        cells += `<text x="${x + 14}" y="${y + 26}" fill="${TEXT}" font-size="14" font-family="DejaVu Sans, sans-serif">${esc(short)}</text>`;
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

function wrap(text: string, perLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > perLine) {
      lines.push(cur.trim());
      cur = w;
      if (lines.length === maxLines) break;
    } else {
      cur += " " + w;
    }
  }
  if (lines.length < maxLines && cur.trim()) lines.push(cur.trim());
  return lines;
}

/** Картка предмета: викладачі, умови автомата, посилання. Зручно переслати. */
export async function renderSubjectCard(subjectId: string): Promise<Buffer> {
  const subj = await subjectService.getById(subjectId);
  if (!subj) throw new Error("subject not found");

  const blocks: { label: string; lines: string[] }[] = [];
  const teachers: string[] = [];
  if (subj.lecturerName) teachers.push(`Лектор: ${subj.lecturerName}`);
  if (subj.practitionerName && subj.practitionerName !== subj.lecturerName)
    teachers.push(`Практик: ${subj.practitionerName}`);
  if (teachers.length) blocks.push({ label: "Викладачі", lines: teachers });
  if (subj.autoPass) blocks.push({ label: "Умови автомата", lines: wrap(subj.autoPass, 78, 6) });
  if (subj.practitionerNote) blocks.push({ label: "Про викладача", lines: wrap(subj.practitionerNote, 78, 4) });
  if (subj.notes) blocks.push({ label: "Нюанси", lines: wrap(subj.notes, 78, 5) });

  const tasks = (subj.tasks || []).length;
  const links: string[] = [];
  if (subj.classroomUrl) links.push("Classroom підключено");
  if (subj.telegramChat) links.push(`TG: ${subj.telegramChat}`);
  if (subj.teamsLink) links.push("Teams-посилання збережено");
  if (links.length) blocks.push({ label: "Де матеріали", lines: links });

  let y = PAD + 110;
  let body = "";
  for (const b of blocks) {
    body += `<text x="${PAD}" y="${y}" fill="${ACCENT}" font-size="16" font-family="DejaVu Sans, sans-serif">${esc(b.label)}</text>`;
    y += 26;
    for (const line of b.lines) {
      body += `<text x="${PAD}" y="${y}" fill="${TEXT}" font-size="16" font-family="DejaVu Sans, sans-serif">${esc(line)}</text>`;
      y += 23;
    }
    y += 14;
  }
  const H = y + PAD;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <text x="${PAD}" y="${PAD + 36}" fill="${TEXT}" font-size="28" font-weight="bold" font-family="DejaVu Sans, sans-serif">${esc(subj.emoji || "")} ${esc(subj.name)}</text>
  <text x="${PAD}" y="${PAD + 66}" fill="${MUTED}" font-size="16" font-family="DejaVu Sans, sans-serif">завдань у боті: ${tasks}</text>
  ${body}
</svg>`;
  return toPng(svg);
}

/** Таймлайн дедлайнів: смуга на N днів уперед з мітками робіт. */
export async function renderDeadlineTimeline(from: Date, days: number = 21): Promise<Buffer> {
  const subjects = await subjectService.getAll();
  const until = new Date(from);
  until.setDate(until.getDate() + days);

  const items: { day: number; title: string; subject: string; emoji: string }[] = [];
  for (const s of subjects) {
    for (const t of (s.tasks || []) as any[]) {
      if (!t.deadline) continue;
      const d = new Date(t.deadline);
      if (d < from || d > until) continue;
      const day = Math.round((d.getTime() - from.getTime()) / 86400000);
      items.push({ day, title: t.title, subject: s.name, emoji: s.emoji || "📚" });
    }
  }
  items.sort((a, b) => a.day - b.day);

  const axisY = PAD + 96;
  const left = PAD + 10;
  const right = W - PAD - 10;
  const span = right - left;
  const H = axisY + 60 + Math.max(items.length, 1) * 46 + PAD;

  let ticks = "";
  for (let d = 0; d <= days; d += 7) {
    const x = left + (span * d) / days;
    const date = new Date(from);
    date.setDate(date.getDate() + d);
    ticks += `<line x1="${x}" y1="${axisY - 12}" x2="${x}" y2="${axisY + 12}" stroke="${MUTED}" stroke-width="2"/>`;
    ticks += `<text x="${x}" y="${axisY + 34}" fill="${MUTED}" font-size="14" text-anchor="middle" font-family="DejaVu Sans, sans-serif">${date.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })}</text>`;
  }

  let marks = "";
  let rows = "";
  items.forEach((it, i) => {
    const x = left + (span * it.day) / days;
    const y = axisY + 60 + i * 46;
    marks += `<circle cx="${x}" cy="${axisY}" r="7" fill="${ACCENT}"/>`;
    marks += `<line x1="${x}" y1="${axisY + 7}" x2="${x}" y2="${y - 14}" stroke="${ACCENT}" stroke-width="1.5" opacity="0.5"/>`;
    rows += `<rect x="${PAD}" y="${y - 26}" width="${W - PAD * 2}" height="38" rx="10" fill="${CARD}"/>`;
    rows += `<text x="${PAD + 16}" y="${y}" fill="${TEXT}" font-size="17" font-family="DejaVu Sans, sans-serif">${esc(it.emoji)} ${esc(it.title)} — ${esc(it.subject)}</text>`;
    const d = new Date(from);
    d.setDate(d.getDate() + it.day);
    rows += `<text x="${W - PAD - 16}" y="${y}" fill="${MUTED}" font-size="15" text-anchor="end" font-family="DejaVu Sans, sans-serif">${d.toLocaleDateString("uk-UA")}</text>`;
  });

  const empty = items.length
    ? ""
    : `<text x="${PAD}" y="${axisY + 80}" fill="${MUTED}" font-size="18" font-family="DejaVu Sans, sans-serif">Дедлайнів на найближчі ${days} днів немає</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <text x="${PAD}" y="${PAD + 34}" fill="${TEXT}" font-size="26" font-weight="bold" font-family="DejaVu Sans, sans-serif">Дедлайни на ${days} днів</text>
  <text x="${PAD}" y="${PAD + 62}" fill="${MUTED}" font-size="16" font-family="DejaVu Sans, sans-serif">від ${from.toLocaleDateString("uk-UA")}</text>
  <line x1="${left}" y1="${axisY}" x2="${right}" y2="${axisY}" stroke="${MUTED}" stroke-width="2"/>
  ${ticks}${marks}${rows}${empty}
</svg>`;
  return toPng(svg);
}
