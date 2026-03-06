import { Router, Response } from "express";
import { Readable } from "stream";
import { Telegraf } from "telegraf";
import multer from "multer";
import { AuthRequest } from "../middleware/telegramAuth";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

const router = Router();

// Upload file -> send to user's DM to get Telegram file_id -> delete message
router.post("/upload", upload.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.telegramUser?.id;
    console.log("[upload] start — userId:", userId, "hasFile:", !!req.file);
    if (!userId) {
      console.log("[upload] FAIL: no userId, telegramUser:", req.telegramUser);
      res.status(400).json({ error: "Пользователь не определён" });
      return;
    }
    if (!req.file) {
      console.log("[upload] FAIL: no file in request");
      res.status(400).json({ error: "Файл не найден" });
      return;
    }

    const bot = new Telegraf(process.env.BOT_TOKEN!);
    const { buffer, originalname, mimetype } = req.file;
    const isPhoto = mimetype.startsWith("image/") && !originalname.endsWith(".gif");
    console.log("[upload] file:", originalname, "mime:", mimetype, "size:", buffer.length, "isPhoto:", isPhoto);

    let msg: any;
    if (isPhoto) {
      console.log("[upload] sending photo to userId:", userId);
      msg = await bot.telegram.sendPhoto(userId, { source: buffer });
    } else {
      console.log("[upload] sending document to userId:", userId, "filename:", originalname);
      msg = await bot.telegram.sendDocument(userId, {
        source: buffer,
        filename: originalname,
      });
    }
    console.log("[upload] message sent, msg_id:", msg.message_id);

    const file_id = isPhoto
      ? msg.photo[msg.photo.length - 1].file_id
      : msg.document.file_id;
    const type = isPhoto ? "photo" : "document";
    console.log("[upload] got file_id:", file_id.slice(0, 20) + "...", "type:", type);

    // Delete the temporary message
    await bot.telegram.deleteMessage(userId, msg.message_id).catch(() => {});
    console.log("[upload] temp message deleted, responding OK");

    res.json({ file_id, type });
  } catch (e: any) {
    console.error("[upload] ERROR:", e.code || "", e.message || e);
    console.error("[upload] full error:", JSON.stringify(e, Object.getOwnPropertyNames(e), 2));
    const desc = e.response?.description || e.message || "";
    if (desc.includes("blocked") || desc.includes("initiate") || desc.includes("PEER_ID_INVALID")) {
      res.status(400).json({ error: "Напишите /start боту в личные сообщения" });
      return;
    }
    if (e.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "Файл слишком большой (макс. 20 МБ)" });
      return;
    }
    res.status(500).json({ error: "Ошибка загрузки файла" });
  }
});

// Send file to user's Telegram DM
router.post("/:file_id/send", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.telegramUser?.id;
    if (!userId) {
      res.status(400).json({ error: "Пользователь не определён" });
      return;
    }

    const { type } = req.body || {};
    const bot = new Telegraf(process.env.BOT_TOKEN!);
    const fileId = String(req.params.file_id);
    console.log("[send] sending", type, "to userId:", userId);

    if (type === "photo") {
      await bot.telegram.sendPhoto(userId, fileId as string);
    } else {
      await bot.telegram.sendDocument(userId, fileId as string);
    }
    console.log("[send] OK");
    res.json({ ok: true });
  } catch (e: any) {
    console.error("[send] ERROR:", e.message || e);
    const desc = e.response?.description || e.message || "";
    if (desc.includes("blocked") || desc.includes("initiate")) {
      res.status(400).json({ error: "Напишите /start боту в личные сообщения" });
      return;
    }
    res.status(500).json({ error: "Ошибка отправки файла" });
  }
});

// Proxy file content from Telegram (stream, no redirect)
router.get("/:file_id", async (req: AuthRequest, res: Response) => {
  try {
    console.log("[attachment] proxy request for:", req.params.file_id.slice(0, 20) + "...");
    const bot = new Telegraf(process.env.BOT_TOKEN!);
    const url = await bot.telegram.getFileLink(String(req.params.file_id));
    console.log("[attachment] fetching:", url.href.slice(0, 60) + "...");

    const response = await fetch(url.href);
    if (!response.ok) throw new Error(`Telegram responded ${response.status}`);

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const contentLength = response.headers.get("content-length");
    res.set("Content-Type", contentType);
    if (contentLength) res.set("Content-Length", contentLength);
    res.set("Cache-Control", "public, max-age=86400");

    Readable.fromWeb(response.body as any).pipe(res);
  } catch (e: any) {
    console.error("[attachment] proxy ERROR:", e.message || e);
    res.status(404).json({ error: "File not found" });
  }
});

export default router;
