const { generateText } = require("ai");
const { createModelForTask } = require("./aiService");
const promptService = require("./promptService");
const subjectService = require("./subjectService");

async function getSubjectsList() {
  const subjects = await subjectService.getAll();
  return subjects.map((s) => ({
    id: s._id.toString(),
    name: s.name,
    emoji: s.emoji || "📚",
  }));
}

/**
 * Use AI to extract homework structure from raw text.
 * Returns { subjectId, title, emoji, description } or null on failure.
 */
async function extractHomework(text) {
  const subjects = await getSubjectsList();
  const prompt = await promptService.getPrompt("homework-extract");
  if (!prompt) {
    throw new Error("homework-extract prompt not found");
  }

  const subjectsList = subjects
    .map((s) => `- ${s.emoji} ${s.name} (ID: ${s.id})`)
    .join("\n");

  const systemPrompt = prompt.replace("{subjects}", subjectsList);

  console.log("[homework-creator] extracting from text:", text.slice(0, 200));
  console.log("[homework-creator] subjects:", subjects.map((s) => s.name).join(", "));

  const { text: response } = await generateText({
    model: await createModelForTask("orchestrator"),
    system: systemPrompt,
    messages: [{ role: "user", content: text }],
  });

  console.log("[homework-creator] raw response:", response);

  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("[homework-creator] no JSON in response");
    return null;
  }

  try {
    const result = JSON.parse(jsonMatch[0]);
    return {
      subjectId: result.subjectId || null,
      title: result.title || "Без названия",
      emoji: result.emoji || "📄",
      description: result.description || "",
    };
  } catch (e) {
    console.error("[homework-creator] JSON parse error:", e.message);
    return null;
  }
}

/**
 * Create a homework task in a subject.
 */
async function createHomework(subjectId, { title, emoji, description, attachments }) {
  const task = await subjectService.addTask(subjectId, {
    title,
    emoji: emoji || "📄",
    description: description || "",
    attachments: attachments || [],
  });
  return task;
}

module.exports = { extractHomework, createHomework, getSubjectsList };
