const scheduleService = require("./scheduleService");

const notifiedSet = new Set();
let lastCleanupDate = new Date().toDateString();

function startScheduleNotifier(bot) {
  const interval = setInterval(async () => {
    try {
      // Clear dedup set at midnight
      const today = new Date().toDateString();
      if (today !== lastCleanupDate) {
        notifiedSet.clear();
        lastCleanupDate = today;
      }

      const schedule = await scheduleService.get();
      if (!schedule.notificationsEnabled || !schedule.notificationChatId) return;

      const now = new Date();
      const minutesBefore = schedule.notifyMinutesBefore || 10;

      const todaySchedule = await scheduleService.getScheduleForDate(now);
      if (!todaySchedule.classes.length) return;

      for (const cls of todaySchedule.classes) {
        const [h, m] = cls.startTime.split(":").map(Number);
        const classTime = new Date(now);
        classTime.setHours(h, m, 0, 0);

        const diffMinutes = (classTime - now) / 60000;

        // Notify if class is within the window and hasn't been notified yet
        if (diffMinutes > 0 && diffMinutes <= minutesBefore) {
          const key = `${now.toDateString()}_${cls.slotNumber}`;
          if (notifiedSet.has(key)) continue;
          notifiedSet.add(key);

          const emoji = cls.subjectEmoji || "📚";
          const name = cls.subjectName || "Занятие";
          const mins = Math.round(diffMinutes);
          const text = `${emoji} <b>${name}</b> начинается через ${mins} мин.\n🕐 ${cls.startTime} — ${cls.endTime}`;

          await bot.telegram.sendMessage(schedule.notificationChatId, text, {
            parse_mode: "HTML",
          });
        }
      }
    } catch (e) {
      console.error("[scheduleNotifier] error:", e.message);
    }
  }, 60_000);

  interval.unref();
  console.log("[scheduleNotifier] started");
  return interval;
}

module.exports = { startScheduleNotifier };
