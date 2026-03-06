import { Router, Response, NextFunction } from "express";
import * as infoService from "../../services/infoService";
import * as userService from "../../services/userService";
import { syncInfoChunks } from "../../services/infoChunkingService";
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

router.get("/", async (req: AuthRequest, res: Response) => {
  const infos = await infoService.getAll();
  res.json(infos);
});

router.get("/:id", async (req: AuthRequest, res: Response) => {
  const info = await infoService.getById(String(req.params.id));
  if (!info) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(info);
});

router.post("/", requireStudent, async (req: AuthRequest, res: Response) => {
  const info = await infoService.create(req.body);
  res.status(201).json(info);
});

router.put("/:id", requireStudent, async (req: AuthRequest, res: Response) => {
  const info = await infoService.update(String(req.params.id), req.body);
  if (!info) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(info);
});

router.delete("/:id", requireStudent, async (req: AuthRequest, res: Response) => {
  const info = await infoService.delete(String(req.params.id));
  if (!info) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ success: true });
});

// Re-chunk info (superadmin only)
router.post("/:id/rechunk", requireSuperadmin, async (req: AuthRequest, res: Response) => {
  const info = await infoService.getById(String(req.params.id));
  if (!info) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  try {
    await syncInfoChunks(info._id.toString());
    const updated = await infoService.getById(info._id.toString());
    res.json({ success: true, chunkCount: updated?.chunkCount || 0 });
  } catch (e: any) {
    console.error("[infos] rechunk error:", e.message);
    res.status(500).json({ error: "Rechunk failed" });
  }
});

export default router;
