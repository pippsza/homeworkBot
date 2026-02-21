const { Router } = require("express");
const userService = require("../../services/userService");

const router = Router();

async function requireSuperadmin(req, res, next) {
  const username = `@${req.telegramUser?.username}`;
  if (!(await userService.isSuperadmin(username))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// Get current user's role
router.get("/me", async (req, res) => {
  const username = `@${req.telegramUser?.username}`;
  res.json({
    username,
    isStudent: await userService.isStudent(username),
    isSuperadmin: await userService.isSuperadmin(username),
  });
});

// Get all users (superadmin only)
router.get("/settings", requireSuperadmin, async (req, res) => {
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
  router.post(`/${path}`, requireSuperadmin, async (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: "Username required" });
    const added = await userService.addUser(field, username);
    res.json({ success: added });
  });

  router.delete(`/${path}/:username`, requireSuperadmin, async (req, res) => {
    const username = `@${req.params.username}`;
    const removed = await userService.removeUser(field, username);
    res.json({ success: removed });
  });
}

module.exports = router;
