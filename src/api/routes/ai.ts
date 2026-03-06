import { Router, Response, NextFunction } from "express";
import * as userService from "../../services/userService";
import * as promptService from "../../services/promptService";
import { processQueryStream } from "../../services/orchestratorService";
import { buildAssistantTools } from "../../services/aiToolsService";
import ChatHistory from "../../models/ChatHistory";
import { AuthRequest } from "../middleware/telegramAuth";

const router = Router();

async function requireStudent(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const username = `@${req.telegramUser?.username}`;
  if (!(await userService.isStudent(username))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

// In-memory rate limiter per user (10 req/min)
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 60_000;

function rateLimit(req: AuthRequest, res: Response, next: NextFunction): void {
  const userId = String(req.telegramUser?.id || "anon");
  const now = Date.now();
  const entry = rateLimits.get(userId);

  if (!entry || now > entry.resetAt) {
    rateLimits.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    next();
    return;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    res.status(429).json({ error: "Too many requests. Try again later." });
    return;
  }

  entry.count++;
  next();
}

// Cleanup stale entries every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits) {
    if (now > entry.resetAt) rateLimits.delete(key);
  }
}, 5 * 60_000).unref();

// Stream chat (with orchestrator + RAG)
router.post("/chat", requireStudent, rateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: "Messages required" });
      return;
    }

    let systemPrompt = await promptService.getPrompt("chat-system");
    const extras: Record<string, any> = {};

    // Add assistant tools for students
    const username = `@${req.telegramUser?.username}`;
    const chatId: any = req.telegramUser?.id ? Number(req.telegramUser.id) : undefined;
    if (await userService.isStudent(username)) {
      const { tools, systemPromptAddition, maxSteps } = await buildAssistantTools({
        chatId,
        username,
      });
      systemPrompt += systemPromptAddition;
      extras.tools = tools;
      extras.maxSteps = maxSteps;
      extras.toolChoice = "auto";
    }

    // Pass tracking context for usage tracking
    extras.tracking = {
      userId: String(req.telegramUser?.id || "anon"),
      chatId,
      username,
      operationType: "chat",
      feature: "web-chat",
      endpoint: "/api/ai/chat",
      user: {
        name: [req.telegramUser?.first_name, (req.telegramUser as any)?.last_name].filter(Boolean).join(" ") || undefined,
        role: "student",
      },
    };

    console.log("[ai] chat extras:", { hasTools: !!extras.tools, toolNames: extras.tools ? Object.keys(extras.tools) : [], maxSteps: extras.maxSteps });
    const result = await processQueryStream(messages, systemPrompt || "", extras);

    result.pipeUIMessageStreamToResponse(res);

    // Handle stream errors so they don't crash the server
    result.text.catch((e: Error) => {
      console.error("[ai] stream error:", e.message);
    });

    // Save to history in background after stream completes
    result.text.then((text: string) => {
      const userId = req.telegramUser?.id;
      if (!userId) return;

      const userMsg = messages[messages.length - 1];
      const userContent =
        userMsg?.parts?.find((p: any) => p.type === "text")?.text ||
        userMsg?.content ||
        "";

      ChatHistory.findOneAndUpdate(
        { telegramUserId: Number(userId) } as any,
        {
          $push: {
            messages: {
              $each: [
                { role: "user", content: userContent },
                { role: "assistant", content: text },
              ],
              $slice: -50,
            },
          },
        },
        { upsert: true }
      ).catch((e: Error) => console.error("[ai] history save error:", e.message));
    });
  } catch (e: any) {
    console.error("[ai] chat error:", e);
    if (!res.headersSent) {
      res.status(500).json({ error: "AI error" });
    }
  }
});

// Get chat history
router.get("/history", requireStudent, async (req: AuthRequest, res: Response) => {
  const userId = req.telegramUser?.id;
  const history = await ChatHistory.findOne({ telegramUserId: Number(userId) } as any);
  res.json(history?.messages || []);
});

// Clear chat history
router.delete("/history", requireStudent, async (req: AuthRequest, res: Response) => {
  const userId = req.telegramUser?.id;
  await ChatHistory.deleteOne({ telegramUserId: Number(userId) } as any);
  res.json({ success: true });
});

export default router;
