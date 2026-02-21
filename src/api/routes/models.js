const { Router } = require("express");
const userService = require("../../services/userService");
const modelCatalogService = require("../../services/modelCatalogService");
const { MODEL_ROLES } = require("../../config/aiModels");

const router = Router();

async function requireSuperadmin(req, res, next) {
  const username = `@${req.telegramUser?.username}`;
  if (!(await userService.isSuperadmin(username))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

router.use(requireSuperadmin);

// GET /api/models — catalog + roles + current config
router.get("/", async (req, res) => {
  try {
    const [catalog, modelConfig] = await Promise.all([
      modelCatalogService.getAll({ isActive: true }),
      userService.getModelConfig(),
    ]);
    res.json({ catalog, roles: MODEL_ROLES, config: modelConfig });
  } catch (e) {
    console.error("[models] GET error:", e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/models/:role — update model config for a role
router.put("/:role", async (req, res) => {
  const { role } = req.params;
  const { provider, modelId, fallbackProvider, fallbackModelId } = req.body;

  if (!MODEL_ROLES[role]) {
    return res.status(400).json({ error: "Unknown role" });
  }
  if (!provider || !modelId) {
    return res.status(400).json({ error: "provider and modelId required" });
  }

  const config = { provider, modelId };
  if (fallbackProvider && fallbackModelId) {
    config.fallbackProvider = fallbackProvider;
    config.fallbackModelId = fallbackModelId;
  }

  const ok = await userService.updateModelConfig(role, config);
  if (!ok) return res.status(400).json({ error: "Update failed" });

  res.json({ ok: true, role, config });
});

// POST /api/models/sync — sync model catalog from providers
router.post("/sync", async (req, res) => {
  try {
    const results = await modelCatalogService.syncAll();
    res.json({ ok: true, synced: results });
  } catch (e) {
    console.error("[models] sync error:", e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
