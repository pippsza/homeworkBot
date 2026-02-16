const { Router } = require("express");
const userService = require("../../services/userService");

const router = Router();

async function requireSuperuser(req, res, next) {
  const username = `@${req.telegramUser?.username}`;
  if (!(await userService.isSuperuser(username))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// Get current user's role
router.get("/me", async (req, res) => {
  const username = `@${req.telegramUser?.username}`;
  res.json({
    username,
    isAdmin: await userService.isAdmin(username),
    isAnswerViewer: await userService.isAnswerViewer(username),
    isSuperuser: await userService.isSuperuser(username),
  });
});

// Get all users (superuser only)
router.get("/settings", requireSuperuser, async (req, res) => {
  const settings = await userService.getSettings();
  res.json({
    admins: settings.admins,
    answerViewers: settings.answerViewers,
    superusers: settings.superusers,
  });
});

// Add/remove users
const roles = [
  { path: "admins", field: "admins" },
  { path: "viewers", field: "answerViewers" },
  { path: "superusers", field: "superusers" },
];

for (const { path, field } of roles) {
  router.post(`/${path}`, requireSuperuser, async (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: "Username required" });
    const added = await userService.addUser(field, username);
    res.json({ success: added });
  });

  router.delete(`/${path}/:username`, requireSuperuser, async (req, res) => {
    const username = `@${req.params.username}`;
    const removed = await userService.removeUser(field, username);
    res.json({ success: removed });
  });
}

module.exports = router;
