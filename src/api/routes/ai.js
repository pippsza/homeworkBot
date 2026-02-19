const { Router } = require("express");
const { tool, jsonSchema } = require("ai");
const userService = require("../../services/userService");
const promptService = require("../../services/promptService");
const subjectService = require("../../services/subjectService");
const { processQueryStream } = require("../../services/orchestratorService");
const ChatHistory = require("../../models/ChatHistory");

const router = Router();

async function requireReviewer(req, res, next) {
  const username = `@${req.telegramUser?.username}`;
  if (!(await userService.isReviewer(username))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// Stream chat (with orchestrator + RAG)
router.post("/chat", requireReviewer, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Messages required" });
    }

    let systemPrompt = await promptService.getPrompt("chat-system");
    const extras = {};

    // Add homework creation tool for admins
    const username = `@${req.telegramUser?.username}`;
    if (await userService.isAdmin(username)) {
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
router.get("/history", requireReviewer, async (req, res) => {
  const userId = req.telegramUser?.id;
  const history = await ChatHistory.findOne({ telegramUserId: userId });
  res.json(history?.messages || []);
});

// Clear chat history
router.delete("/history", requireReviewer, async (req, res) => {
  const userId = req.telegramUser?.id;
  await ChatHistory.deleteOne({ telegramUserId: userId });
  res.json({ success: true });
});

module.exports = router;
