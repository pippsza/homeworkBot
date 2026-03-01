const Schedule = require("../models/Schedule");
const Subject = require("../models/Subject");

const DAY_NAMES = ["", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];

async function get() {
  let doc = await Schedule.findOne({ key: "main" });
  if (!doc) {
    doc = await Schedule.create({ key: "main" });
  }
  return doc;
}

async function update(data) {
  return Schedule.findOneAndUpdate({ key: "main" }, data, {
    upsert: true,
    returnDocument: "after",
  });
}

async function setTimeSlots(slots) {
  return Schedule.findOneAndUpdate(
    { key: "main" },
    { timeSlots: slots },
    { upsert: true, returnDocument: "after" }
  );
}

async function setDaySchedule(dayOfWeek, slots) {
  const doc = await get();
  const idx = doc.days.findIndex((d) => d.dayOfWeek === dayOfWeek);
  if (idx >= 0) {
    doc.days[idx].slots = slots;
  } else {
    doc.days.push({ dayOfWeek, slots });
  }
  return doc.save();
}

async function setSaturdayMappings(mappings) {
  return Schedule.findOneAndUpdate(
    { key: "main" },
    { saturdayMappings: mappings },
    { upsert: true, returnDocument: "after" }
  );
}

async function updateConfig(config) {
  const allowed = ["semesterStartDate", "notificationChatId", "notifyMinutesBefore", "notificationsEnabled"];
  const updates = {};
  for (const key of allowed) {
    if (config[key] !== undefined) updates[key] = config[key];
  }
  return Schedule.findOneAndUpdate({ key: "main" }, updates, {
    upsert: true,
    returnDocument: "after",
  });
}

function getWeekNumber(date, semesterStart) {
  if (!semesterStart) return 1;
  const start = new Date(semesterStart);
  start.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diff = d - start;
  if (diff < 0) return 1;
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function isOddWeek(date, semesterStart) {
  return getWeekNumber(date, semesterStart) % 2 === 1;
}

/**
 * Get resolved schedule for a specific date.
 * Returns flat list of classes with subject info populated.
 */
async function getScheduleForDate(date) {
  const doc = await get();
  const d = new Date(date);
  let jsDay = d.getDay(); // 0=Sun, 1=Mon ... 6=Sat

  if (jsDay === 0) return { classes: [], dayName: "Воскресенье", weekNumber: getWeekNumber(d, doc.semesterStartDate), isOdd: isOddWeek(d, doc.semesterStartDate) };

  const weekNum = getWeekNumber(d, doc.semesterStartDate);
  const odd = isOddWeek(d, doc.semesterStartDate);

  let targetDay;
  if (jsDay === 6) {
    // Saturday — find mapping
    const mapping = doc.saturdayMappings.find((m) => m.weekNumber === weekNum);
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
  const classes = [];
  for (const slot of daySchedule.slots) {
    const timeSlot = doc.timeSlots.find((t) => t.number === slot.slotNumber);
    if (!timeSlot) continue;

    let subjectId;
    if (slot.isAlternating) {
      subjectId = odd ? slot.subjectId : slot.subjectIdEven;
    } else {
      subjectId = slot.subjectId;
    }

    if (!subjectId) continue; // empty slot

    classes.push({
      slotNumber: slot.slotNumber,
      startTime: timeSlot.startTime,
      endTime: timeSlot.endTime,
      subjectId: subjectId.toString(),
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

/**
 * Find the next upcoming class from a given time.
 */
async function getNextClass(fromDate = new Date()) {
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
        return { ...cls, date: checkDate, minutesUntil: Math.round((classTime - now) / 60000) };
      }
    }
  }

  return null;
}

module.exports = {
  get,
  update,
  setTimeSlots,
  setDaySchedule,
  setSaturdayMappings,
  updateConfig,
  getWeekNumber,
  isOddWeek,
  getScheduleForDate,
  getNextClass,
  DAY_NAMES,
};
