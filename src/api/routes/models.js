const { Router } = require("express");
const userService = require("../../services/userService");
const { AI_MODELS, MODEL_TASKS } = require("../../config/aiModels");

const router = Router();

async function requireAdmin(req, res, next) {
  const username = `@${req.telegramUser?.username}`;
  if (!(await userService.isAdmin(username))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

router.use(requireAdmin);

// GET /api/models — catalog + current settings
router.get("/", async (req, res) => {
  const current = await userService.getModelSettings();
  res.json({ catalog: AI_MODELS, tasks: MODEL_TASKS, current });
});

// PUT /api/models/:task — update model for a task
router.put("/:task", async (req, res) => {
  const { task } = req.params;
  const { modelId } = req.body;

  if (!MODEL_TASKS[task]) {
    return res.status(400).json({ error: "Unknown task" });
  }
  if (!AI_MODELS[modelId]) {
    return res.status(400).json({ error: "Unknown model" });
  }

  const ok = await userService.updateModelSetting(task, modelId);
  if (!ok) return res.status(400).json({ error: "Update failed" });

  res.json({ ok: true, task, modelId });
});

module.exports = router;
