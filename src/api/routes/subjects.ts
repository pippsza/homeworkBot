import { Router, Response, NextFunction } from "express";
import * as subjectService from "../../services/subjectService";
import * as userService from "../../services/userService";
import { solveTask } from "../../services/orchestratorService";
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

// Get all subjects
router.get("/", async (req: AuthRequest, res: Response) => {
  const subjects = await subjectService.getAll();
  res.json(subjects);
});

// Get subject by id
router.get("/:id", async (req: AuthRequest, res: Response) => {
  const subject = await subjectService.getById(String(req.params.id));
  if (!subject) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(subject);
});

// Create subject
router.post("/", requireStudent, async (req: AuthRequest, res: Response) => {
  const subject = await subjectService.create(req.body);
  res.status(201).json(subject);
});

// Update subject
router.put("/:id", requireStudent, async (req: AuthRequest, res: Response) => {
  const subject = await subjectService.update(String(req.params.id), req.body);
  if (!subject) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(subject);
});

// Delete subject
router.delete("/:id", requireStudent, async (req: AuthRequest, res: Response) => {
  const subject = await subjectService.delete(String(req.params.id));
  if (!subject) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ success: true });
});

// Add task to subject
router.post("/:id/tasks", requireStudent, async (req: AuthRequest, res: Response) => {
  const task = await subjectService.addTask(String(req.params.id), req.body);
  if (!task) {
    res.status(404).json({ error: "Subject not found" });
    return;
  }
  res.status(201).json(task);

  // Auto-solve in background if requested
  if (req.body.autoSolve) {
    const subject = await subjectService.getById(String(req.params.id));
    const tracking = {
      userId: String(req.telegramUser?.id || "anon"),
      operationType: "solve",
      feature: "auto-solve-create",
      endpoint: "/api/subjects/:id/tasks",
    };
    solveTask(task, subject, tracking)
      .then(({ text, files }: { text: string; files: any[] }) => {
        const update: Record<string, any> = { aiAnswer: text };
        if (files.length) update.aiAnswerFiles = files;
        subjectService.updateTask(task._id.toString(), update);
      })
      .catch((e: Error) => console.error("[auto-solve] error:", e.message));
  }
});

// Get task
router.get("/tasks/:taskId", async (req: AuthRequest, res: Response) => {
  const { subject, task } = await subjectService.getTask(String(req.params.taskId));
  if (!task) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ subject: { _id: subject!._id, name: subject!.name, emoji: subject!.emoji }, task });
});

// Update task
router.put("/tasks/:taskId", requireStudent, async (req: AuthRequest, res: Response) => {
  const result = await subjectService.updateTask(String(req.params.taskId), req.body);
  if (!result) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(result.task);

  // Auto-solve in background if requested
  if (req.body.autoSolve && !result.task.aiAnswer) {
    const { subject } = await subjectService.getTask(String(req.params.taskId));
    const tracking = {
      userId: String(req.telegramUser?.id || "anon"),
      operationType: "solve",
      feature: "auto-solve-update",
      endpoint: "/api/subjects/tasks/:taskId",
    };
    solveTask(result.task, subject, tracking)
      .then(({ text, files }: { text: string; files: any[] }) => {
        const update: Record<string, any> = { aiAnswer: text };
        if (files.length) update.aiAnswerFiles = files;
        subjectService.updateTask(String(req.params.taskId), update);
      })
      .catch((e: Error) => console.error("[auto-solve] error:", e.message));
  }
});

// Delete task
router.delete("/tasks/:taskId", requireStudent, async (req: AuthRequest, res: Response) => {
  const result = await subjectService.deleteTask(String(req.params.taskId));
  if (!result) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ success: true });
});

// Force solve task with AI
router.post("/tasks/:taskId/solve", requireStudent, async (req: AuthRequest, res: Response) => {
  try {
    const { subject, task } = await subjectService.getTask(String(req.params.taskId));
    if (!task) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const { text, files } = await solveTask(task, subject, {
      userId: String(req.telegramUser?.id || "anon"),
      operationType: "solve",
      feature: "manual-solve",
      endpoint: "/api/subjects/tasks/:taskId/solve",
    });
    const update: Record<string, any> = { aiAnswer: text };
    if (files.length) update.aiAnswerFiles = files;
    await subjectService.updateTask(String(req.params.taskId), update);

    res.json({ aiAnswer: text, aiAnswerFiles: files });
  } catch (e: any) {
    console.error("[solve] error:", e);
    res.status(500).json({ error: e.message || "Solve failed" });
  }
});

// Download AI-generated file (LaTeX etc.)
router.get("/tasks/:taskId/ai-file/:index", async (req: AuthRequest, res: Response) => {
  const username = `@${req.telegramUser?.username}`;
  if (!(await userService.isStudent(username))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { task } = await subjectService.getTask(String(req.params.taskId));
  if (!task) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const idx = parseInt(String(req.params.index), 10);
  const file = task.aiAnswerFiles?.[idx];
  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const contentTypes: Record<string, string> = { latex: "application/x-tex" };
  res.set("Content-Type", contentTypes[file.format] || "text/plain");
  res.set("Content-Disposition", `attachment; filename="${encodeURIComponent(file.filename)}"`);
  res.send(file.content);
});

// Get task answers
router.get("/tasks/:taskId/answers", async (req: AuthRequest, res: Response) => {
  const username = `@${req.telegramUser?.username}`;
  if (!(await userService.isStudent(username))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { task } = await subjectService.getTask(String(req.params.taskId));
  if (!task) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(task.answers);
});

// Add answer to task
router.post("/tasks/:taskId/answers", requireStudent, async (req: AuthRequest, res: Response) => {
  const result = await subjectService.addAnswer(String(req.params.taskId), req.body);
  if (!result) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(201).json(result.task.answers);
});

// Get task attachments
router.get("/tasks/:taskId/attachments", async (req: AuthRequest, res: Response) => {
  const { task } = await subjectService.getTask(String(req.params.taskId));
  if (!task) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(task.attachments);
});

export default router;
