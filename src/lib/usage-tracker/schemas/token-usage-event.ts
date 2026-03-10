import { Schema, type InferSchemaType } from 'mongoose'

const tokenUsageEventSchema = new Schema(
  {
    // ── Ідентифікація ──
    traceId: {
      type: String,
      required: true,
      index: true,
    },

    // ── Джерело ──
    projectId: {
      type: String,
      required: true,
      index: true,
    },
    environment: {
      type: String,
      required: true,
      enum: ['production', 'staging', 'development'],
      default: 'production',
    },
    serverInstanceId: String,

    // ── Користувач ──
    // Людиночитабельні дані (email, name, role) — в колекції `users`
    userId: {
      type: String,
      required: true,
      index: true,
    },

    // ── AI-провайдер ──
    provider: {
      type: String,
      required: true,
      enum: ['openai', 'anthropic', 'google', 'elevenlabs', 'openrouter', 'custom'],
      default: 'openai',
    },
    model: {
      type: String,
      required: true,
      index: true,
    },
    modelGroup: String,

    // ── Тип одиниці обліку ──
    unitType: {
      type: String,
      enum: ['token', 'minute', 'character'],
      default: 'token',
    },

    // ── Токени (для unitType: 'token') ──
    inputTokens: { type: Number, min: 0 },
    outputTokens: { type: Number, min: 0 },
    totalTokens: { type: Number, min: 0 },
    cachedTokens: { type: Number, min: 0 },
    reasoningTokens: { type: Number, min: 0 },

    // ── Тривалість (для unitType: 'minute') ──
    durationSeconds: { type: Number, min: 0 },

    // ── Символи (для unitType: 'character') ──
    characters: { type: Number, min: 0 },

    // ── Вартість ──
    estimatedCostUsd: { type: Number, required: true, min: 0 },
    pricingVersion: String,

    // ── Метадані запиту (довільні, визначає проєкт) ──
    operationType: {
      type: String,
      required: true,
    },
    feature: String,
    endpoint: String,

    // ── Продуктивність ──
    latencyMs: { type: Number, required: true, min: 0 },
    isStreaming: { type: Boolean, default: false },

    // ── Статус ──
    status: {
      type: String,
      required: true,
      enum: ['success', 'error', 'timeout', 'rate_limited'],
      default: 'success',
    },
    errorCode: String,
    errorMessage: String,

    // ── Контекст промпту (опціонально, визначає проєкт) ──
    promptSummary: String,   // перші ~500 символів промпту або опис задачі
    responseSummary: String, // перші ~500 символів відповіді або опис результату

    // ── Контекст сутності (довільний, визначає проєкт) ──
    entityType: String,
    entityId: String,

    // ── Часові мітки запиту ──
    requestedAt: { type: Date, required: true },
    completedAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    collection: 'tokenUsageEvents',
  },
)

// Складені індекси для типових запитів дашборду
tokenUsageEventSchema.index({ projectId: 1, createdAt: -1 })
tokenUsageEventSchema.index({ userId: 1, createdAt: -1 })
tokenUsageEventSchema.index({ projectId: 1, userId: 1, createdAt: -1 })
tokenUsageEventSchema.index({ model: 1, createdAt: -1 })

// TTL: автоматичне видалення сирих подій через 90 днів
tokenUsageEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 })

export type TokenUsageEventDoc = InferSchemaType<typeof tokenUsageEventSchema>
export { tokenUsageEventSchema }
