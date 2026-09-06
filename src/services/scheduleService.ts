import Schedule, { ISchedule, ITimeSlot, IDaySlot, ISaturdayMapping } from "../models/Schedule";
import Subject from "../models/Subject";

export const DAY_NAMES = ["Неділя", "Понеділок", "Вівторок", "Середа", "Четвер", "П'ятниця", "Субота"];

export async function get(): Promise<ISchedule> {
  let doc = await Schedule.findOne({ key: "main" });
  if (!doc) {
    doc = await Schedule.create({ key: "main" });
  }
  return doc;
}

export async function update(data: Partial<ISchedule>): Promise<ISchedule | null> {
  return Schedule.findOneAndUpdate({ key: "main" }, data, {
    upsert: true,
    returnDocument: "after",
  });
}

export async function setTimeSlots(slots: ITimeSlot[]): Promise<ISchedule | null> {
  return Schedule.findOneAndUpdate(
    { key: "main" },
    { timeSlots: slots },
    { upsert: true, returnDocument: "after" }
  );
}

export async function setDaySchedule(dayOfWeek: number, slots: IDaySlot[]): Promise<ISchedule> {
  const doc = await get();
  const idx = doc.days.findIndex((d) => d.dayOfWeek === dayOfWeek);
  if (idx >= 0) {
    doc.days[idx].slots = slots;
  } else {
    doc.days.push({ dayOfWeek, slots });
  }
  return doc.save();
}

export async function setSaturdayMappings(mappings: ISaturdayMapping[]): Promise<ISchedule | null> {
  return Schedule.findOneAndUpdate(
    { key: "main" },
    { saturdayMappings: mappings },
    { upsert: true, returnDocument: "after" }
  );
}

export async function updateConfig(config: Record<string, unknown>): Promise<ISchedule | null> {
  const allowed = ["semesterStartDate", "notificationChatId", "notifyMinutesBefore", "notificationsEnabled"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if ((config as any)[key] !== undefined) updates[key] = (config as any)[key];
  }
  return Schedule.findOneAndUpdate({ key: "main" }, updates, {
    upsert: true,
    returnDocument: "after",
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  d.setHours(12, 0, 0, 0);
  return d;
}

// Рахуємо в днях від понеділка стартового тижня. Опівдні, а не опівночі:
// інакше перехід на зимовий час зсуває різницю на годину і тиждень стрибає.
export function getWeekNumber(date: Date | string, semesterStart: Date | string | null): number {
  if (!semesterStart) return 1;
  const start = toMonday(new Date(semesterStart));
  const current = toMonday(new Date(date));
  const days = Math.round((current.getTime() - start.getTime()) / DAY_MS);
  if (days < 0) return 1;
  return Math.floor(days / 7) + 1;
}

export function isOddWeek(date: Date | string, semesterStart: Date | string | null): boolean {
  return getWeekNumber(date, semesterStart) % 2 === 1;
}

interface ScheduleClass {
  slotNumber: number;
  startTime: string;
  endTime: string;
  subjectId: string;
  isAlternating: boolean;
  subjectName?: string;
  subjectEmoji?: string;
}

interface ScheduleForDateResult {
  classes: ScheduleClass[];
  dayName: string;
  weekNumber: number;
  isOdd: boolean;
  isSaturday?: boolean;
  noMapping?: boolean;
  followsDay?: number;
  followsDayName?: string;
}

/**
 * Get resolved schedule for a specific date.
 * Returns flat list of classes with subject info populated.
 */
export async function getScheduleForDate(date: Date | string): Promise<ScheduleForDateResult> {
  const doc = await get();
  const d = new Date(date);
  const jsDay = d.getDay(); // 0=Sun, 1=Mon ... 6=Sat

  if (jsDay === 0) return { classes: [], dayName: "Воскресенье", weekNumber: getWeekNumber(d, doc.semesterStartDate), isOdd: isOddWeek(d, doc.semesterStartDate) };

  const weekNum = getWeekNumber(d, doc.semesterStartDate);
  const odd = isOddWeek(d, doc.semesterStartDate);

  let targetDay: number;
  if (jsDay === 6) {
    // Saturday — find mapping
    const mapping = (doc.saturdayMappings || []).find((m) => m.weekNumber === weekNum);
    if (!mapping) return { classes: [], dayName: "Суббота", weekNumber: weekNum, isOdd: odd, isSaturday: true, noMapping: true };
    targetDay = mapping.followsDay;
  } else {
    targetDay = jsDay; // 1-5 maps directly
  }

  const daySchedule = doc.days.find((d) => d.dayOfWeek === targetDay);
  if (!daySchedule || !daySchedule.slots.length) {
    return { classes: [], dayName: DAY_NAMES[jsDay], weekNumber: weekNum, isOdd: odd };
  }

  // Resolve slots
  const classes: ScheduleClass[] = [];
  for (const slot of daySchedule.slots) {
    const timeSlot = doc.timeSlots.find((t) => t.number === slot.slotNumber);
    if (!timeSlot) continue;

    let subjectId: string | null;
    if (slot.isAlternating) {
      subjectId = odd ? slot.subjectId?.toString() || null : slot.subjectIdEven?.toString() || null;
    } else {
      subjectId = slot.subjectId?.toString() || null;
    }

    if (!subjectId) continue; // empty slot

    classes.push({
      slotNumber: slot.slotNumber,
      startTime: timeSlot.startTime,
      endTime: timeSlot.endTime,
      subjectId,
      isAlternating: slot.isAlternating,
    });
  }

  // Populate subject names
  const subjectIds = [...new Set(classes.map((c) => c.subjectId))];
  const subjects = await Subject.find({ _id: { $in: subjectIds } }).select("name emoji");
  const subjectMap = new Map(subjects.map((s) => [s._id.toString(), s]));

  for (const cls of classes) {
    const subj = subjectMap.get(cls.subjectId);
    if (subj) {
      cls.subjectName = subj.name;
      cls.subjectEmoji = subj.emoji || "📚";
    }
  }

  return {
    classes,
    dayName: DAY_NAMES[jsDay],
    weekNumber: weekNum,
    isOdd: odd,
    isSaturday: jsDay === 6,
    followsDay: jsDay === 6 ? targetDay : undefined,
    followsDayName: jsDay === 6 ? DAY_NAMES[targetDay] : undefined,
  };
}

interface NextClassResult extends ScheduleClass {
  date: Date;
  minutesUntil: number;
}

/**
 * Find the next upcoming class from a given time.
 */
export async function getNextClass(fromDate: Date = new Date()): Promise<NextClassResult | null> {
  const now = new Date(fromDate);

  // Check today and next 7 days
  for (let offset = 0; offset < 7; offset++) {
    const checkDate = new Date(now);
    checkDate.setDate(checkDate.getDate() + offset);

    const schedule = await getScheduleForDate(checkDate);
    if (!schedule.classes.length) continue;

    for (const cls of schedule.classes) {
      const [h, m] = cls.startTime.split(":").map(Number);
      const classTime = new Date(checkDate);
      classTime.setHours(h, m, 0, 0);

      if (classTime > now) {
        return { ...cls, date: checkDate, minutesUntil: Math.round((classTime.getTime() - now.getTime()) / 60000) };
      }
    }
  }

  return null;
}
