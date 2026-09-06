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
export async function renderDayCard(date: Date, lessons: DayLesson[], note?: string): Promise<Buffer> {
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
  <text x="${PAD + 205}" y="${y + 28}" fill="${TEXT}" font-size="21" font-family="DejaVu Sans, sans-serif">${esc(name)}</text>
  <text x="${PAD + 205}" y="${y + 52}" fill="${MUTED}" font-size="15" font-family="DejaVu Sans, sans-serif">${esc(who)}</text>`;
        })
        .join("")
    : `<text x="${PAD + 24}" y="${PAD + 140}" fill="${MUTED}" font-size="22" font-family="DejaVu Sans, sans-serif">Пар немає</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <text x="${PAD}" y="${PAD + 34}" fill="${TEXT}" font-size="30" font-weight="bold" font-family="DejaVu Sans, sans-serif">${esc(dayName)}</text>
  <text x="${PAD}" y="${PAD + 66}" fill="${MUTED}" font-size="18" font-family="DejaVu Sans, sans-serif">${date.toLocaleDateString("uk-UA")} · тиждень ${week} (${odd ? "непарний" : "парний"})${note ? esc(" · " + note) : ""}</text>
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

/** Картка предмета: викладачі, шкала балів, умови автомата. */
export async function renderSubjectCard(subjectId: string): Promise<Buffer> {
  const subj = await subjectService.getById(subjectId);
  if (!subj) throw new Error("subject not found");

  const bullets = (text: string): string[] =>
    text
      .split(/(?<=\.)\s+(?=[А-ЯІЇЄҐA-Z])/)
      .map((x) => x.trim())
      .filter(Boolean)
      .flatMap((sentence) => wrap(sentence, 68, 4).map((l, i) => (i === 0 ? "• " + l : "   " + l)));

  const grading = (subj as any).grading as { label: string; points: number }[] | undefined;
  const palette = ["#4f8cff", "#4ecdc4", "#ffc857", "#c77dff", "#ff6b6b"];

  let y = PAD + 104;
  let body = "";

  // Шкала: 100 балів у пропорції, підписи під нею
  if (grading && grading.length) {
    const total = grading.reduce((a, g) => a + g.points, 0) || 100;
    const barW = W - PAD * 2;
    const barH = 34;
    body += `<text x="${PAD}" y="${y}" fill="${ACCENT}" font-size="16" font-family="DejaVu Sans, sans-serif">З чого складаються ${total} балів</text>`;
    y += 20;
    let x = PAD;
    grading.forEach((g, i) => {
      const w = (barW * g.points) / total;
      const color = palette[i % palette.length];
      body += `<rect x="${x}" y="${y}" width="${w}" height="${barH}" fill="${color}" ${i === 0 ? 'rx="8"' : ""}/>`;
      if (w > 44)
        body += `<text x="${x + w / 2}" y="${y + 23}" fill="#12151c" font-size="15" font-weight="bold" text-anchor="middle" font-family="DejaVu Sans, sans-serif">${g.points}</text>`;
      x += w;
    });
    y += barH + 24;
    grading.forEach((g, i) => {
      const color = palette[i % palette.length];
      body += `<rect x="${PAD}" y="${y - 12}" width="12" height="12" rx="3" fill="${color}"/>`;
      body += `<text x="${PAD + 22}" y="${y - 1}" fill="${TEXT}" font-size="15" font-family="DejaVu Sans, sans-serif">${esc(g.label)} — ${g.points}</text>`;
      y += 24;
    });
    y += 12;
  }

  const blocks: { label: string; lines: string[] }[] = [];
  const teachers: string[] = [];
  if (subj.lecturerName) teachers.push(`Лектор: ${subj.lecturerName}`);
  if (subj.practitionerName && subj.practitionerName !== subj.lecturerName)
    teachers.push(`Практик: ${subj.practitionerName}`);
  if (teachers.length) blocks.push({ label: "Викладачі", lines: teachers });
  if (subj.autoPass) blocks.push({ label: "Як закрити предмет", lines: bullets(subj.autoPass) });
  if (subj.practitionerNote) blocks.push({ label: "Про викладача", lines: bullets(subj.practitionerNote) });
  if (subj.notes) blocks.push({ label: "Нюанси", lines: bullets(subj.notes) });

  const links: string[] = [];
  if (subj.classroomUrl) links.push("• Classroom підключено");
  if (subj.telegramChat) links.push(`• TG: ${subj.telegramChat}`);
  if (subj.teamsLink) links.push("• Teams-посилання збережено");
  if (links.length) blocks.push({ label: "Де матеріали", lines: links });

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

  const tasks = (subj.tasks || []).length;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <text x="${PAD}" y="${PAD + 36}" fill="${TEXT}" font-size="28" font-weight="bold" font-family="DejaVu Sans, sans-serif">${esc(subj.name)}</text>
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

  const items: { day: number; title: string; subject: string; date: Date }[] = [];
  for (const s of subjects) {
    for (const t of (s.tasks || []) as any[]) {
      if (!t.deadline) continue;
      const d = new Date(t.deadline);
      if (d < from || d > until) continue;
      items.push({
        day: Math.round((d.getTime() - from.getTime()) / 86400000),
        title: t.title,
        subject: s.name,
        date: d,
      });
    }
  }
  items.sort((a, b) => a.day - b.day);

  // Колір за терміновістю: три дні - червоний, тиждень - жовтий, далі синій
  const urgency = (d: number) => (d <= 3 ? "#ff6b6b" : d <= 7 ? "#ffc857" : ACCENT);
  const human = (d: number) => (d === 0 ? "сьогодні" : d === 1 ? "завтра" : `через ${d} дн.`);

  const axisY = PAD + 104;
  const left = PAD + 14;
  const right = W - PAD - 14;
  const span = right - left;
  const rowH = 54;
  const listTop = axisY + 62;
  const H = listTop + Math.max(items.length, 1) * rowH + PAD;

  let ticks = "";
  for (let d = 0; d <= days; d += 7) {
    const x = left + (span * d) / days;
    const date = new Date(from);
    date.setDate(date.getDate() + d);
    ticks += `<line x1="${x}" y1="${axisY - 10}" x2="${x}" y2="${axisY + 10}" stroke="${MUTED}" stroke-width="2"/>`;
    ticks += `<text x="${x}" y="${axisY + 32}" fill="${MUTED}" font-size="14" text-anchor="middle" font-family="DejaVu Sans, sans-serif">${date.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })}</text>`;
  }

  let marks = "";
  let rows = "";
  items.forEach((it, i) => {
    const x = left + (span * it.day) / days;
    const y = listTop + i * rowH;
    const color = urgency(it.day);
    // Номер зв'язує мітку на осі з рядком нижче: лінії між ними перетинались
    // і читались гірше, ніж просто однакова цифра.
    marks += `<circle cx="${x}" cy="${axisY}" r="11" fill="${color}"/>`;
    marks += `<text x="${x}" y="${axisY + 5}" fill="#12151c" font-size="14" font-weight="bold" text-anchor="middle" font-family="DejaVu Sans, sans-serif">${i + 1}</text>`;

    rows += `<rect x="${PAD}" y="${y}" width="${W - PAD * 2}" height="${rowH - 12}" rx="12" fill="${CARD}"/>`;
    rows += `<circle cx="${PAD + 26}" cy="${y + (rowH - 12) / 2}" r="11" fill="${color}"/>`;
    rows += `<text x="${PAD + 26}" y="${y + (rowH - 12) / 2 + 5}" fill="#12151c" font-size="14" font-weight="bold" text-anchor="middle" font-family="DejaVu Sans, sans-serif">${i + 1}</text>`;
    rows += `<text x="${PAD + 52}" y="${y + 22}" fill="${TEXT}" font-size="17" font-family="DejaVu Sans, sans-serif">${esc(it.title)}</text>`;
    rows += `<text x="${PAD + 52}" y="${y + 38}" fill="${MUTED}" font-size="14" font-family="DejaVu Sans, sans-serif">${esc(it.subject)}</text>`;
    rows += `<text x="${W - PAD - 18}" y="${y + 22}" fill="${TEXT}" font-size="15" text-anchor="end" font-family="DejaVu Sans, sans-serif">${it.date.toLocaleDateString("uk-UA")}</text>`;
    rows += `<text x="${W - PAD - 18}" y="${y + 38}" fill="${color}" font-size="14" text-anchor="end" font-family="DejaVu Sans, sans-serif">${human(it.day)}</text>`;
  });

  const empty = items.length
    ? ""
    : `<text x="${PAD}" y="${listTop + 20}" fill="${MUTED}" font-size="18" font-family="DejaVu Sans, sans-serif">Дедлайнів на найближчі ${days} днів немає</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <text x="${PAD}" y="${PAD + 34}" fill="${TEXT}" font-size="26" font-weight="bold" font-family="DejaVu Sans, sans-serif">Дедлайни на ${days} днів</text>
  <text x="${PAD}" y="${PAD + 62}" fill="${MUTED}" font-size="16" font-family="DejaVu Sans, sans-serif">від ${from.toLocaleDateString("uk-UA")}</text>
  <line x1="${left}" y1="${axisY}" x2="${right}" y2="${axisY}" stroke="${MUTED}" stroke-width="2"/>
  ${ticks}${marks}${rows}${empty}
</svg>`;
  return toPng(svg);
}


/** Картка завдання: назва, дедлайн, опис і список вкладень. */
export async function renderTaskCard(subjectName: string, task: any): Promise<Buffer> {
  const left = PAD;
  let y = PAD + 96;
  let body = "";

  if (task.deadline) {
    const d = new Date(task.deadline);
    const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
    const color = days <= 3 ? "#ff6b6b" : days <= 7 ? "#ffc857" : ACCENT;
    const human = days < 0 ? "прострочено" : days === 0 ? "сьогодні" : days === 1 ? "завтра" : `через ${days} дн.`;
    body += `<rect x="${left}" y="${y - 26}" width="${W - PAD * 2}" height="42" rx="10" fill="${CARD}"/>`;
    body += `<circle cx="${left + 24}" cy="${y - 5}" r="9" fill="${color}"/>`;
    body += `<text x="${left + 46}" y="${y}" fill="${TEXT}" font-size="17" font-family="DejaVu Sans, sans-serif">Дедлайн: ${d.toLocaleDateString("uk-UA")} — ${human}</text>`;
    y += 46;
  }

  if (task.description) {
    for (const line of wrap(String(task.description), 74, 8)) {
      body += `<text x="${left}" y="${y}" fill="${TEXT}" font-size="16" font-family="DejaVu Sans, sans-serif">${esc(line)}</text>`;
      y += 23;
    }
    y += 14;
  }

  const atts = task.attachments || [];
  if (atts.length) {
    body += `<text x="${left}" y="${y}" fill="${ACCENT}" font-size="16" font-family="DejaVu Sans, sans-serif">Вкладення: ${atts.length}</text>`;
    y += 26;
    body += `<text x="${left}" y="${y}" fill="${MUTED}" font-size="15" font-family="DejaVu Sans, sans-serif">Гортай кнопками нижче - файли відкриваються тут же</text>`;
    y += 28;
  }

  const answers = task.answers || [];
  if (answers.length) {
    body += `<text x="${left}" y="${y}" fill="${ACCENT}" font-size="16" font-family="DejaVu Sans, sans-serif">Відповіді: ${answers.length}</text>`;
    y += 26;
  }

  const H = Math.max(y + PAD, 220);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <text x="${left}" y="${PAD + 38}" fill="${TEXT}" font-size="27" font-weight="bold" font-family="DejaVu Sans, sans-serif">${esc(task.title)}</text>
  <text x="${left}" y="${PAD + 66}" fill="${MUTED}" font-size="16" font-family="DejaVu Sans, sans-serif">${esc(subjectName)}</text>
  ${body}
</svg>`;
  return toPng(svg);
}

/**
 * Шапка екрана: використовуємо там, де немає власної картки, щоб кожне
 * повідомлення бота лишалось медіа і його можна було редагувати на місці.
 */
export async function renderBanner(title: string, subtitle: string): Promise<Buffer> {
  const H = 260;
  const t = plain(title).slice(0, 42);
  const s = plain(subtitle).slice(0, 64);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${CARD}"/>
      <stop offset="100%" stop-color="#232a3d"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect x="${PAD}" y="${PAD}" width="${W - PAD * 2}" height="${H - PAD * 2}" rx="22" fill="url(#g)"/>
  <rect x="${PAD}" y="${PAD}" width="8" height="${H - PAD * 2}" rx="4" fill="${ACCENT}"/>
  <circle cx="${W - PAD - 60}" cy="${PAD + 60}" r="46" fill="${ACCENT}" opacity="0.12"/>
  <circle cx="${W - PAD - 60}" cy="${PAD + 60}" r="26" fill="${ACCENT}" opacity="0.18"/>
  <text x="${PAD + 44}" y="${PAD + 82}" fill="${TEXT}" font-size="40" font-weight="bold" font-family="DejaVu Sans, sans-serif">${esc(t)}</text>
  <text x="${PAD + 44}" y="${PAD + 122}" fill="${MUTED}" font-size="20" font-family="DejaVu Sans, sans-serif">${esc(s)}</text>
  <text x="${PAD + 44}" y="${H - PAD - 22}" fill="${MUTED}" font-size="15" font-family="DejaVu Sans, sans-serif" opacity="0.7">КН-1124А · помічник з домашками</text>
</svg>`;
  return toPng(svg);
}

/** Емодзі у зображенні не рендеряться шрифтом DejaVu, тому прибираємо їх. */
function plain(s: string): string {
  return s
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Картка предмета для екрана завдань: назва, з чого складаються бали,
 * стрічка дедлайнів і перелік завдань. Підпис під нею лишається коротким,
 * щоб картку не з'їдав текст. Довідка про викладача - за кнопкою «Карткою».
 */
export async function renderSubjectStrip(subjectId: string, showDone = false): Promise<Buffer> {
  const subj = await subjectService.getById(subjectId);
  if (!subj) throw new Error("subject not found");

  const tasks = (subj.tasks || []) as { title: string; deadline?: Date; order?: number; done?: boolean }[];
  const now = new Date();
  const grading = ((subj as any).grading || []) as { label: string; points: number }[];
  const marks = tasks
    .filter((t) => t.deadline)
    .map((t) => ({ title: plain(t.title), date: new Date(t.deadline!), done: showDone && !!t.done }))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 6);

  const inner = W - PAD * 2;
  const left = PAD + 28;
  const right = W - PAD - 28;
  const teacher = subj.practitionerName || subj.lecturerName || "";

  let y = PAD + 52;
  let body = `
  <text x="${left}" y="${y}" fill="${TEXT}" font-size="30" font-weight="bold" font-family="DejaVu Sans, sans-serif">${esc(plain(subj.name).slice(0, 40))}</text>`;
  y += 30;
  const doneCount = showDone ? tasks.filter((t) => t.done).length : 0;
  const sub = [teacher, `${tasks.length} завдань`].filter(Boolean).join(" · ");
  body += `
  <text x="${left}" y="${y}" fill="${MUTED}" font-size="17" font-family="DejaVu Sans, sans-serif">${esc(sub)}</text>`;
  y += 22;

  if (tasks.length && showDone) {
    body += progressBar(doneCount, tasks.length, left, right, y);
    y += 58;
  } else {
    y += 12;
  }

  if (grading.length) {
    body += pointsBar(grading, left, right, y);
    y += 88;
  }
  if (marks.length) {
    body += deadlineRibbon(marks, now, left, right, y);
    y += 90;
  }
  if (tasks.length) {
    const sorted = [...tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    body += taskColumns(sorted, now, left, right, y, showDone);
    y += 26 + Math.ceil(sorted.length / 3) * 26;
  }

  const H = Math.max(150, y + PAD - 12);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect x="${PAD}" y="${PAD}" width="${inner}" height="${H - PAD * 2}" rx="20" fill="${CARD}"/>
  <rect x="${PAD}" y="${PAD}" width="8" height="${H - PAD * 2}" rx="4" fill="${ACCENT}"/>
  ${body}
</svg>`;
  return toPng(svg);
}

/** Перелік завдань у три колонки: показуємо всі, але не тягнемо картку вниз. */
function taskColumns(
  tasks: { title: string; deadline?: Date; done?: boolean }[],
  now: Date,
  left: number,
  right: number,
  y: number,
  showDone = false
): string {
  const cols = 3;
  const colW = (right - left) / cols;
  let out = `
  <text x="${left}" y="${y}" fill="${ACCENT}" font-size="14" font-family="DejaVu Sans, sans-serif">Завдання</text>`;
  tasks.forEach((t, i) => {
    const x = left + (i % cols) * colW;
    const ty = y + 26 + Math.floor(i / cols) * 26;
    const overdue = t.deadline && new Date(t.deadline) < now;
    const done = showDone && t.done;
    const dot = done ? DONE_COLOR : overdue ? "#ff6b6b" : ACCENT;
    out += `
  <circle cx="${x + 4}" cy="${ty - 5}" r="${done ? 5 : 3}" fill="${dot}"/>
  <text x="${x + 16}" y="${ty}" fill="${done ? MUTED : TEXT}" font-size="15" font-family="DejaVu Sans, sans-serif">${esc(plain(t.title).slice(0, 26))}</text>`;
  });
  return out;
}

/** Список предметів картинкою: у підписі його дублювати не треба. */
export async function renderSubjectsList(showDone = false): Promise<Buffer> {
  const subjects = await subjectService.getAll();
  const now = new Date();
  const left = PAD + 28;
  const right = W - PAD - 28;
  const ROWH = 38;

  const rows = subjects
    .map((s: any, i: number) => {
      const y = PAD + 108 + i * ROWH;
      const tasks = (s.tasks || []) as { title: string; deadline?: Date; done?: boolean }[];
      const done = showDone ? tasks.filter((t) => t.done).length : 0;
      const next = tasks
        .filter((t) => t.deadline && new Date(t.deadline) >= now)
        .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime())[0];
      const due = next ? new Date(next.deadline!) : null;
      const days = due ? Math.ceil((due.getTime() - now.getTime()) / 86_400_000) : 0;
      const color = !due ? MUTED : days <= 3 ? "#ff6b6b" : days <= 7 ? "#ffc857" : "#4ecdc4";
      return `
  <circle cx="${left + 5}" cy="${y - 6}" r="5" fill="${color}"/>
  <text x="${left + 22}" y="${y}" fill="${TEXT}" font-size="19" font-family="DejaVu Sans, sans-serif">${esc(plain(s.name).slice(0, 44))}</text>
  <text x="${right}" y="${y}" fill="${MUTED}" font-size="15" text-anchor="end" font-family="DejaVu Sans, sans-serif">${done ? `${done}/` : ""}${tasks.length} завдань${due ? ` · до ${due.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })}` : ""}</text>`;
    })
    .join("");

  const H = PAD * 2 + 108 + Math.max(subjects.length, 1) * ROWH - 12;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect x="${PAD}" y="${PAD}" width="${W - PAD * 2}" height="${H - PAD * 2}" rx="20" fill="${CARD}"/>
  <rect x="${PAD}" y="${PAD}" width="8" height="${H - PAD * 2}" rx="4" fill="${ACCENT}"/>
  <text x="${left}" y="${PAD + 52}" fill="${TEXT}" font-size="30" font-weight="bold" font-family="DejaVu Sans, sans-serif">Предмети</text>
  <text x="${left}" y="${PAD + 82}" fill="${MUTED}" font-size="16" font-family="DejaVu Sans, sans-serif">колір крапки - наскільки близький найближчий дедлайн</text>
  ${rows}
</svg>`;
  return toPng(svg);
}

const DONE_COLOR = "#3ddc84";

/** Скільки робіт здано: рахуємо за відміткою, а не за пройденими дедлайнами. */
function progressBar(done: number, total: number, left: number, right: number, y: number): string {
  const w = right - left;
  const filled = total ? (w * done) / total : 0;
  return `
  <rect x="${left}" y="${y}" width="${w}" height="8" rx="4" fill="#2b3345"/>
  <rect x="${left}" y="${y}" width="${filled}" height="8" rx="4" fill="${DONE_COLOR}"/>
  <text x="${left}" y="${y + 30}" fill="${done ? DONE_COLOR : MUTED}" font-size="15" font-family="DejaVu Sans, sans-serif">здано ${done} з ${total}</text>`;
}

const GRADE_COLORS = ["#4f8cff", "#4ecdc4", "#ffc857", "#c77dff", "#ff6b6b"];

/** Смуга «з чого складаються 100 балів» плюс однорядковий підпис. */
function pointsBar(
  grading: { label: string; points: number }[],
  left: number,
  right: number,
  y: number
): string {
  const total = grading.reduce((a, g) => a + g.points, 0) || 100;
  const barW = right - left;
  const barH = 26;
  let x = left;
  let out = `
  <text x="${left}" y="${y}" fill="${ACCENT}" font-size="14" font-family="DejaVu Sans, sans-serif">${total} балів</text>`;
  grading.forEach((g, i) => {
    const w = (barW * g.points) / total;
    out += `
  <rect x="${x}" y="${y + 12}" width="${Math.max(w - 3, 2)}" height="${barH}" rx="6" fill="${GRADE_COLORS[i % GRADE_COLORS.length]}"/>`;
    if (w > 40)
      out += `
  <text x="${x + w / 2 - 1}" y="${y + 31}" fill="#12151c" font-size="14" font-weight="bold" text-anchor="middle" font-family="DejaVu Sans, sans-serif">${g.points}</text>`;
    x += w;
  });
  const legend = grading.map((g) => `${plain(g.label)} ${g.points}`).join("  ·  ");
  out += `
  <text x="${left}" y="${y + 58}" fill="${MUTED}" font-size="14" font-family="DejaVu Sans, sans-serif">${esc(legend.slice(0, 110))}</text>`;
  return out;
}

/**
 * Стрічка дедлайнів: вісь від сьогодні до останнього терміну, зафарбована
 * частина - те, що вже минуло. Підписи чергуємо через рядок, щоб сусідні
 * дати не наїжджали одна на одну.
 */
function deadlineRibbon(
  marks: { title: string; date: Date; done?: boolean }[],
  now: Date,
  left: number,
  right: number,
  y: number
): string {
  const from = Math.min(now.getTime(), marks[0].date.getTime());
  const to = Math.max(marks[marks.length - 1].date.getTime(), from + 86_400_000);
  const at = (t: number) => left + ((right - left) * (t - from)) / (to - from);
  const today = at(now.getTime());

  let out = `
  <text x="${left}" y="${y}" fill="${ACCENT}" font-size="14" font-family="DejaVu Sans, sans-serif">Дедлайни</text>
  <rect x="${left}" y="${y + 22}" width="${right - left}" height="4" rx="2" fill="#2b3345"/>
  <rect x="${left}" y="${y + 22}" width="${Math.max(today - left, 0)}" height="4" rx="2" fill="${ACCENT}" opacity="0.55"/>`;

  marks.forEach((m, i) => {
    const x = at(m.date.getTime());
    const past = m.date.getTime() < now.getTime();
    const days = Math.ceil((m.date.getTime() - now.getTime()) / 86_400_000);
    const color = m.done ? DONE_COLOR : past ? MUTED : days <= 3 ? "#ff6b6b" : days <= 7 ? "#ffc857" : "#4ecdc4";
    const ty = y + (i % 2 === 0 ? 48 : 66);
    const anchor = x > right - 90 ? "end" : x < left + 60 ? "start" : "middle";
    out += `
  <circle cx="${x}" cy="${y + 24}" r="7" fill="${color}"/>
  <text x="${x}" y="${ty}" fill="${past || m.done ? MUTED : TEXT}" font-size="13" text-anchor="${anchor}" font-family="DejaVu Sans, sans-serif">${esc(m.date.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" }))} ${esc(m.title.slice(0, 16))}</text>`;
  });
  return out;
}
