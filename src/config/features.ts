/**
 * Перемикачі важких підсистем. Вимкнене НЕ вирізається з коду:
 * повертаємо заглушку, щоб бот працював як довідник по предметах.
 *
 * AI_ENABLED=true    - вмикає orchestrator (чат, авторішення задач, розбір файлів)
 * QDRANT_ENABLED=true - вмикає векторний пошук по методичках (потребує Qdrant)
 */
export const AI_ENABLED = process.env.AI_ENABLED === "true";
export const QDRANT_ENABLED = process.env.QDRANT_ENABLED === "true";

export const AI_OFF_TEXT =
  "🤖 ШІ зараз вимкнено. Працюють предмети, завдання, розклад і нагадування.";
