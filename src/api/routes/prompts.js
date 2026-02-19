const { Router } = require("express");
const userService = require("../../services/userService");
const promptService = require("../../services/promptService");

const router = Router();

async function requireAdmin(req, res, next) {
  const username = `@${req.telegramUser?.username}`;
  if (!(await userService.isAdmin(username))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// Get all prompts (admin only)
router.get("/", requireAdmin, async (req, res) => {
  const prompts = await promptService.getAllPrompts();
  res.json(prompts);
});

// Update prompt (admin only)
router.put("/:key", requireAdmin, async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: "Content required" });
  const prompt = await promptService.updatePrompt(req.params.key, content);
  res.json(prompt);
});

// Sync prompts from files (dev only)
router.post("/sync", requireAdmin, async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "Not available in production" });
  }
  const result = await promptService.syncFromFiles();
  res.json(result);
});

module.exports = router;
