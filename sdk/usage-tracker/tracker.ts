import { getTokenUsageEventModel } from './connection'
import { calculateCost, loadPricingFromDb } from './pricing'
import { registerProject, syncUser } from './registry'
import type { TrackerConfig, UsageEvent } from './types'

const USER_SYNC_DEBOUNCE_MS = 60_000

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
          event.inputTokens,
          event.outputTokens,
          event.cachedTokens,
          event.reasoningTokens,
          pricingMap,
        )
      }

      const Model = getTokenUsageEventModel()
      await Model.insertMany(events, { ordered: false })
    } catch (error) {
      // Повернути невідправлені в буфер
      this.buffer.unshift(...events)
      console.error('[UsageTracker] Flush failed:', (error as Error).message)
    }
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer)
    await this.flush()
  }
}

export function createUsageTracker(config: TrackerConfig): UsageTracker {
  return new UsageTracker(config)
}

export type { UsageTracker }
