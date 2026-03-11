import { generateText, streamText, convertToModelMessages, LanguageModel, stepCountIs } from "ai";
import { getChatModels, getChatVisionModels, getSolveModels, getProSolveModels, ResolvedModels } from "./modelResolverService";
import KnowledgeDocument from "../models/KnowledgeDocument";
import Info from "../models/Info";
import { ai } from "../lib/tracked-ai";
import type { Provider } from "@pippsza/usage-tracker";
import { debugLog } from "../lib/debugLog";

const promptService = require("./promptService");
const embeddingService = require("./embeddingService");
const qdrantService = require("./qdrantService");
const subjectService = require("./subjectService");

interface SubjectListItem {
  id: string;
  name: string;
  emoji: string;
}

interface OrchestratorDecision {
  needsSearch: boolean;
  subjectId: string | null;
  searchQuery: string | null;
  searchGeneral?: boolean;
}

interface TrackingContext {
  userId?: string;
  operationType?: string;
  feature?: string;
  endpoint?: string;
  provider?: string;
  user?: any;
  chatId?: string | number;
  username?: string | null;
  entityType?: string;
  entityId?: string;
}

interface StreamExtras {
  tools?: Record<string, any>;
  maxSteps?: number;
  toolChoice?: any;
  onFinish?: (event: any) => void;
  tracking?: TrackingContext;
}

interface SolveResult {
  text: string;
  files: Array<{ format: string; content: string; filename: string }>;
}

interface ImageData {
  buffer: Buffer;
  mimeType: string;
}

