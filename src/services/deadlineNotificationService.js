const scheduleService = require("./scheduleService");
const subjectService = require("./subjectService");

const notifiedSet = new Set();
let lastCleanupDate = new Date().toDateString();

function startDeadlineNotifier(bot) {
  const interval = setInterval(async () => {
    try {
      // Clear dedup set at midnight
      const today = new Date().toDateString();
      if (today !== lastCleanupDate) {
        notifiedSet.clear();
        lastCleanupDate = today;
      }

      const schedule = await scheduleService.get();
      if (!schedule.notificationChatId) return;

      const now = new Date();
      const subjects = await subjectService.getAll();

      for (const subject of subjects) {
        for (const task of subject.tasks || []) {
          if (!task.deadline) continue;

          const diffMs = task.deadline - now;
          if (diffMs <= 0) continue; // already past

          const diffHours = diffMs / (1000 * 60 * 60);

          // Notify at 24h and 1h before deadline
          const thresholds = [
            { hours: 24, label: "24 часа", key: "24h" },
            { hours: 1, label: "1 час", key: "1h" },
          ];

          for (const { hours, label, key } of thresholds) {
            if (diffHours <= hours && diffHours > hours - 1) {
              const dedupKey = `${today}_${task._id}_${key}`;
              if (notifiedSet.has(dedupKey)) continue;
              notifiedSet.add(dedupKey);

              const emoji = task.emoji || "📄";
              const text = `⏰ ${emoji} <b>${task.title}</b> (${subject.emoji || "📚"} ${subject.name}) — дедлайн через ${label}`;

              await bot.telegram.sendMessage(schedule.notificationChatId, text, {
                parse_mode: "HTML",
              });
            }
          }
        }
      }
    } catch (e) {
      console.error("[deadlineNotifier] error:", e.message);
    }
  }, 60_000);

  interval.unref();
  console.log("[deadlineNotifier] started");
  return interval;
}

module.exports = { startDeadlineNotifier };
