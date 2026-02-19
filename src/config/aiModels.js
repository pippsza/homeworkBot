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

const MODEL_TASKS = {
  chat: { label: "💬 AI-чат", default: "gemini-2.5-flash-lite" },
  orchestrator: { label: "🧠 Оркестратор", default: "gemini-2.5-flash-lite" },
  autoSolve: { label: "🤖 Авторешение", default: "gemini-2.5-flash" },
};

module.exports = { AI_MODELS, MODEL_TASKS };
