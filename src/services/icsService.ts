import * as subjectService from "./subjectService";
import * as scheduleService from "./scheduleService";

export interface IcsEvent {
  summary: string;
  start: Date | null;
  cancelled: boolean;
  teamsUrl: string;
  /** 2 = пара через тиждень; так у календарі виражене чергування */
  interval: number;
  weekly: boolean;
}

const JOIN_RE = /https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"'<>\\]+/;
// Викладачі ставлять пари на курси вперед і потім скасовують, тому скасовані
// події беремо до уваги лише щоб їх пропустити.
const CANCELLED_RE = /^(скасовано|отменено|canceled|cancelled)\s*:/i;

function unfold(text: string): string[] {
  // За RFC 5545 продовження рядка починається з пробілу або табуляції.
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (/^[ \t]/.test(raw) && out.length) out[out.length - 1] += raw.slice(1);
    else out.push(raw);
  }
  return out;
}

function unescape(v: string): string {
  return v.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\;/g, ";").replace(/\\\\/g, "\\");
}

function parseDate(value: string): Date | null {
  const m = value.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? "Z" : ""}`;
  const dt = new Date(iso);
  return isNaN(dt.getTime()) ? null : dt;
}

export function parseIcs(text: string): IcsEvent[] {
  const lines = unfold(text);
  const events: IcsEvent[] = [];
  let cur: Record<string, string> | null = null;

  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) cur = {};
    else if (line.startsWith("END:VEVENT")) {
      if (cur) {
        const summary = unescape(cur.SUMMARY || "").trim();
        const blob = `${cur.DESCRIPTION || ""} ${cur["X-MICROSOFT-SKYPETEAMSMEETINGURL"] || ""} ${cur.LOCATION || ""}`;
        const rrule = cur.RRULE || "";
        events.push({
          summary,
          start: parseDate(cur.DTSTART || ""),
          cancelled: (cur.STATUS || "").toUpperCase() === "CANCELLED" || CANCELLED_RE.test(summary),
          teamsUrl: (unescape(blob).match(JOIN_RE) || [""])[0],
          interval: Number((rrule.match(/INTERVAL=(\d+)/) || [])[1] || 1),
          weekly: /FREQ=WEEKLY/.test(rrule),
        });
      }
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        const key = line.slice(0, idx).split(";")[0].toUpperCase();
        cur[key] = line.slice(idx + 1);
      }
    }
  }
  return events;
}

export async function fetchIcs(url: string): Promise<IcsEvent[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ICS ${res.status}`);
  return parseIcs(await res.text());
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, " ").trim();
}

function matches(subject: any, summary: string): boolean {
  const s = norm(summary);
  const keys: string[] = subject.matchKeys || [];
  if (keys.length) return keys.some((k) => s.includes(norm(k)));
  return norm(subject.name).split(" ").filter((w) => w.length > 4).some((k) => s.includes(k));
}

/**
 * Записуємо посилання на пари з календаря. Один предмет може мати кілька
 * серій (лекція і лабораторна йдуть окремими зустрічами з різними
 * посиланнями), тому посилання лягає на слот розкладу, а на предмет
 * потрапляє перше знайдене як запасне.
 */
export async function syncLinks(url: string): Promise<{ matched: number; skipped: number }> {
  const events = (await fetchIcs(url)).filter((e) => !e.cancelled && e.teamsUrl);
  const subjects = await subjectService.getAll();
  const schedule = await scheduleService.get();

  let matched = 0;
  for (const subj of subjects) {
    const hit = events.find((e) => matches(subj, e.summary));
    if (!hit) continue;
    matched++;
    if (!subj.teamsLink) {
      subj.teamsLink = hit.teamsUrl;
      await subj.save();
    }
    // Слоти: беремо подію, що збігається і за днем тижня, і за годиною
    for (const day of schedule.days) {
      for (const slot of day.slots) {
        const time = schedule.timeSlots.find((t) => t.number === slot.slotNumber);
        if (!time) continue;
        const ev = events.find((e) => {
          if (!e.start) return false;
          const sameSubject = matches(subj, e.summary);
          const hh = String(e.start.getHours()).padStart(2, "0");
          const mm = String(e.start.getMinutes()).padStart(2, "0");
          return sameSubject && e.start.getDay() === day.dayOfWeek && `${hh}:${mm}` === time.startTime;
        });
        if (ev && String(slot.subjectId) === String(subj._id)) slot.link = ev.teamsUrl;
      }
    }
  }
  await schedule.save();
  return { matched, skipped: events.length - matched };
}


/**
 * Будуємо розклад із календаря. Він точніший за PDF: пара через тиждень
 * приходить як INTERVAL=2, а дата першого проведення каже, на який тиждень
 * вона припадає.
 */
export async function syncSchedule(url: string): Promise<{ slots: number; unmatched: string[] }> {
  const events = (await fetchIcs(url)).filter((e) => !e.cancelled && e.weekly && e.start);
  const subjects = await subjectService.getAll();
  const schedule = await scheduleService.get();
  const semesterStart = schedule.semesterStartDate;

  const unmatched: string[] = [];
  const byDay = new Map<number, Map<number, any>>();

  for (const ev of events) {
    const subj = subjects.find((x) => matches(x, ev.summary));
    if (!subj) {
      unmatched.push(ev.summary);
      continue;
    }
    const hh = String(ev.start!.getHours()).padStart(2, "0");
    const mm = String(ev.start!.getMinutes()).padStart(2, "0");
    const time = schedule.timeSlots.find((t) => t.startTime === `${hh}:${mm}`);
    if (!time) {
      unmatched.push(`${ev.summary} (${hh}:${mm} поза сіткою)`);
      continue;
    }

    const dow = ev.start!.getDay();
    if (!byDay.has(dow)) byDay.set(dow, new Map());
    const slots = byDay.get(dow)!;
    const kind = /\bЛК\b/.test(ev.summary) ? "ЛК" : /\bЛБ\b/.test(ev.summary) ? "ЛБ" : /\bПЗ\b/.test(ev.summary) ? "ПЗ" : "";
    const odd = scheduleService.isOddWeek(ev.start!, semesterStart);

    const existing = slots.get(time.number) || {
      slotNumber: time.number, subjectId: null, subjectIdEven: null,
      isAlternating: false, kind: "", kindEven: "", link: ev.teamsUrl || "",
    };

    if (ev.interval >= 2) {
      // пара через тиждень: кладемо в ту половину, з якої вона стартувала
      if (odd) { existing.subjectId = subj._id; existing.kind = kind; }
      else { existing.subjectIdEven = subj._id; existing.kindEven = kind; }
      existing.isAlternating = true;
    } else {
      existing.subjectId = subj._id;
      existing.subjectIdEven = subj._id;
      existing.kind = kind;
      existing.kindEven = kind;
      existing.isAlternating = false;
    }
    if (ev.teamsUrl) existing.link = ev.teamsUrl;
    slots.set(time.number, existing);
  }

  let count = 0;
  const days = [...byDay.entries()].map(([dayOfWeek, slots]) => {
    count += slots.size;
    return { dayOfWeek, slots: [...slots.values()].sort((a, b) => a.slotNumber - b.slotNumber) };
  });
  schedule.days = days as any;
  await schedule.save();
  return { slots: count, unmatched };
}
