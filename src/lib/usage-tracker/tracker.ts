import { getTokenUsageEventModel, getModelPricingModel } from './connection'
import { calculateCost, loadPricingFromDb } from './pricing'
import { registerProject, syncUser } from './registry'
import type { TrackerConfig, UsageEvent, AvailableModel, PricingType } from './types'

const USER_SYNC_DEBOUNCE_MS = 60_000
const MAX_BUFFER_SIZE = 10_000

class UsageTracker {
  private buffer: UsageEvent[] = []
  private config: TrackerConfig
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private syncedUsers = new Map<string, number>()

  constructor(config: TrackerConfig) {
    this.config = config
    const interval = config.buffer?.flushIntervalMs ?? 5_000
    this.flushTimer = setInterval(() => this.flush(), interval)
    if (this.flushTimer.unref) this.flushTimer.unref()

    // Авто-реєстрація проєкту при створенні трекера
    if (config.project) {
      registerProject({
        projectId: config.projectId,
        environment: config.environment,
        ...config.project,
      })
    }
  }

  record(event: UsageEvent): void {
    // Синхронізувати дані юзера (debounce)
    this.maybeSyncUser(event)

    const enriched = {
      ...event,
      projectId: this.config.projectId,
      environment: this.config.environment,
      provider: event.provider ?? 'openai',
      unitType: event.unitType ?? 'token',
      isStreaming: event.isStreaming ?? false,
      traceId: event.traceId ?? crypto.randomUUID(),
    }

    this.buffer.push(enriched as UsageEvent)

    const maxSize = this.config.buffer?.maxSize ?? 50
    if (this.buffer.length >= maxSize) {
      this.flush()
    }
  }

  private maybeSyncUser(event: UsageEvent): void {
    if (!event.userInfo) return

    const key = `${event.userId}:${this.config.projectId}`
    const lastSync = this.syncedUsers.get(key) ?? 0
    const now = Date.now()

    if (now - lastSync < USER_SYNC_DEBOUNCE_MS) return

    this.syncedUsers.set(key, now)

    // Fire-and-forget — не блокує основний потік
    syncUser(this.config.projectId, {
      userId: event.userId,
      ...event.userInfo,
    })
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return

    const events = [...this.buffer]
    this.buffer = []

    try {
      // Завантажити актуальні ціни з DB паралельно з підготовкою
      let pricingMap
      try {
        pricingMap = await loadPricingFromDb()
      } catch {
        // Якщо DB цін недоступна — calculateCost використає FALLBACK_PRICING
      }

      // Розрахувати вартість для кожного евента
      for (const event of events) {
        ;(event as unknown as Record<string, unknown>).estimatedCostUsd = calculateCost(
          event.model,
          {
            unitType: event.unitType,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            cachedTokens: event.cachedTokens,
            reasoningTokens: event.reasoningTokens,
            durationSeconds: event.durationSeconds,
            characters: event.characters,
          },
          pricingMap,
        )
      }

      const Model = getTokenUsageEventModel()
      await Model.insertMany(events, { ordered: false })
    } catch (error) {
      // Повернути невідправлені в буфер
      this.buffer.unshift(...events)
      if (this.buffer.length > MAX_BUFFER_SIZE) {
        console.error(`[UsageTracker] Buffer overflow (${this.buffer.length}), trimming to ${MAX_BUFFER_SIZE}`)
        this.buffer = this.buffer.slice(-MAX_BUFFER_SIZE)
      }
      console.error('[UsageTracker] Flush failed:', (error as Error).message)
    }
  }

  async getAvailableModels(): Promise<AvailableModel[]> {
    return getAvailableModels()
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer)
    await this.flush()
  }
}

/**
 * Завантажує список доступних моделей з бази usage.
 * Повертає тільки активні записи (effectiveTo = null або > now).
 * Для кожної моделі бере найновішу ціну за effectiveFrom.
 * Можна використовувати без інстансу трекера — достатньо USAGE_DATABASE_URI.
 */
export async function getAvailableModels(): Promise<AvailableModel[]> {
  const Model = getModelPricingModel()
  const now = new Date()

  const docs = await Model.find({
    effectiveFrom: { $lte: now },
    $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gt: now } }],
  })
    .sort({ effectiveFrom: -1 })
    .lean()

  // Дедуплікація: для кожної моделі беремо тільки першу (найновішу)
  const seen = new Set<string>()
  const result: AvailableModel[] = []

  for (const doc of docs) {
    const key = String(doc.model)
    if (seen.has(key)) continue
    seen.add(key)

    result.push({
      model: key,
      provider: String(doc.provider),
      pricingType: ((doc.pricingType as string | undefined) ?? 'per_token') as PricingType,
      displayName: doc.displayName ? String(doc.displayName) : undefined,
      description: doc.description ? String(doc.description) : undefined,
      contextLength: doc.contextLength as number | undefined,
      inputPricePerMillionTokens: doc.inputPricePerMillionTokens as number | undefined,
      outputPricePerMillionTokens: doc.outputPricePerMillionTokens as number | undefined,
      cachedInputPricePerMillionTokens: doc.cachedInputPricePerMillionTokens as number | undefined,
      reasoningPricePerMillionTokens: doc.reasoningPricePerMillionTokens as number | undefined,
      pricePerMinute: doc.pricePerMinute as number | undefined,
      includedMinutesPerMonth: doc.includedMinutesPerMonth as number | undefined,
      additionalPricePerMinute: doc.additionalPricePerMinute as number | undefined,
      pricePerMillionCharacters: doc.pricePerMillionCharacters as number | undefined,
      supportsVision: Boolean(doc.supportsVision),
      supportsToolCalling: Boolean(doc.supportsToolCalling),
      supportsReasoning: Boolean(doc.supportsReasoning),
    })
  }

  return result
}

export function createUsageTracker(config: TrackerConfig): UsageTracker {
  return new UsageTracker(config)
}

export type { UsageTracker }
