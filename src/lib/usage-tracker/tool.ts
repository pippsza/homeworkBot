import type { UsageTracker } from './tracker'
import type { TrackingContext } from './types'

/**
 * Створює обгортки над AI SDK функціями з автоматичним трекінгом.
 *
 * Використання:
 *   const ai = createTrackedAI(tracker)
 *   const result = await ai.generateObject(() => generateObject({...}), 'gpt-4.1', ctx)
 */
export function createTrackedAI(tracker: UsageTracker) {
  function mapCtx(ctx: TrackingContext) {
    const { user, ...rest } = ctx
    return { ...rest, userInfo: user }
  }

  return {
    /**
     * Обгортка над generateObject / generateText.
     * Трекає usage автоматично після отримання результату.
     */
    async generateObject<T>(
      fn: () => Promise<
        T & { usage: { inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number; totalTokens?: number } }
      >,
      model: string,
      ctx: TrackingContext,
    ): Promise<T & { usage: { inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number; totalTokens?: number } }> {
      const startTime = new Date()

      try {
        const result = await fn()

        tracker.record({
          ...mapCtx(ctx),
          model,
          inputTokens: result.usage.inputTokens ?? result.usage.promptTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? result.usage.completionTokens ?? 0,
          totalTokens: result.usage.totalTokens ?? 0,
          latencyMs: Date.now() - startTime.getTime(),
          isStreaming: false,
          status: 'success',
          requestedAt: startTime,
          completedAt: new Date(),
        })

        return result
      } catch (error) {
        tracker.record({
          ...mapCtx(ctx),
          model,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          latencyMs: Date.now() - startTime.getTime(),
          isStreaming: false,
          status: 'error',
          errorMessage: (error as Error).message,
          requestedAt: startTime,
          completedAt: new Date(),
        })

        throw error
      }
    },

    /**
     * Повертає onFinish callback для streamText.
     * Підключається напряму в параметри streamText.
     */
    onStreamFinish(model: string, ctx: TrackingContext, startTime: Date) {
      return ({
        usage,
        text,
      }: {
        usage: { inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number; totalTokens?: number }
        text?: string
      }) => {
        tracker.record({
          ...mapCtx(ctx),
          model,
          inputTokens: usage.inputTokens ?? usage.promptTokens ?? 0,
          outputTokens: usage.outputTokens ?? usage.completionTokens ?? 0,
          totalTokens: usage.totalTokens ?? 0,
          latencyMs: Date.now() - startTime.getTime(),
          isStreaming: true,
          status: 'success',
          responseSummary: text ? text.slice(0, 500) : undefined,
          requestedAt: startTime,
          completedAt: new Date(),
        })
      }
    },

    /**
     * Обгортка для транскрибації (per-minute billing).
     * durationSeconds — тривалість аудіо у секундах.
     */
    async transcribe<T>(
      fn: () => Promise<T>,
      model: string,
      durationSeconds: number,
      ctx: TrackingContext,
    ): Promise<T> {
      const startTime = new Date()

      try {
        const result = await fn()

        tracker.record({
          ...mapCtx(ctx),
          model,
          unitType: 'minute',
          durationSeconds,
          latencyMs: Date.now() - startTime.getTime(),
          isStreaming: false,
          status: 'success',
          requestedAt: startTime,
          completedAt: new Date(),
        })

        return result
      } catch (error) {
        tracker.record({
          ...mapCtx(ctx),
          model,
          unitType: 'minute',
          durationSeconds: 0,
          latencyMs: Date.now() - startTime.getTime(),
          isStreaming: false,
          status: 'error',
          errorMessage: (error as Error).message,
          requestedAt: startTime,
          completedAt: new Date(),
        })

        throw error
      }
    },

    /**
     * Обгортка для embedding моделей (per-token billing, output = 0).
     */
    async embed<T>(
      fn: () => Promise<T & { usage?: { totalTokens?: number; promptTokens?: number } }>,
      model: string,
      ctx: TrackingContext,
    ): Promise<T & { usage?: { totalTokens?: number; promptTokens?: number } }> {
      const startTime = new Date()

      try {
        const result = await fn()
        const tokens = result.usage?.totalTokens ?? result.usage?.promptTokens ?? 0

        tracker.record({
          ...mapCtx(ctx),
          model,
          inputTokens: tokens,
          outputTokens: 0,
          totalTokens: tokens,
          latencyMs: Date.now() - startTime.getTime(),
          isStreaming: false,
          status: 'success',
          requestedAt: startTime,
          completedAt: new Date(),
        })

        return result
      } catch (error) {
        tracker.record({
          ...mapCtx(ctx),
          model,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          latencyMs: Date.now() - startTime.getTime(),
          isStreaming: false,
          status: 'error',
          errorMessage: (error as Error).message,
          requestedAt: startTime,
          completedAt: new Date(),
        })

        throw error
      }
    },
  }
}
