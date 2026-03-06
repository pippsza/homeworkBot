const { generateText, streamText, convertToModelMessages } = require("ai");
const { getChatModels, getChatVisionModels, getSolveModels, getProSolveModels } = require("./modelResolverService");
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

  // Always search general knowledge if chunks exist (cheap: 1 embedding + vector search)
  if (!decision.searchGeneral) {
    const infoChunkedCount = await Info.countDocuments({ chunkCount: { $gt: 0 } }).limit(1);
    if (infoChunkedCount > 0) {
      const searchQuery = decision.searchQuery || query;
      const generalContext = await searchGeneralKnowledge(searchQuery);
      if (generalContext) {
        context = context
          ? context + "\n\n---\nОбщая информация:\n" + generalContext
          : generalContext;
      }
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
async function processQuery(query, historyMessages = [], tracking, imageData = null) {
  console.log("[processQuery] user query:", query, "| history:", historyMessages.length, "msgs", imageData ? "| with image" : "");
  let systemPrompt = await promptService.getPrompt("chat-system");

  const decision = await orchestrate(query || "изображение");

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

  // Always search general knowledge if chunks exist
  if (!decision.searchGeneral) {
    const infoChunkedCount = await Info.countDocuments({ chunkCount: { $gt: 0 } }).limit(1);
    if (infoChunkedCount > 0) {
      const searchQuery = decision.searchQuery || query || "изображение";
      const generalContext = await searchGeneralKnowledge(searchQuery);
      if (generalContext) {
        context = context
          ? context + "\n\n---\nОбщая информация:\n" + generalContext
          : generalContext;
      }
    }
  }

  let enhancedSystem = systemPrompt || "You are a helpful assistant.";
  if (context) {
    enhancedSystem += `\n\nRelated information from knowledge base:\n${context}`;
  }

  // Add assistant tools
  const { buildAssistantTools } = require("./aiToolsService");
  const { tools, systemPromptAddition, maxSteps } = await buildAssistantTools({
    chatId: tracking?.chatId,
    username: tracking?.username,
  });
  enhancedSystem += systemPromptAddition;

  // Build last user message (with or without image)
  let lastUserMessage;
  if (imageData) {
    lastUserMessage = {
      role: "user",
      content: [
        { type: "image", image: imageData.buffer, mimeType: imageData.mimeType },
        { type: "text", text: query || "Что на этом изображении?" },
      ],
    };
  } else {
    lastUserMessage = { role: "user", content: query };
  }

  const messages = [...historyMessages, lastUserMessage];
  const chatModels = imageData ? await getChatVisionModels() : await getChatModels();

  const { debugLog } = require("../lib/debugLog");

  const result = await generateWithFallback(
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

  let text = result.text;

  // Debug: log steps info
  const steps = result.steps || [];
  if (steps.length > 0) {
    const stepsInfo = steps.map((s, i) => ({
      step: i,
      hasText: !!s.text,
      textLen: (s.text || "").length,
      toolCalls: (s.toolCalls || []).map((tc) => tc.toolName),
      toolResults: (s.toolResults || []).map((tr) => ({
        tool: tr.toolName,
        resultKeys: tr.result ? Object.keys(tr.result) : [],
      })),
    }));
    const usageInfo = result.usage ? { prompt: result.usage.promptTokens, completion: result.usage.completionTokens, total: result.usage.totalTokens } : "no usage";
    debugLog("processQuery", `Query: "${(query || "").slice(0, 100)}" | Steps: ${steps.length} | Text: ${(text || "").length} chars | Usage: ${JSON.stringify(usageInfo)}`, stepsInfo);
  }

  // If text is empty, try to recover from steps
  if (!text && steps.length > 0) {
    // 1. Try to get text from any step
    const stepTexts = steps.map((s) => s.text).filter(Boolean);
    if (stepTexts.length) {
      text = stepTexts.join("\n");
      debugLog("processQuery", "Recovered text from earlier steps", text.slice(0, 500));
    }

    // 2. Still empty? Always try re-generation — ask AI to respond based on context
    if (!text) {
      const allToolResults = steps.flatMap((s) => s.toolResults || []);
      const toolCalls = steps.flatMap((s) => s.toolCalls || []).map((tc) => tc.toolName);
      const validResults = allToolResults.filter((tr) => tr.result != null);
      const errorResults = allToolResults.filter((tr) => tr.result?.error);

      let regenPrompt;
      if (errorResults.length > 0) {
        const errors = errorResults.map((tr) => `${tr.toolName}: ${tr.result.error}`).join("\n");
        regenPrompt = `Ты пытался выполнить действия (${toolCalls.join(", ")}), но произошли ошибки:\n${errors}\n\nСообщи пользователю об ошибках и предложи что делать.`;
      } else if (validResults.length > 0) {
        const summary = validResults.map((tr) => `${tr.toolName}: ${JSON.stringify(tr.result)}`).join("\n");
        regenPrompt = `Вот результаты вызванных инструментов:\n${summary}\n\nОпиши пользователю что было сделано. Не используй JSON.`;
      } else {
        regenPrompt = `Ты попытался вызвать инструменты (${toolCalls.join(", ") || "неизвестно"}), но они не вернули результатов. Объясни пользователю что произошла ошибка и предложи переформулировать запрос.`;
      }

      try {
        const regenResult = await generateWithFallback(
          chatModels,
          {
            system: "Ты помощник учебного бота. Отвечай на русском языке. Кратко и по делу. Не используй JSON или блоки кода.",
            messages: [
              ...messages.slice(-3),
              { role: "user", content: regenPrompt },
            ],
            maxOutputTokens: 512,
          },
          tracking ? { ...tracking, operationType: "regen", feature: "tool-result-summary" } : undefined
        );
        if (regenResult.text) {
          text = regenResult.text;
          debugLog("processQuery", "Re-generated response", text.slice(0, 500));
        }
      } catch (regenErr) {
        console.error("[processQuery] re-generation failed:", regenErr.message);
      }
    }
  }

  // Guarantee non-empty response
  if (!text) {
    text = "Не удалось обработать запрос. Попробуйте переформулировать или повторить позже.";
    debugLog("processQuery", "Used absolute fallback — no text generated at all", query?.slice(0, 200));
  }

  // Collect parsed document content from tool results for history context
  let extraHistoryContext = "";
  for (const step of steps) {
    for (const tr of step.toolResults || []) {
      if (tr.toolName === "parseDocument" && tr.result?.text) {
        const docText = tr.result.text.slice(0, 3000);
        extraHistoryContext += `\n[Содержимое файла "${tr.result.fileName || "file"}":\n${docText}${tr.result.truncated ? "\n...(обрезано)" : ""}]`;
      }
    }
  }

  return { text, extraHistoryContext };
}

/**
 * Auto-solve a task using AI.
 * @param {object} task
 * @param {object} subject
 * @param {object} [tracking] - optional tracking context
 */
async function solveTask(task, subject, tracking, { usePro = false } = {}) {
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

  // Download photo attachments for vision
  const photoAttachments = (task.attachments || []).filter((a) => a.type === "photo");
  const hasImages = photoAttachments.length > 0;
  const solveModels = usePro
    ? await getProSolveModels(hasImages)
    : await getSolveModels(hasImages);

  let userMessage;
  if (hasImages) {
    // Download all task photos and include in the message
    const { getBot } = require("../lib/bot");
    const bot = getBot();
    const contentParts = [];

    if (bot) {
      for (const att of photoAttachments) {
        try {
          const url = await bot.telegram.getFileLink(att.file_id);
          const res = await fetch(url.href);
          const buffer = Buffer.from(await res.arrayBuffer());
          contentParts.push({ type: "image", image: buffer, mimeType: "image/jpeg" });
        } catch (e) {
          console.error("[solveTask] failed to download photo:", e.message);
        }
      }
    }
    contentParts.push({ type: "text", text: prompt });
    userMessage = { role: "user", content: contentParts };
  } else {
    userMessage = { role: "user", content: prompt };
  }

  const { text: raw } = await generateWithFallback(
    solveModels,
    {
      messages: [userMessage],
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

/**
 * Process a chat query with multiple images (non-streaming, for bot).
 * @param {string} query
 * @param {Array} historyMessages
 * @param {object} [tracking]
 * @param {Array<{buffer: Buffer, mimeType: string}>} images
 */
async function processQueryMultiImage(query, historyMessages = [], tracking, images = []) {
  console.log("[processQueryMultiImage] query:", (query || "").slice(0, 100), "| images:", images.length);

  let systemPrompt = await promptService.getPrompt("chat-system");
  const decision = await orchestrate(query || "изображение");

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
  if (!decision.searchGeneral) {
    const infoChunkedCount = await Info.countDocuments({ chunkCount: { $gt: 0 } }).limit(1);
    if (infoChunkedCount > 0) {
      const searchQuery = decision.searchQuery || query || "изображение";
      const generalContext = await searchGeneralKnowledge(searchQuery);
      if (generalContext) {
        context = context
          ? context + "\n\n---\nОбщая информация:\n" + generalContext
          : generalContext;
      }
    }
  }

  let enhancedSystem = systemPrompt || "You are a helpful assistant.";
  if (context) {
    enhancedSystem += `\n\nRelated information from knowledge base:\n${context}`;
  }

  const { buildAssistantTools } = require("./aiToolsService");
  const { tools, systemPromptAddition, maxSteps } = await buildAssistantTools({
    chatId: tracking?.chatId,
    username: tracking?.username,
  });
  enhancedSystem += systemPromptAddition;

  // Build content array with all images + text
  const contentParts = images.map((img) => ({
    type: "image",
    image: img.buffer,
    mimeType: img.mimeType,
  }));
  contentParts.push({
    type: "text",
    text: query || `На этих ${images.length} изображениях:`,
  });

  const lastUserMessage = { role: "user", content: contentParts };
  const messages = [...historyMessages, lastUserMessage];
  const chatModels = await getChatVisionModels();

  const { debugLog } = require("../lib/debugLog");

  const result = await generateWithFallback(
    chatModels,
    {
      system: enhancedSystem,
      messages,
      tools,
      maxSteps,
      toolChoice: "auto",
      maxOutputTokens: SAFETY.maxOutputTokens.chat,
    },
    tracking || { operationType: "chat", feature: "bot-chat-multi-image" }
  );

  let text = result.text;

  const steps = result.steps || [];
  if (!text && steps.length > 0) {
    const stepTexts = steps.map((s) => s.text).filter(Boolean);
    if (stepTexts.length) {
      text = stepTexts.join("\n");
    }
    if (!text) {
      const allToolResults = steps.flatMap((s) => s.toolResults || []);
      const toolCalls = steps.flatMap((s) => s.toolCalls || []).map((tc) => tc.toolName);
      const validResults = allToolResults.filter((tr) => tr.result != null);
      let regenPrompt;
      if (validResults.length > 0) {
        const summary = validResults.map((tr) => `${tr.toolName}: ${JSON.stringify(tr.result)}`).join("\n");
        regenPrompt = `Вот результаты вызванных инструментов:\n${summary}\n\nОпиши пользователю что было сделано.`;
      } else {
        regenPrompt = `Инструменты (${toolCalls.join(", ") || "неизвестно"}) не вернули результатов. Объясни ошибку.`;
      }
      try {
        const regenResult = await generateWithFallback(
          chatModels,
          {
            system: "Ты помощник учебного бота. Отвечай на русском. Кратко и по делу.",
            messages: [{ role: "user", content: regenPrompt }],
            maxOutputTokens: 512,
          },
          tracking ? { ...tracking, operationType: "regen", feature: "tool-result-summary" } : undefined
        );
        if (regenResult.text) text = regenResult.text;
      } catch {}
    }
  }

  if (!text) {
    text = "Не удалось обработать запрос. Попробуйте переформулировать или повторить позже.";
  }

  return text;
}

module.exports = { processQueryStream, processQuery, processQueryMultiImage, solveTask };
