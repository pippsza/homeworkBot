const scheduleService = require("./scheduleService");
const subjectService = require("./subjectService");

let lastDigestDate = null;

function startWeeklyDigest(bot) {
  const interval = setInterval(async () => {
    try {
      const now = new Date();

      // Only Monday at 08:00
      if (now.getDay() !== 1) return;
      if (now.getHours() !== 8 || now.getMinutes() !== 0) return;

      // Prevent duplicate sends within the same day
      const todayStr = now.toDateString();
      if (lastDigestDate === todayStr) return;
      lastDigestDate = todayStr;

      const schedule = await scheduleService.get();
      if (!schedule.notificationChatId) return;

      const subjects = await subjectService.getAll();

      // Collect upcoming deadlines (this week)
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() + 7);

      const deadlines = [];
      const recentTasks = [];
      let totalTasks = 0;
      let totalUnsolved = 0;

      for (const subject of subjects) {
        for (const task of subject.tasks || []) {
          totalTasks++;
          if (!task.aiAnswer) totalUnsolved++;

          // Deadlines this week
          if (task.deadline && task.deadline > now && task.deadline <= weekEnd) {
            deadlines.push({
              title: task.title,
              emoji: task.emoji || "📄",
              subject: subject.name,
              subjectEmoji: subject.emoji || "📚",
              deadline: task.deadline,
            });
          }

          // Tasks created in the last week
          if (task.createdAt && task.createdAt > new Date(now - 7 * 24 * 60 * 60 * 1000)) {
            recentTasks.push({
              title: task.title,
              emoji: task.emoji || "📄",
              subject: subject.name,
              subjectEmoji: subject.emoji || "📚",
            });
          }
        }
      }

      // Build digest message
      let text = "📋 <b>Еженедельный дайджест</b>\n\n";

      if (deadlines.length > 0) {
        deadlines.sort((a, b) => a.deadline - b.deadline);
        text += "⏰ <b>Дедлайны на этой неделе:</b>\n";
        for (const d of deadlines) {
          const dateStr = d.deadline.toLocaleDateString("ru-RU", {
            weekday: "short",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          });
          text += `  ${d.emoji} ${d.title} (${d.subjectEmoji} ${d.subject}) — ${dateStr}\n`;
        }
        text += "\n";
      }

      if (recentTasks.length > 0) {
        text += `📝 <b>Новые задания за неделю:</b> ${recentTasks.length}\n`;
        for (const t of recentTasks.slice(0, 10)) {
          text += `  ${t.emoji} ${t.title} (${t.subjectEmoji} ${t.subject})\n`;
        }
        if (recentTasks.length > 10) {
          text += `  ... и ещё ${recentTasks.length - 10}\n`;
        }
        text += "\n";
      }

      text += `📊 Всего заданий: ${totalTasks} | Без AI-решения: ${totalUnsolved}`;

      if (deadlines.length === 0 && recentTasks.length === 0 && totalTasks === 0) {
        return; // Nothing to report
      }

      await bot.telegram.sendMessage(schedule.notificationChatId, text, {
        parse_mode: "HTML",
      });
    } catch (e) {
      console.error("[weeklyDigest] error:", e.message);
    }
  }, 60_000);

  interval.unref();
  console.log("[weeklyDigest] started");
  return interval;
}

module.exports = { startWeeklyDigest };
