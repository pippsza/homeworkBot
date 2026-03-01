// Legacy catalog (used by old bot settings menu, will be removed in Phase 3)
const AI_MODELS = {
  "gemini-2.5-flash-lite": {
    name: "Gemini 2.5 Flash Lite",
    desc: "15 RPM, 1000 req/day — лучший free tier",
  },
  "gemini-2.5-flash": {
    name: "Gemini 2.5 Flash",
    desc: "10 RPM, 250 req/day — основная Flash",
  },
  "gemini-2.5-pro": {
    name: "Gemini 2.5 Pro",
    desc: "5 RPM, 100 req/day — самая мощная",
  },
  "gemini-2.0-flash": {
    name: "Gemini 2.0 Flash",
    desc: "5 RPM, ~250 req/day — старая Flash",
  },
  "gemini-2.0-flash-lite": {
    name: "Gemini 2.0 Flash Lite",
    desc: "Лёгкая модель, отдельная квота",
  },
  "gemini-3-flash-preview": {
    name: "Gemini 3 Flash (Preview)",
    desc: "Новейшая модель, preview",
  },
};

// Legacy tasks (used by old bot settings menu, will be removed in Phase 3)
const MODEL_TASKS = {
  chat: { label: "💬 AI-чат", default: "gemini-2.5-flash-lite" },
  orchestrator: { label: "🧠 Оркестратор", default: "gemini-2.5-flash-lite" },
  autoSolve: { label: "🤖 Авторешение", default: "gemini-2.5-flash" },
};

// New 5-role system for multi-provider AI
const MODEL_ROLES = {
  chat: {
    label: "💬 AI-чат",
    description: "Разговорный AI в боте и Mini App",
    default: { provider: "google", modelId: "gemini-2.5-flash-lite" },
    requirements: { supportsToolCalling: true },
  },
  chatVision: {
    label: "👁️ AI-чат (с фото)",
    description: "AI-чат с поддержкой изображений",
    default: { provider: "google", modelId: "gemini-2.5-flash" },
    requirements: { supportsVision: true, supportsToolCalling: true },
  },
  solveText: {
    label: "🤖 Авторешение (текст)",
    description: "Решение текстовых задач",
    default: { provider: "google", modelId: "gemini-2.5-flash" },
    requirements: {},
  },
  solveTextPro: {
    label: "🧠 Авторешение PRO (текст)",
    description: "Сложные задачи, требующие рассуждений",
    default: { provider: "google", modelId: "gemini-2.5-pro" },
    requirements: { supportsReasoning: true },
  },
  solveImage: {
    label: "🖼️ Авторешение (с фото)",
    description: "Решение задач с изображениями",
    default: { provider: "google", modelId: "gemini-2.5-flash" },
    requirements: { supportsVision: true },
  },
  solveImagePro: {
    label: "🖼️🧠 Авторешение PRO (с фото)",
    description: "Сложные задачи с изображениями",
    default: { provider: "google", modelId: "gemini-2.5-pro" },
    requirements: { supportsVision: true, supportsReasoning: true },
  },
};

module.exports = { AI_MODELS, MODEL_TASKS, MODEL_ROLES };
