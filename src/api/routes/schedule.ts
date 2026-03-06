import { Router, Response, NextFunction } from "express";
import * as userService from "../../services/userService";
import * as scheduleService from "../../services/scheduleService";
import { AuthRequest } from "../middleware/telegramAuth";

const router = Router();

async function requireStudent(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const username = `@${req.telegramUser?.username}`;
  if (!(await userService.isStudent(username))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

async function requireSuperadmin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const username = `@${req.telegramUser?.username}`;
  if (!(await userService.isSuperadmin(username))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

// Get full schedule document (for editor)
router.get("/", async (req: AuthRequest, res: Response) => {
  const schedule = await scheduleService.get();
  res.json(schedule);
});

// Full update
router.put("/", requireSuperadmin, async (req: AuthRequest, res: Response) => {
  const schedule = await scheduleService.update(req.body);
  res.json(schedule);
});

// Resolved schedule for today
router.get("/today", async (req: AuthRequest, res: Response) => {
  const result = await scheduleService.getScheduleForDate(new Date());
  res.json(result);
});

// Resolved schedule for a specific date
router.get("/date/:date", async (req: AuthRequest, res: Response) => {
  const date = new Date(String(req.params.date));
  if (isNaN(date.getTime())) {
    res.status(400).json({ error: "Invalid date" });
    return;
  }
  const result = await scheduleService.getScheduleForDate(date);
  res.json(result);
});

// Update time slots
router.put("/timeslots", requireSuperadmin, async (req: AuthRequest, res: Response) => {
  const { timeSlots } = req.body;
  if (!Array.isArray(timeSlots)) {
    res.status(400).json({ error: "timeSlots must be an array" });
    return;
  }
  const schedule = await scheduleService.setTimeSlots(timeSlots);
  res.json(schedule);
});

// Update day schedule
router.put("/days/:day", requireSuperadmin, async (req: AuthRequest, res: Response) => {
  const dayOfWeek = parseInt(String(req.params.day));
  if (dayOfWeek < 1 || dayOfWeek > 5) {
    res.status(400).json({ error: "Day must be 1-5" });
    return;
  }
  const { slots } = req.body;
  if (!Array.isArray(slots)) {
    res.status(400).json({ error: "slots must be an array" });
    return;
  }
  const schedule = await scheduleService.setDaySchedule(dayOfWeek, slots);
  res.json(schedule);
});

// Update saturday mappings
router.put("/saturday", requireSuperadmin, async (req: AuthRequest, res: Response) => {
  const { mappings } = req.body;
  if (!Array.isArray(mappings)) {
    res.status(400).json({ error: "mappings must be an array" });
    return;
  }
  const schedule = await scheduleService.setSaturdayMappings(mappings);
  res.json(schedule);
});

// Update config (superadmin only)
router.put("/config", requireSuperadmin, async (req: AuthRequest, res: Response) => {
  const schedule = await scheduleService.updateConfig(req.body);
  res.json(schedule);
});

export default router;
