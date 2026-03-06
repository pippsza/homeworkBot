import { Router, Request, Response } from "express";
import { Readable } from "stream";
import { Telegraf } from "telegraf";
import telegramAuth from "./middleware/telegramAuth";
import subjectsRoutes from "./routes/subjects";
import infosRoutes from "./routes/infos";
import usersRoutes from "./routes/users";
import attachmentsRoutes from "./routes/attachments";
import promptsRoutes from "./routes/prompts";
import aiRoutes from "./routes/ai";
import knowledgeRoutes from "./routes/knowledge";
import modelsRoutes from "./routes/models";
import scheduleRoutes from "./routes/schedule";

const router = Router();

// Attachment file proxy — no auth required (used by <img> tags)
router.get("/attachments/:file_id", async (req: Request, res: Response) => {
  try {
    const bot = new Telegraf(process.env.BOT_TOKEN!);
    const url = await bot.telegram.getFileLink(String(req.params.file_id));

    const response = await fetch(url.href);
    if (!response.ok) throw new Error(`Telegram responded ${response.status}`);

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const contentLength = response.headers.get("content-length");
    res.set("Content-Type", contentType);
    if (contentLength) res.set("Content-Length", contentLength);
    res.set("Cache-Control", "public, max-age=86400");

    Readable.fromWeb(response.body as any).pipe(res);
  } catch (e: any) {
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

export default router;