async function getSubjectsList(): Promise<SubjectListItem[]> {
  const subjects = await subjectService.getAll();
  return subjects.map((s: any) => ({
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
 */
async function generateWithFallback(models: ResolvedModels, opts: Record<string, any>, tracking?: TrackingContext): Promise<any> {
  const safeOpts = { maxRetries: SAFETY.maxRetries, ...opts };

  const doGenerate = (model: LanguageModel) => generateText({ ...safeOpts, model } as any);

  if (tracking) {
    const ctx = {
      userId: tracking.userId || "system",
      operationType: tracking.operationType || "generate",
      feature: tracking.feature,
      endpoint: tracking.endpoint,
      provider: models.primaryProvider as Provider,
      user: tracking.user,
    };

    try {
      return await (ai as any).generateObject(
        () => doGenerate(models.primary),
        models.primaryId,
        ctx
      );
    } catch (e: any) {
      if (models.fallback && isRateLimitError(e)) {
        debugLog("fallback", `Primary model rate-limited, trying fallback: ${models.fallbackId}`);
        return await (ai as any).generateObject(
          () => doGenerate(models.fallback!),
          models.fallbackId!,
          { ...ctx, provider: models.fallbackProvider as Provider }
        );
      }
      throw e;
    }
  }

  // No tracking context — plain call
  try {
    return await doGenerate(models.primary);
  } catch (e: any) {
    if (models.fallback && isRateLimitError(e)) {
      debugLog("fallback", `Primary model rate-limited, trying fallback: ${models.fallbackId}`);
      return await doGenerate(models.fallback);
    }
    throw e;
  }
}

/**
 * Helper: run streamText with fallback on 429/rate-limit errors.
 */
async function streamWithFallback(models: ResolvedModels, opts: Record<string, any>, tracking?: TrackingContext): Promise<any> {
  const safeOpts: any = { maxRetries: SAFETY.maxRetries, ...opts };

  if (tracking) {
    const startTime = new Date();
    const ctx = {
      userId: tracking.userId || "system",
      operationType: tracking.operationType || "chat",
      feature: tracking.feature,
      endpoint: tracking.endpoint,
      provider: models.primaryProvider as Provider,
      user: tracking.user,
    };

    // Chain onFinish: existing callback + tracking callback
    const existingOnFinish = safeOpts.onFinish;
    const trackingOnFinish = ai.onStreamFinish(models.primaryId, ctx, startTime);

    safeOpts.onFinish = existingOnFinish
      ? (event: any) => { trackingOnFinish(event); existingOnFinish(event); }
      : trackingOnFinish;
  }

  try {
    return streamText({ ...safeOpts, model: models.primary } as any);
  } catch (e: any) {
    if (models.fallback && isRateLimitError(e)) {
      debugLog("fallback", `Primary model rate-limited, trying fallback: ${models.fallbackId}`);

      // Re-create tracking onFinish for fallback model
      if (tracking) {
        const startTime = new Date();
        const ctx = {
          userId: tracking.userId || "system",
          operationType: tracking.operationType || "chat",
          feature: tracking.feature,
          endpoint: tracking.endpoint,
          provider: models.fallbackProvider as Provider,
          user: tracking.user,
        };
        const existingOnFinish = opts.onFinish; // original, not the wrapped one
        const trackingOnFinish = ai.onStreamFinish(models.fallbackId!, ctx, startTime);
        safeOpts.onFinish = existingOnFinish
          ? (event: any) => { trackingOnFinish(event); existingOnFinish(event); }
          : trackingOnFinish;
      }

      return streamText({ ...safeOpts, model: models.fallback } as any);
    }
    throw e;
  }
}

function isRateLimitError(e: any): boolean {
  if (e?.statusCode === 429) return true;
  if (e?.status === 429) return true;
  const msg = (e?.message || "").toLowerCase();
  return msg.includes("rate limit") || msg.includes("429") || msg.includes("quota");
}

async function searchGeneralKnowledge(searchQuery: string): Promise<string> {
  try {
    debugLog("orchestrator", `Searching general knowledge: "${searchQuery}"`);
    const embedding = await embeddingService.embedText(searchQuery);
    const results = await qdrantService.searchGeneral(embedding, 5);
    debugLog("orchestrator", `Found ${results.length} general chunks`);
    return results.map((r: any) => r.text).join("\n\n---\n\n");
  } catch (e: any) {
    debugLog("orchestrator-error", `General search error: ${e.message}`);
    return "";
  }
}

async function orchestrate(query: string): Promise<OrchestratorDecision> {
  const [knowledgeCount, infoChunkedCount] = await Promise.all([
    KnowledgeDocument.countDocuments().limit(1),
    Info.countDocuments({ chunkCount: { $gt: 0 } }).limit(1),
  ]);

  if (knowledgeCount === 0 && infoChunkedCount === 0) {
    debugLog("orchestrator", "Skipping — no knowledge documents or chunked infos");
    return { needsSearch: false, subjectId: null, searchQuery: null, searchGeneral: false };
  }

  const subjects = await getSubjectsList();
  const orchestratorPrompt: string | null = await promptService.getPrompt("orchestrator");

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
    debugLog("orchestrator", `Query: ${query}`);
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

    debugLog("orchestrator", `Raw response: ${text}`);

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const decision: OrchestratorDecision = JSON.parse(jsonMatch[0]);
      debugLog("orchestrator", `Decision: ${JSON.stringify(decision)}`);
      return decision;
    }
    debugLog("orchestrator", "No JSON found in response");
  } catch (e: any) {
    debugLog("orchestrator-error", e.message);
  }

  return { needsSearch: false, subjectId: null, searchQuery: null };
}

async function searchKnowledge(subjectId: string, searchQuery: string): Promise<string> {
  try {
    debugLog("orchestrator", `Searching knowledge for subject ${subjectId}: "${searchQuery}"`);
    const embedding = await embeddingService.embedText(searchQuery);
    const results = await qdrantService.search(subjectId, embedding, 5);
    debugLog("orchestrator", `Found ${results.length} chunks`);
    return results.map((r: any) => r.text).join("\n\n---\n\n");
  } catch (e: any) {
    debugLog("orchestrator-error", `Search error: ${e.message}`);
    return "";
  }
}

/**
 * Process a chat query through the orchestrator.
 * Returns a streamText result for streaming responses.
 */
async function processQueryStream(messages: any[], systemPrompt: string, extras: StreamExtras = {}): Promise<any> {
  const lastMsg = messages[messages.length - 1];
  const query: string =
    lastMsg?.parts?.find((p: any) => p.type === "text")?.text ||
    lastMsg?.content ||
    "";

  debugLog("processQueryStream", `User query: ${query}`);
  const decision = await orchestrate(query);

  let context = "";
  if (decision.needsSearch && decision.subjectId && decision.searchQuery) {
    context = await searchKnowledge(decision.subjectId, decision.searchQuery);
    debugLog("processQueryStream", `Subject RAG context length: ${context.length}`);
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
  const streamOpts: Record<string, any> = {
    system: enhancedSystem,
    messages: await convertToModelMessages(messages),
    maxOutputTokens: SAFETY.maxOutputTokens.chat,
  };

  if (extras.tools) streamOpts.tools = extras.tools;
  if (extras.maxSteps) streamOpts.stopWhen = stepCountIs(extras.maxSteps);
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
 */
async function processQuery(
  query: string,
  historyMessages: any[] = [],
  tracking?: TrackingContext,
  imageData: ImageData | null = null
): Promise<{ text: string; extraHistoryContext: string }> {
  debugLog("processQuery", `User query: ${(query || "").slice(0, 150)} | history: ${historyMessages.length} msgs${imageData ? " | with image" : ""}`);
  let systemPrompt: string | null = await promptService.getPrompt("chat-system");

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
  let lastUserMessage: any;
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


  debugLog("processQuery-setup", `Tools: ${Object.keys(tools).length} | ToolNames: ${Object.keys(tools).join(", ")} | MaxSteps: ${maxSteps} | Messages: ${messages.length} | SystemLen: ${enhancedSystem.length}`);

  const result = await generateWithFallback(
    chatModels,
    {
      system: enhancedSystem,
      messages,
      tools,
      stopWhen: stepCountIs(maxSteps),
      toolChoice: "auto",
      maxOutputTokens: SAFETY.maxOutputTokens.chat,
    },
    tracking || { operationType: "chat", feature: "bot-chat" }
  );

  let text: string = result.text;

  // Debug: log steps info
  const steps: any[] = result.steps || [];
  if (steps.length > 0) {
    const stepsInfo = steps.map((s: any, i: number) => ({
      step: i,
      finishReason: s.finishReason,
      hasText: !!s.text,
      textLen: (s.text || "").length,
      toolCalls: (s.toolCalls || []).map((tc: any) => tc.toolName),
      toolResults: (s.toolResults || []).map((tr: any) => ({
        tool: tr.toolName,
        resultKeys: tr.output ? Object.keys(tr.output) : [],
        outputPreview: JSON.stringify(tr.output)?.slice(0, 200),
      })),
      contentTypes: (s.content || []).map((c: any) => c.type),
    }));
    const usageInfo = result.usage ? { input: result.usage.inputTokens, output: result.usage.outputTokens, total: result.usage.totalTokens } : "no usage";
    debugLog("processQuery", `Query: "${(query || "").slice(0, 100)}" | Steps: ${steps.length} | Text: ${(text || "").length} chars | Usage: ${JSON.stringify(usageInfo)}`, stepsInfo);
    console.log(`[processQuery] Steps: ${steps.length} | ToolCalls: ${stepsInfo.map(s => s.toolCalls).flat().join(",")} | Text: ${(text || "").length} chars`);
  }

  // If text is empty, try to recover from steps
  if (!text && steps.length > 0) {
    // 1. Try to get text from any step
    const stepTexts = steps.map((s: any) => s.text).filter(Boolean);
    if (stepTexts.length) {
      text = stepTexts.join("\n");
      debugLog("processQuery", "Recovered text from earlier steps", text.slice(0, 500));
    }

    // 2. Still empty? Always try re-generation — ask AI to respond based on context
    if (!text) {
      const allToolResults = steps.flatMap((s: any) => s.toolResults || []);
      const toolCalls = steps.flatMap((s: any) => s.toolCalls || []).map((tc: any) => tc.toolName);
      const validResults = allToolResults.filter((tr: any) => tr.output != null);
      const errorResults = allToolResults.filter((tr: any) => tr.output?.error);

      let regenPrompt: string;
      if (errorResults.length > 0) {
        const errors = errorResults.map((tr: any) => `${tr.toolName}: ${tr.output.error}`).join("\n");
        regenPrompt = `Ты вызвал инструменты (${toolCalls.join(", ")}), но произошли ошибки:\n${errors}\n\nСообщи пользователю об ошибках.`;
      } else if (validResults.length > 0) {
        const summary = validResults.map((tr: any) => `${tr.toolName}: ${JSON.stringify(tr.output).slice(0, 1000)}`).join("\n");
        regenPrompt = `Пользователь спросил: "${(query || "").slice(0, 200)}"\n\nРезультаты инструментов:\n${summary.slice(0, 3000)}\n\nОтветь пользователю на русском, покажи данные в читаемом виде. Не используй JSON.`;
      } else {
        regenPrompt = `Инструменты (${toolCalls.join(", ") || "неизвестно"}) не вернули результатов. Объясни ошибку и предложи переформулировать запрос.`;
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
      } catch (regenErr: any) {
        debugLog("processQuery-error", `Re-generation failed: ${regenErr.message}`);
      }
    }
  }

  // Guarantee non-empty response
  if (!text) {
    text = "Не удалось обработать запрос. Попробуйте переформулировать или повторить позже.";
    debugLog("processQuery", "Used absolute fallback — no text generated at all", query?.slice(0, 200));
  }

  // Collect tool results for history context so follow-up messages have context
  let extraHistoryContext = "";
  for (const step of steps) {
    for (const tr of step.toolResults || []) {
      if (tr.toolName === "parseDocument" && tr.output?.text) {
        const docText = tr.output.text.slice(0, 3000);
        extraHistoryContext += `\n[Содержимое файла "${tr.output.fileName || "file"}":\n${docText}${tr.output.truncated ? "\n...(обрезано)" : ""}]`;
      } else if (tr.toolName === "listTasks" && tr.output) {
        // Save task IDs and names in a clear, compact format for follow-ups
        const taskSummaries: string[] = [];
        const subjects = tr.output.subjects || (tr.output.tasks ? [{ tasks: tr.output.tasks }] : []);
        for (const s of subjects) {
          for (const t of s.tasks || []) {
            const parts = [`ID:${t.id}`, t.title];
            if ((t.attachments || []).length > 0) parts.push(`файлы:${t.attachments.length}`);
            if ((t.answers || []).length > 0) parts.push(`ответы:${t.answers.length}`);
            taskSummaries.push(parts.join(" | "));
          }
        }
        if (taskSummaries.length > 0) {
          extraHistoryContext += `\n[Найденные задания:\n${taskSummaries.join("\n")}]`;
        }
      } else if (tr.toolName === "getTaskDetails" && tr.output && !tr.output.error) {
        const o = tr.output;
        let detail = `[Задание: ${o.taskTitle} (${o.subjectName})`;
        if ((o.attachments || []).length > 0) detail += ` | файлов: ${o.attachments.length}`;
        if ((o.answers || []).length > 0) detail += ` | ответов: ${o.answers.length}`;
        detail += `]`;
        extraHistoryContext += `\n${detail}`;
      } else if ((tr.toolName === "createHomeworkBatch" || tr.toolName === "createHomework") && tr.output && !tr.output.error) {
        if (tr.output.tasks) {
          const taskList = tr.output.tasks.map((t: any) => `"${t.title}" (ID:${t.taskId}, файлов:${t.attachmentsCount || 0}, ответов:${t.answersCount || 0})`).join(", ");
          extraHistoryContext += `\n[Созданы задания в "${tr.output.subjectName}": ${taskList}]`;
        } else {
          extraHistoryContext += `\n[Создано задание "${tr.output.taskTitle}" (ID:${tr.output.taskId}) в "${tr.output.subjectName}"]`;
        }
      } else if (tr.toolName === "sendTaskFiles" && tr.output && !tr.output.error) {
        extraHistoryContext += `\n[Отправлены файлы задания "${tr.output.taskTitle}": ${tr.output.sentCount} шт.]`;
      } else if (tr.output && !tr.output.error) {
        const summary = JSON.stringify(tr.output).slice(0, 1000);
        extraHistoryContext += `\n[Результат ${tr.toolName}: ${summary}]`;
      }
    }
  }
  // Limit total extra context to avoid bloating history
  if (extraHistoryContext.length > 4000) {
    extraHistoryContext = extraHistoryContext.slice(0, 4000) + "\n...(обрезано)";
  }

  return { text, extraHistoryContext };
}

/**
 * Auto-solve a task using AI.
 */
async function solveTask(
  task: any,
  subject: any,
  tracking?: TrackingContext,
  { usePro = false }: { usePro?: boolean } = {}
): Promise<SolveResult> {
  const autoSolvePrompt: string | null = await promptService.getPrompt("auto-solve");
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
      context = `\nМатериалы из базы знаний:\n${results.map((r: any) => r.text).join("\n\n---\n\n")}`;
    }
    // Also search general knowledge
    const generalResults = await qdrantService.searchGeneral(embedding, 3);
    if (generalResults.length > 0) {
      context += `\nОбщая информация:\n${generalResults.map((r: any) => r.text).join("\n\n---\n\n")}`;
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
  const photoAttachments: any[] = (task.attachments || []).filter((a: any) => a.type === "photo");
  const hasImages = photoAttachments.length > 0;
  const solveModels = usePro
    ? await getProSolveModels(hasImages)
    : await getSolveModels(hasImages);

  let userMessage: any;
  if (hasImages) {
    // Download all task photos and include in the message
    const { getBot } = require("../lib/bot");
    const bot = getBot();
    const contentParts: any[] = [];

    if (bot) {
      for (const att of photoAttachments) {
        try {
          const url = await bot.telegram.getFileLink(att.file_id);
          const res = await fetch(url.href);
          const buffer = Buffer.from(await res.arrayBuffer());
          contentParts.push({ type: "image", image: buffer, mimeType: "image/jpeg" });
        } catch (e: any) {
          debugLog("solveTask-error", `Failed to download photo: ${e.message}`);
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
  const files: Array<{ format: string; content: string; filename: string }> = [];

  if (latexMatch) {
    const safeTitle = task.title.slice(0, 30).replace(/[^\w\sа-яА-ЯёЁ-]/g, "").trim();
    files.push({
      format: "latex",
      content: latexMatch[1].trim(),
      filename: `${safeTitle || "solution"}.tex`,
    });
    debugLog("auto-solve", `LaTeX file generated: ${files[0].filename}`);
  }

  return { text, files };
}

/**
 * Process a chat query with multiple images (non-streaming, for bot).
 */
async function processQueryMultiImage(
  query: string,
  historyMessages: any[] = [],
  tracking?: TrackingContext,
  images: ImageData[] = []
): Promise<string> {
  debugLog("processQueryMultiImage", `Query: ${(query || "").slice(0, 100)} | images: ${images.length}`);

  let systemPrompt: string | null = await promptService.getPrompt("chat-system");
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
  const contentParts: any[] = images.map((img) => ({
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


  const result = await generateWithFallback(
    chatModels,
    {
      system: enhancedSystem,
      messages,
      tools,
      stopWhen: stepCountIs(maxSteps),
      toolChoice: "auto",
      maxOutputTokens: SAFETY.maxOutputTokens.chat,
    },
    tracking || { operationType: "chat", feature: "bot-chat-multi-image" }
  );

  let text: string = result.text;

  const steps: any[] = result.steps || [];
  if (!text && steps.length > 0) {
    const stepTexts = steps.map((s: any) => s.text).filter(Boolean);
    if (stepTexts.length) {
      text = stepTexts.join("\n");
    }
    if (!text) {
      const allToolResults = steps.flatMap((s: any) => s.toolResults || []);
      const toolCalls = steps.flatMap((s: any) => s.toolCalls || []).map((tc: any) => tc.toolName);
      const validResults = allToolResults.filter((tr: any) => tr.output != null);
      let regenPrompt: string;
      if (validResults.length > 0) {
        const summary = validResults.map((tr: any) => `${tr.toolName}: ${JSON.stringify(tr.output)}`).join("\n");
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

export { processQueryStream, processQuery, processQueryMultiImage, solveTask };
