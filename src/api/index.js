const { Router } = require("express");
const { Readable } = require("stream");
const { Telegraf } = require("telegraf");
const telegramAuth = require("./middleware/telegramAuth");
const subjectsRoutes = require("./routes/subjects");
const infosRoutes = require("./routes/infos");
const usersRoutes = require("./routes/users");
const attachmentsRoutes = require("./routes/attachments");
const promptsRoutes = require("./routes/prompts");
const aiRoutes = require("./routes/ai");
const knowledgeRoutes = require("./routes/knowledge");
const modelsRoutes = require("./routes/models");
const scheduleRoutes = require("./routes/schedule");

const router = Router();

// Attachment file proxy — no auth required (used by <img> tags)
router.get("/attachments/:file_id", async (req, res) => {
  try {
    const bot = new Telegraf(process.env.BOT_TOKEN);
    const url = await bot.telegram.getFileLink(req.params.file_id);

    const response = await fetch(url.href);
    if (!response.ok) throw new Error(`Telegram responded ${response.status}`);

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const contentLength = response.headers.get("content-length");
    res.set("Content-Type", contentType);
    if (contentLength) res.set("Content-Length", contentLength);
    res.set("Cache-Control", "public, max-age=86400");

    Readable.fromWeb(response.body).pipe(res);
  } catch (e) {
    console.error("[attachment proxy] ERROR:", e.message || e);
    res.status(404).json({ error: "File not found" });
  }
});

// All other API routes require Telegram WebApp auth
router.use(telegramAuth);

router.use("/subjects", subjectsRoutes);
router.use("/infos", infosRoutes);
router.use("/users", usersRoutes);
router.use("/attachments", attachmentsRoutes);
router.use("/prompts", promptsRoutes);
router.use("/ai", aiRoutes);
router.use("/knowledge", knowledgeRoutes);
router.use("/models", modelsRoutes);
router.use("/schedule", scheduleRoutes);

module.exports = router;
