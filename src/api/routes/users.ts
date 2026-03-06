import { Router, Response, NextFunction } from "express";
import * as userService from "../../services/userService";
import { AuthRequest } from "../middleware/telegramAuth";

const router = Router();

async function requireSuperadmin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const username = `@${req.telegramUser?.username}`;
  if (!(await userService.isSuperadmin(username))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

// Get current user's role
router.get("/me", async (req: AuthRequest, res: Response) => {
  const username = `@${req.telegramUser?.username}`;
  res.json({
    username,
    isStudent: await userService.isStudent(username),
    isSuperadmin: await userService.isSuperadmin(username),
  });
});

// Get all users (superadmin only)
router.get("/settings", requireSuperadmin, async (req: AuthRequest, res: Response) => {
  const settings = await userService.getSettings();
  res.json({
    students: settings.students || [],
    superadmins: settings.superadmins || [],
  });
});

// Add/remove users
const roles = [
  { path: "students", field: "students" },
  { path: "superadmins", field: "superadmins" },
];

for (const { path, field } of roles) {
  router.post(`/${path}`, requireSuperadmin, async (req: AuthRequest, res: Response) => {
    const { username } = req.body;
    if (!username) {
      res.status(400).json({ error: "Username required" });
      return;
    }
    const added = await userService.addUser(field, username);
    res.json({ success: added });
  });

  router.delete(`/${path}/:username`, requireSuperadmin, async (req: AuthRequest, res: Response) => {
    const username = `@${req.params.username}`;
    const removed = await userService.removeUser(field, username);
    res.json({ success: removed });
  });
}

export default router;
