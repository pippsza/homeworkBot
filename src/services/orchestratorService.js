const { generateText, streamText, convertToModelMessages } = require("ai");
const { getChatModels, getSolveModels } = require("./modelResolverService");
const promptService = require("./promptService");
const embeddingService = require("./embeddingService");
const qdrantService = require("./qdrantService");
const subjectService = require("./subjectService");
const KnowledgeDocument = require("../models/KnowledgeDocument");
const Info = require("../models/Info");
const { ai } = require("../lib/tracked-ai");

async function getSubjectsList() {
  const subjects = await subjectService.getAll();
  return subjects.map((s) => ({
    id: s._id.toString(),
    name: s.name,
    emoji: s.emoji,
  }));
}

// Safety defaults per AI_STRATEGY.md
const SAFETY = {
  maxRetries: 0, // no auto-retries on paid models to prevent cost overruns
  maxOutputTokens: {
    orchestrator: 256, // short JSON response
    chat: 4096, // chat responses
    solve: 8192, // auto-solve can be lengthy
  },
};

/**
 * Helper: run generateText with fallback on 429/rate-limit errors.
 * @param {object} models - { primary, fallback, primaryId, fallbackId, primaryProvider, fallbackProvider }
 * @param {object} opts - generateText options (without model)
 * @param {object} [tracking] - optional tracking context { userId, operationType, feature, ... }
 */
async function generateWithFallback(models, opts, tracking) {
  const safeOpts = { maxRetries: SAFETY.maxRetries, ...opts };

  const doGenerate = (model) => generateText({ ...safeOpts, model });

  if (tracking) {
    const ctx = {
      userId: tracking.userId || "system",
      operationType: tracking.operationType || "generate",
      feature: tracking.feature,
      endpoint: tracking.endpoint,
      provider: models.primaryProvider,
      user: tracking.user,
    };

    try {
      return await ai.generateObject(
        () => doGenerate(models.primary),
        models.primaryId,
        ctx
      );
    } catch (e) {
      if (models.fallback && isRateLimitError(e)) {
        console.log(`[fallback] Primary model rate-limited, trying fallback: ${models.fallbackId}`);
        return await ai.generateObject(
          () => doGenerate(models.fallback),
          models.fallbackId,
          { ...ctx, provider: models.fallbackProvider }
        );
      }
      throw e;
    }
  }

  // No tracking context — plain call
  try {
    return await doGenerate(models.primary);
  } catch (e) {
    if (models.fallback && isRateLimitError(e)) {
      console.log(`[fallback] Primary model rate-limited, trying fallback: ${models.fallbackId}`);
      return await doGenerate(models.fallback);
    }
    throw e;
  }
}

/**
 * Helper: run streamText with fallback on 429/rate-limit errors.
 * @param {object} models - resolved models
 * @param {object} opts - streamText options (without model)
 * @param {object} [tracking] - optional tracking context
 */
async function streamWithFallback(models, opts, tracking) {
  const safeOpts = { maxRetries: SAFETY.maxRetries, ...opts };

  if (tracking) {
    const startTime = new Date();
    const ctx = {
      userId: tracking.userId || "system",
      operationType: tracking.operationType || "chat",
      feature: tracking.feature,
      endpoint: tracking.endpoint,
      provider: models.primaryProvider,
      user: tracking.user,
    };

    // Chain onFinish: existing callback + tracking callback
    const existingOnFinish = safeOpts.onFinish;
    const trackingOnFinish = ai.onStreamFinish(models.primaryId, ctx, startTime);

    safeOpts.onFinish = existingOnFinish
      ? (event) => { trackingOnFinish(event); existingOnFinish(event); }
      : trackingOnFinish;
  }

  try {
    return streamText({ ...safeOpts, model: models.primary });
  } catch (e) {
    if (models.fallback && isRateLimitError(e)) {
      console.log(`[fallback] Primary model rate-limited, trying fallback: ${models.fallbackId}`);

      // Re-create tracking onFinish for fallback model
      if (tracking) {
        const startTime = new Date();
        const ctx = {
          userId: tracking.userId || "system",
          operationType: tracking.operationType || "chat",
          feature: tracking.feature,
          endpoint: tracking.endpoint,
          provider: models.fallbackProvider,
          user: tracking.user,
        };
        const existingOnFinish = opts.onFinish; // original, not the wrapped one
        const trackingOnFinish = ai.onStreamFinish(models.fallbackId, ctx, startTime);
        safeOpts.onFinish = existingOnFinish
          ? (event) => { trackingOnFinish(event); existingOnFinish(event); }
          : trackingOnFinish;
      }

      return streamText({ ...safeOpts, model: models.fallback });
    }
    throw e;
  }
}

