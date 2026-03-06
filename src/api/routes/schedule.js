const { Router } = require("express");
const userService = require("../../services/userService");
const scheduleService = require("../../services/scheduleService");

const router = Router();

async function requireStudent(req, res, next) {
  const username = `@${req.telegramUser?.username}`;
  if (!(await userService.isStudent(username))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

async function requireSuperadmin(req, res, next) {
  const username = `@${req.telegramUser?.username}`;
  if (!(await userService.isSuperadmin(username))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// Get full schedule document (for editor)
router.get("/", async (req, res) => {
  const schedule = await scheduleService.get();
  res.json(schedule);
});

// Full update
router.put("/", requireSuperadmin, async (req, res) => {
  const schedule = await scheduleService.update(req.body);
  res.json(schedule);
});

// Resolved schedule for today
router.get("/today", async (req, res) => {
  const result = await scheduleService.getScheduleForDate(new Date());
  res.json(result);
});

// Resolved schedule for a specific date
router.get("/date/:date", async (req, res) => {
  const date = new Date(req.params.date);
  if (isNaN(date.getTime())) {
    return res.status(400).json({ error: "Invalid date" });
  }
  const result = await scheduleService.getScheduleForDate(date);
  res.json(result);
});

// Update time slots
router.put("/timeslots", requireSuperadmin, async (req, res) => {
  const { timeSlots } = req.body;
  if (!Array.isArray(timeSlots)) {
    return res.status(400).json({ error: "timeSlots must be an array" });
  }
  const schedule = await scheduleService.setTimeSlots(timeSlots);
  res.json(schedule);
});

// Update day schedule
router.put("/days/:day", requireSuperadmin, async (req, res) => {
  const dayOfWeek = parseInt(req.params.day);
  if (dayOfWeek < 1 || dayOfWeek > 5) {
    return res.status(400).json({ error: "Day must be 1-5" });
  }
  const { slots } = req.body;
  if (!Array.isArray(slots)) {
    return res.status(400).json({ error: "slots must be an array" });
  }
  const schedule = await scheduleService.setDaySchedule(dayOfWeek, slots);
  res.json(schedule);
});

// Update saturday mappings
router.put("/saturday", requireSuperadmin, async (req, res) => {
  const { mappings } = req.body;
  if (!Array.isArray(mappings)) {
    return res.status(400).json({ error: "mappings must be an array" });
  }
  const schedule = await scheduleService.setSaturdayMappings(mappings);
  res.json(schedule);
});

// Update config (superadmin only)
router.put("/config", requireSuperadmin, async (req, res) => {
  const schedule = await scheduleService.updateConfig(req.body);
  res.json(schedule);
});

module.exports = router;
