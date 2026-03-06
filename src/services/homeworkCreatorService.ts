import { generateText } from "ai";
import { createModelForTask } from "./aiService";

const promptService = require("./promptService");
const subjectService = require("./subjectService");

interface SubjectListItem {
  id: string;
  name: string;
  emoji: string;
}

interface ExtractedHomework {
  subjectId: string | null;
  title: string;
  emoji: string;
  description: string;
}

interface CreateHomeworkParams {
  title: string;
  emoji?: string;
  description?: string;
  attachments?: any[];
}

async function getSubjectsList(): Promise<SubjectListItem[]> {
  const subjects = await subjectService.getAll();
  return subjects.map((s: any) => ({
    id: s._id.toString(),
    name: s.name,
    emoji: s.emoji || "\uD83D\uDCDA",
  }));
}

/**
 * Use AI to extract homework structure from raw text.
 * Returns { subjectId, title, emoji, description } or null on failure.
 */
async function extractHomework(text: string): Promise<ExtractedHomework | null> {
  const subjects = await getSubjectsList();
  const prompt: string | null = await promptService.getPrompt("homework-extract");
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
      emoji: result.emoji || "\uD83D\uDCC4",
      description: result.description || "",
    };
  } catch (e: any) {
    console.error("[homework-creator] JSON parse error:", e.message);
    return null;
  }
}

/**
 * Create a homework task in a subject.
 */
async function createHomework(subjectId: string, { title, emoji, description, attachments }: CreateHomeworkParams): Promise<any> {
  const task = await subjectService.addTask(subjectId, {
    title,
    emoji: emoji || "\uD83D\uDCC4",
    description: description || "",
    attachments: attachments || [],
  });
  return task;
}

export { extractHomework, createHomework, getSubjectsList };
