const { Router } = require("express");
const { tool, jsonSchema } = require("ai");
const userService = require("../../services/userService");
const promptService = require("../../services/promptService");
const subjectService = require("../../services/subjectService");
const { processQueryStream } = require("../../services/orchestratorService");
const ChatHistory = require("../../models/ChatHistory");

const router = Router();

async function requireStudent(req, res, next) {
  const username = `@${req.telegramUser?.username}`;
  if (!(await userService.isStudent(username))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// In-memory rate limiter per user (10 req/min)
const rateLimits = new Map();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 60_000;

function rateLimit(req, res, next) {
  const userId = String(req.telegramUser?.id || "anon");
  const now = Date.now();
  const entry = rateLimits.get(userId);

  if (!entry || now > entry.resetAt) {
    rateLimits.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return next();
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: "Too many requests. Try again later." });
  }

  entry.count++;
  return next();
}

// Cleanup stale entries every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits) {
    if (now > entry.resetAt) rateLimits.delete(key);
  }
}, 5 * 60_000).unref();

// Stream chat (with orchestrator + RAG)
router.post("/chat", requireStudent, rateLimit, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Messages required" });
    }

    let systemPrompt = await promptService.getPrompt("chat-system");
    const extras = {};

    // Add homework creation tool for students
    const username = `@${req.telegramUser?.username}`;
    if (await userService.isStudent(username)) {
      const subjects = await subjectService.getAll();
      const subjectsList = subjects
        .map((s) => `- ${s.emoji || "📚"} ${s.name} (ID: ${s._id})`)
        .join("\n");

      systemPrompt += `\n\nУ тебя есть инструмент createHomework для создания домашних заданий.\nДоступные предметы:\n${subjectsList}\n\nКОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ СОЗДАТЬ ДОМАШКУ/ЗАДАНИЕ — ТЫ ОБЯЗАН ВЫЗВАТЬ ИНСТРУМЕНТ createHomework.\nНИКОГДА не отвечай текстом "я создал задание" без реального вызова инструмента.\nВсегда указывай subjectId из списка предметов выше. Название и описание придумай на основе запроса пользователя.`;

      extras.tools = {
        createHomework: tool({
          description: "Создать домашнее задание. Используй когда пользователь просит создать, добавить домашку или задание.",
          parameters: jsonSchema({
            type: "object",
            properties: {
              subjectId: { type: "string", description: "ID предмета из списка доступных предметов" },
              title: { type: "string", description: "Название задания (краткое, 5-15 слов)" },
              emoji: { type: "string", description: "Эмодзи для задания (по умолчанию 📄)" },
              description: { type: "string", description: "Полное описание задания" },
            },
            required: ["subjectId", "title", "description"],
          }),
          execute: async ({ subjectId, title, emoji, description }) => {
            console.log("[ai tool] createHomework:", { subjectId, title });
            const subject = await subjectService.getById(subjectId);
            if (!subject) return { error: "Предмет не найден" };
            const task = await subjectService.addTask(subjectId, {
              title,
              emoji: emoji || "📄",
              description: description || "",
            });
            return {
              success: true,
              taskTitle: title,
              subjectName: subject.name,
              subjectEmoji: subject.emoji || "📚",
              taskId: task._id.toString(),
            };
          },
        }),
      };
      extras.maxSteps = 2;
      extras.toolChoice = "auto";
    }

    // Pass tracking context for usage tracking
    extras.tracking = {
      userId: String(req.telegramUser?.id || "anon"),
      operationType: "chat",
      feature: "web-chat",
      endpoint: "/api/ai/chat",
      user: {
        name: [req.telegramUser?.first_name, req.telegramUser?.last_name].filter(Boolean).join(" ") || undefined,
        role: "student",
      },
    };

    console.log("[ai] chat extras:", { hasTools: !!extras.tools, toolNames: extras.tools ? Object.keys(extras.tools) : [], maxSteps: extras.maxSteps });
    const result = await processQueryStream(messages, systemPrompt, extras);

    result.pipeUIMessageStreamToResponse(res);

    // Handle stream errors so they don't crash the server
    result.text.catch((e) => {
      console.error("[ai] stream error:", e.message);
    });

    // Save to history in background after stream completes
    result.text.then((text) => {
      const userId = req.telegramUser?.id;
      if (!userId) return;

      const userMsg = messages[messages.length - 1];
      const userContent =
        userMsg?.parts?.find((p) => p.type === "text")?.text ||
        userMsg?.content ||
        "";

      ChatHistory.findOneAndUpdate(
        { telegramUserId: userId },
        {
          $push: {
            messages: {
              $each: [
                { role: "user", content: userContent },
                { role: "assistant", content: text },
              ],
            },
          },
        },
        { upsert: true }
      ).catch((e) => console.error("[ai] history save error:", e.message));
    });
  } catch (e) {
    console.error("[ai] chat error:", e);
    if (!res.headersSent) {
      res.status(500).json({ error: "AI error" });
    }
  }
});

// Get chat history
router.get("/history", requireStudent, async (req, res) => {
  const userId = req.telegramUser?.id;
  const history = await ChatHistory.findOne({ telegramUserId: userId });
  res.json(history?.messages || []);
});

// Clear chat history
router.delete("/history", requireStudent, async (req, res) => {
  const userId = req.telegramUser?.id;
  await ChatHistory.deleteOne({ telegramUserId: userId });
  res.json({ success: true });
});

module.exports = router;
