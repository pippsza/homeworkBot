const { Router } = require("express");
const infoService = require("../../services/infoService");
const userService = require("../../services/userService");

const router = Router();

async function requireStudent(req, res, next) {
  const username = `@${req.telegramUser?.username}`;
  if (!(await userService.isStudent(username))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

router.get("/", async (req, res) => {
  const infos = await infoService.getAll();
  res.json(infos);
});

router.get("/:id", async (req, res) => {
  const info = await infoService.getById(req.params.id);
  if (!info) return res.status(404).json({ error: "Not found" });
  res.json(info);
});

router.post("/", requireStudent, async (req, res) => {
  const info = await infoService.create(req.body);
  res.status(201).json(info);
});

router.put("/:id", requireStudent, async (req, res) => {
  const info = await infoService.update(req.params.id, req.body);
  if (!info) return res.status(404).json({ error: "Not found" });
  res.json(info);
});

router.delete("/:id", requireStudent, async (req, res) => {
  const info = await infoService.delete(req.params.id);
  if (!info) return res.status(404).json({ error: "Not found" });
  res.json({ success: true });
});

module.exports = router;
