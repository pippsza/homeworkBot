const { generateText, streamText, convertToModelMessages } = require("ai");
const { createModelForTask } = require("./aiService");
const promptService = require("./promptService");
const embeddingService = require("./embeddingService");
const qdrantService = require("./qdrantService");
const subjectService = require("./subjectService");
const KnowledgeDocument = require("../models/KnowledgeDocument");

async function getSubjectsList() {
  const subjects = await subjectService.getAll();
  return subjects.map((s) => ({
    id: s._id.toString(),
    name: s.name,
    emoji: s.emoji,
  }));
}

async function orchestrate(query) {
  // Skip orchestrator if no knowledge exists (saves 1 API call)
  const knowledgeCount = await KnowledgeDocument.countDocuments().limit(1);
  if (knowledgeCount === 0) {
    console.log("[orchestrator] skipping — no knowledge documents in DB");
    return { needsSearch: false, subjectId: null, searchQuery: null };
  }

  const subjects = await getSubjectsList();
  const orchestratorPrompt = await promptService.getPrompt("orchestrator");

  if (!orchestratorPrompt || subjects.length === 0) {
    return { needsSearch: false, subjectId: null, searchQuery: null };
  }

  const prompt = orchestratorPrompt.replace(
    "{subjects}",
    subjects
      .map((s) => `- ${s.emoji} ${s.name} (ID: ${s.id})`)
      .join("\n")
  );

  try {
    console.log("[orchestrator] query:", query);
    console.log("[orchestrator] available subjects:", subjects.map((s) => `${s.emoji} ${s.name}`).join(", "));

    const { text } = await generateText({
      model: await createModelForTask("orchestrator"),
      system: prompt,
      messages: [{ role: "user", content: query }],
    });

    console.log("[orchestrator] raw response:", text);

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const decision = JSON.parse(jsonMatch[0]);
      console.log("[orchestrator] decision:", JSON.stringify(decision));
      return decision;
    }
    console.log("[orchestrator] no JSON found in response");
  } catch (e) {
    console.error("[orchestrator] error:", e.message);
  }

  console.log("[orchestrator] fallback: no search");
  return { needsSearch: false, subjectId: null, searchQuery: null };
}

async function searchKnowledge(subjectId, searchQuery) {
  try {
    console.log(`[orchestrator] searching knowledge for subject ${subjectId}: "${searchQuery}"`);
    const embedding = await embeddingService.embedText(searchQuery);
    const results = await qdrantService.search(subjectId, embedding, 5);
    console.log(`[orchestrator] found ${results.length} chunks`);
    if (results.length > 0) {
      results.forEach((r, i) => console.log(`[orchestrator]   chunk ${i + 1} (score: ${r.score?.toFixed(3) || "?"}): ${r.text?.slice(0, 100)}...`));
    }
    return results.map((r) => r.text).join("\n\n---\n\n");
  } catch (e) {
    console.error("[orchestrator] search error:", e.message);
    return "";
  }
}

/**
 * Process a chat query through the orchestrator.
 * Returns a streamText result for streaming responses.
 */
async function processQueryStream(messages, systemPrompt, extras = {}) {
  // Get the last user message for orchestration
  const lastMsg = messages[messages.length - 1];
  const query =
    lastMsg?.parts?.find((p) => p.type === "text")?.text ||
    lastMsg?.content ||
    "";

  // Run orchestrator to decide if we need RAG
  console.log("[processQueryStream] user query:", query);
  const decision = await orchestrate(query);

  let context = "";
  if (decision.needsSearch && decision.subjectId && decision.searchQuery) {
    context = await searchKnowledge(decision.subjectId, decision.searchQuery);
    console.log("[processQueryStream] RAG context length:", context.length);
  } else {
    console.log("[processQueryStream] no RAG needed");
  }

  // Build enhanced system prompt
  let enhancedSystem = systemPrompt || "You are a helpful assistant.";
  if (context) {
    enhancedSystem += `\n\nRelated information from knowledge base:\n${context}`;
  }

  const streamOpts = {
    model: await createModelForTask("chat"),
    system: enhancedSystem,
    messages: await convertToModelMessages(messages),
  };

  // Pass through extra options (tools, maxSteps, toolChoice, etc.)
  if (extras.tools) streamOpts.tools = extras.tools;
  if (extras.maxSteps) streamOpts.maxSteps = extras.maxSteps;
  if (extras.toolChoice) streamOpts.toolChoice = extras.toolChoice;

  return streamText(streamOpts);
}

/**
 * Process a chat query and return full text (non-streaming, for bot).
 */
async function processQuery(query, historyMessages = []) {
  console.log("[processQuery] user query:", query, "| history:", historyMessages.length, "msgs");
  const systemPrompt = await promptService.getPrompt("chat-system");

  const decision = await orchestrate(query);

  let context = "";
  if (decision.needsSearch && decision.subjectId && decision.searchQuery) {
    context = await searchKnowledge(decision.subjectId, decision.searchQuery);
    console.log("[processQuery] RAG context length:", context.length);
  } else {
    console.log("[processQuery] no RAG needed");
  }

  let enhancedSystem = systemPrompt || "You are a helpful assistant.";
  if (context) {
    enhancedSystem += `\n\nRelated information from knowledge base:\n${context}`;
  }

  const messages = [...historyMessages, { role: "user", content: query }];

  const { text } = await generateText({
    model: await createModelForTask("chat"),
    system: enhancedSystem,
    messages,
  });

  return text;
}

/**
 * Auto-solve a task using AI.
 */
async function solveTask(task, subject) {
  const autoSolvePrompt = await promptService.getPrompt("auto-solve");
  if (!autoSolvePrompt) {
    throw new Error("auto-solve prompt not found");
  }

  // Build task description
  let taskDescription = "";
  if (task.description) {
    taskDescription = `\nОписание:\n${task.description}`;
  }

  // Check if we have knowledge for this subject
  let context = "";
  try {
    const searchQuery = `${task.title} ${task.description || ""}`.trim();
    const embedding = await embeddingService.embedText(searchQuery);
    const results = await qdrantService.search(
      subject._id.toString(),
      embedding,
      5
    );
    if (results.length > 0) {
      context = `\nМатериалы из базы знаний:\n${results.map((r) => r.text).join("\n\n---\n\n")}`;
    }
  } catch {
    // No knowledge base for this subject, that's ok
  }

  const prompt = autoSolvePrompt
    .replace("{subject}", subject.name)
    .replace("{title}", task.title)
    .replace("{description}", taskDescription)
    .replace("{context}", context);

  const { text: raw } = await generateText({
    model: await createModelForTask("autoSolve"),
    messages: [{ role: "user", content: prompt }],
  });

  // Parse LaTeX block if AI included one
  const latexMatch = raw.match(/---LATEX---\n([\s\S]*?)\n---\/LATEX---/);
  const text = raw.replace(/---LATEX---\n[\s\S]*?\n---\/LATEX---/, "").trim();
  const files = [];

  if (latexMatch) {
    const safeTitle = task.title.slice(0, 30).replace(/[^\w\sа-яА-ЯёЁ-]/g, "").trim();
    files.push({
      format: "latex",
      content: latexMatch[1].trim(),
      filename: `${safeTitle || "solution"}.tex`,
    });
    console.log("[auto-solve] LaTeX file generated:", files[0].filename);
  }

  return { text, files };
}

module.exports = { processQueryStream, processQuery, solveTask };
