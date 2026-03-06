import { Router, Response, NextFunction } from "express";
import * as userService from "../../services/userService";
import * as modelCatalogService from "../../services/modelCatalogService";
import { MODEL_ROLES } from "../../config/aiModels";
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

router.use(requireSuperadmin);

// GET /api/models — catalog + roles + current config
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const [catalog, modelConfig] = await Promise.all([
      modelCatalogService.getAll({ isActive: true }),
      userService.getModelConfig(),
    ]);
    res.json({ catalog, roles: MODEL_ROLES, config: modelConfig });
  } catch (e: any) {
    console.error("[models] GET error:", e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/models/:role — update model config for a role
router.put("/:role", async (req: AuthRequest, res: Response) => {
  const { role } = req.params;
  const { provider, modelId, fallbackProvider, fallbackModelId } = req.body;

  if (!(MODEL_ROLES as any)[role as string]) {
    res.status(400).json({ error: "Unknown role" });
    return;
  }
  if (!provider || !modelId) {
    res.status(400).json({ error: "provider and modelId required" });
    return;
  }

  const config: Record<string, string> = { provider, modelId };
  if (fallbackProvider && fallbackModelId) {
    config.fallbackProvider = fallbackProvider;
    config.fallbackModelId = fallbackModelId;
  }

  const ok = await userService.updateModelConfig(String(role), config);
  if (!ok) {
    res.status(400).json({ error: "Update failed" });
    return;
  }

  res.json({ ok: true, role, config });
});

// POST /api/models/sync — sync model catalog from providers
router.post("/sync", async (req: AuthRequest, res: Response) => {
  try {
    const results = await modelCatalogService.syncAll();
    res.json({ ok: true, synced: results });
  } catch (e: any) {
    console.error("[models] sync error:", e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
