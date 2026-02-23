const { Router } = require("express");
const userService = require("../../services/userService");
const promptService = require("../../services/promptService");
const { processQueryStream } = require("../../services/orchestratorService");
const { buildAssistantTools } = require("../../services/aiToolsService");
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

    // Add assistant tools for students
    const username = `@${req.telegramUser?.username}`;
    if (await userService.isStudent(username)) {
      const { tools, systemPromptAddition, maxSteps } = await buildAssistantTools();
      systemPrompt += systemPromptAddition;
      extras.tools = tools;
      extras.maxSteps = maxSteps;
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
