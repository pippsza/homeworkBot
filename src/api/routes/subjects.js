const { Router } = require("express");
const subjectService = require("../../services/subjectService");
const userService = require("../../services/userService");

const router = Router();

async function requireAdmin(req, res, next) {
  const username = `@${req.telegramUser?.username}`;
  if (!(await userService.isAdmin(username))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// Get all subjects
router.get("/", async (req, res) => {
  const subjects = await subjectService.getAll();
  res.json(subjects);
});

// Get subject by id
router.get("/:id", async (req, res) => {
  const subject = await subjectService.getById(req.params.id);
  if (!subject) return res.status(404).json({ error: "Not found" });
  res.json(subject);
});

// Create subject
router.post("/", requireAdmin, async (req, res) => {
  const subject = await subjectService.create(req.body);
  res.status(201).json(subject);
});

// Update subject
router.put("/:id", requireAdmin, async (req, res) => {
  const subject = await subjectService.update(req.params.id, req.body);
  if (!subject) return res.status(404).json({ error: "Not found" });
  res.json(subject);
});

// Delete subject
router.delete("/:id", requireAdmin, async (req, res) => {
  const subject = await subjectService.delete(req.params.id);
  if (!subject) return res.status(404).json({ error: "Not found" });
  res.json({ success: true });
});

// Add task to subject
router.post("/:id/tasks", requireAdmin, async (req, res) => {
  const task = await subjectService.addTask(req.params.id, req.body);
  if (!task) return res.status(404).json({ error: "Subject not found" });
  res.status(201).json(task);
});

// Get task
router.get("/tasks/:taskId", async (req, res) => {
  const { subject, task } = await subjectService.getTask(req.params.taskId);
  if (!task) return res.status(404).json({ error: "Not found" });
  res.json({ subject: { _id: subject._id, name: subject.name }, task });
});

// Update task
router.put("/tasks/:taskId", requireAdmin, async (req, res) => {
  const result = await subjectService.updateTask(req.params.taskId, req.body);
  if (!result) return res.status(404).json({ error: "Not found" });
  res.json(result.task);
});

// Delete task
router.delete("/tasks/:taskId", requireAdmin, async (req, res) => {
  const result = await subjectService.deleteTask(req.params.taskId);
  if (!result) return res.status(404).json({ error: "Not found" });
  res.json({ success: true });
});

// Get task answers
router.get("/tasks/:taskId/answers", async (req, res) => {
  const username = `@${req.telegramUser?.username}`;
  if (!(await userService.isAnswerViewer(username))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { task } = await subjectService.getTask(req.params.taskId);
  if (!task) return res.status(404).json({ error: "Not found" });
  res.json(task.answers);
});

// Add answer to task
router.post("/tasks/:taskId/answers", requireAdmin, async (req, res) => {
  const result = await subjectService.addAnswer(req.params.taskId, req.body);
  if (!result) return res.status(404).json({ error: "Not found" });
  res.status(201).json(result.task.answers);
});

// Get task attachments
router.get("/tasks/:taskId/attachments", async (req, res) => {
  const { task } = await subjectService.getTask(req.params.taskId);
  if (!task) return res.status(404).json({ error: "Not found" });
  res.json(task.attachments);
});

module.exports = router;