function isRateLimitError(e) {
  if (e?.statusCode === 429) return true;
  if (e?.status === 429) return true;
  const msg = (e?.message || "").toLowerCase();
  return msg.includes("rate limit") || msg.includes("429") || msg.includes("quota");
}

async function searchGeneralKnowledge(searchQuery) {
  try {
    console.log(`[orchestrator] searching general knowledge: "${searchQuery}"`);
    const embedding = await embeddingService.embedText(searchQuery);
    const results = await qdrantService.searchGeneral(embedding, 5);
    console.log(`[orchestrator] found ${results.length} general chunks`);
    return results.map((r) => r.text).join("\n\n---\n\n");
  } catch (e) {
    console.error("[orchestrator] general search error:", e.message);
    return "";
  }
}

async function orchestrate(query) {
  const [knowledgeCount, infoChunkedCount] = await Promise.all([
    KnowledgeDocument.countDocuments().limit(1),
    Info.countDocuments({ chunkCount: { $gt: 0 } }).limit(1),
  ]);

  if (knowledgeCount === 0 && infoChunkedCount === 0) {
    console.log("[orchestrator] skipping — no knowledge documents or chunked infos");
    return { needsSearch: false, subjectId: null, searchQuery: null, searchGeneral: false };
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
    const chatModels = await getChatModels();

    const { text } = await generateWithFallback(
      chatModels,
      {
        system: prompt,
        messages: [{ role: "user", content: query }],
        maxOutputTokens: SAFETY.maxOutputTokens.orchestrator,
      },
      { operationType: "orchestrator", feature: "rag-routing" }
    );

    console.log("[orchestrator] raw response:", text);

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

  return { needsSearch: false, subjectId: null, searchQuery: null };
}

async function searchKnowledge(subjectId, searchQuery) {
  try {
    console.log(`[orchestrator] searching knowledge for subject ${subjectId}: "${searchQuery}"`);
    const embedding = await embeddingService.embedText(searchQuery);
    const results = await qdrantService.search(subjectId, embedding, 5);
    console.log(`[orchestrator] found ${results.length} chunks`);
    return results.map((r) => r.text).join("\n\n---\n\n");
  } catch (e) {
    console.error("[orchestrator] search error:", e.message);
    return "";
  }
}

/**
 * Process a chat query through the orchestrator.
 * Returns a streamText result for streaming responses.
 * @param {Array} messages - UI messages
 * @param {string} systemPrompt - system prompt
 * @param {object} extras - { tools, maxSteps, toolChoice, onFinish, tracking }
 */
async function processQueryStream(messages, systemPrompt, extras = {}) {
  const lastMsg = messages[messages.length - 1];
  const query =
    lastMsg?.parts?.find((p) => p.type === "text")?.text ||
    lastMsg?.content ||
    "";

  console.log("[processQueryStream] user query:", query);
  const decision = await orchestrate(query);

  let context = "";
  if (decision.needsSearch && decision.subjectId && decision.searchQuery) {
    context = await searchKnowledge(decision.subjectId, decision.searchQuery);
    console.log("[processQueryStream] subject RAG context length:", context.length);
  }
  if (decision.searchGeneral && decision.searchQuery) {
    const generalContext = await searchGeneralKnowledge(decision.searchQuery);
    if (generalContext) {
      context = context
        ? context + "\n\n---\nОбщая информация:\n" + generalContext
        : generalContext;
    }
  }

  let enhancedSystem = systemPrompt || "You are a helpful assistant.";
  if (context) {
    enhancedSystem += `\n\nRelated information from knowledge base:\n${context}`;
  }

  const chatModels = await getChatModels();
  const streamOpts = {
    system: enhancedSystem,
    messages: await convertToModelMessages(messages),
    maxOutputTokens: SAFETY.maxOutputTokens.chat,
  };

  if (extras.tools) streamOpts.tools = extras.tools;
  if (extras.maxSteps) streamOpts.maxSteps = extras.maxSteps;
  if (extras.toolChoice) streamOpts.toolChoice = extras.toolChoice;
  if (extras.onFinish) streamOpts.onFinish = extras.onFinish;

  // Build tracking context from extras
  const tracking = extras.tracking || {
    operationType: "chat",
    feature: "web-chat",
    endpoint: "/api/ai/chat",
  };

  return streamWithFallback(chatModels, streamOpts, tracking);
}

/**
 * Process a chat query and return full text (non-streaming, for bot).
 * @param {string} query
 * @param {Array} historyMessages
 * @param {object} [tracking] - optional tracking context
 */
async function processQuery(query, historyMessages = [], tracking) {
  console.log("[processQuery] user query:", query, "| history:", historyMessages.length, "msgs");
  let systemPrompt = await promptService.getPrompt("chat-system");

  const decision = await orchestrate(query);

  let context = "";
  if (decision.needsSearch && decision.subjectId && decision.searchQuery) {
    context = await searchKnowledge(decision.subjectId, decision.searchQuery);
  }
  if (decision.searchGeneral && decision.searchQuery) {
    const generalContext = await searchGeneralKnowledge(decision.searchQuery);
    if (generalContext) {
      context = context
        ? context + "\n\n---\nОбщая информация:\n" + generalContext
        : generalContext;
    }
  }

  let enhancedSystem = systemPrompt || "You are a helpful assistant.";
  if (context) {
    enhancedSystem += `\n\nRelated information from knowledge base:\n${context}`;
  }

  // Add assistant tools
  const { buildAssistantTools } = require("./aiToolsService");
  const { tools, systemPromptAddition, maxSteps } = await buildAssistantTools();
  enhancedSystem += systemPromptAddition;

  const messages = [...historyMessages, { role: "user", content: query }];
  const chatModels = await getChatModels();

  const { text } = await generateWithFallback(
    chatModels,
    {
      system: enhancedSystem,
      messages,
      tools,
      maxSteps,
      toolChoice: "auto",
      maxOutputTokens: SAFETY.maxOutputTokens.chat,
    },
    tracking || { operationType: "chat", feature: "bot-chat" }
  );

  return text;
}

/**
 * Auto-solve a task using AI.
 * @param {object} task
 * @param {object} subject
 * @param {object} [tracking] - optional tracking context
 */
async function solveTask(task, subject, tracking) {
  const autoSolvePrompt = await promptService.getPrompt("auto-solve");
  if (!autoSolvePrompt) {
    throw new Error("auto-solve prompt not found");
  }

  let taskDescription = "";
  if (task.description) {
    taskDescription = `\nОписание:\n${task.description}`;
  }

  // Check for knowledge
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
    // Also search general knowledge
    const generalResults = await qdrantService.searchGeneral(embedding, 3);
    if (generalResults.length > 0) {
      context += `\nОбщая информация:\n${generalResults.map((r) => r.text).join("\n\n---\n\n")}`;
    }
  } catch {
    // No knowledge base
  }

  const prompt = autoSolvePrompt
    .replace("{subject}", subject.name)
    .replace("{title}", task.title)
    .replace("{description}", taskDescription)
    .replace("{context}", context);

  // Determine if task has images (check attachments)
  const hasImages = task.attachments?.some((a) => a.type === "photo") || false;
  const solveModels = await getSolveModels(hasImages);

  const { text: raw } = await generateWithFallback(
    solveModels,
    {
      messages: [{ role: "user", content: prompt }],
      maxOutputTokens: SAFETY.maxOutputTokens.solve,
    },
    tracking || {
      operationType: "solve",
      feature: "auto-solve",
      entityType: "task",
      entityId: task._id?.toString(),
    }
  );

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
