import { Router, Response, NextFunction } from "express";
import * as userService from "../../services/userService";
import * as promptService from "../../services/promptService";
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

// Get all prompts (superadmin only)
router.get("/", requireSuperadmin, async (req: AuthRequest, res: Response) => {
  const prompts = await promptService.getAllPrompts();
  res.json(prompts);
});

// Update prompt (superadmin only)
router.put("/:key", requireSuperadmin, async (req: AuthRequest, res: Response) => {
  const { content } = req.body;
  if (!content) {
    res.status(400).json({ error: "Content required" });
    return;
  }
  const prompt = await promptService.updatePrompt(String(req.params.key), content);
  res.json(prompt);
});

// Sync prompts from files (dev only)
router.post("/sync", requireSuperadmin, async (req: AuthRequest, res: Response) => {
  if (process.env.NODE_ENV === "production") {
    res.status(403).json({ error: "Not available in production" });
    return;
  }
  const result = await promptService.syncFromFiles();
  res.json(result);
});

export default router;
