import { UsageTracker, UsageEvent } from "./tracker";

interface TrackingContext {
  userId: string;
  operationType: string;
  user?: Record<string, unknown>;
  [key: string]: unknown;
}

interface AIResult {
  usage?: {
    inputTokens?: number;
    promptTokens?: number;
    outputTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cachedTokens?: number;
    reasoningTokens?: number;
  };
  [key: string]: unknown;
}

interface StreamFinishPayload {
  usage?: {
    inputTokens?: number;
    promptTokens?: number;
    outputTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cachedTokens?: number;
    reasoningTokens?: number;
  };
}

export interface TrackedAI {
  generateObject<T extends AIResult>(fn: () => Promise<T>, model: string, ctx: TrackingContext): Promise<T>;
  onStreamFinish(model: string, ctx: TrackingContext, startTime: Date): (payload: StreamFinishPayload) => void;
}

/**
 * Creates tracked AI wrappers for automatic usage recording.
 *
 * Usage:
 *   const ai = createTrackedAI(tracker)
 *   const result = await ai.generateObject(() => generateText({...}), 'model-id', ctx)
 */
export function createTrackedAI(tracker: UsageTracker): TrackedAI {
  function mapCtx(ctx: TrackingContext): Omit<TrackingContext, "user"> & { userInfo?: Record<string, unknown> } {
    const { user, ...rest } = ctx;
    return { ...rest, userInfo: user };
  }

  return {
    /**
     * Wrapper for generateText / generateObject.
     * Tracks usage automatically after getting the result.
     */
    async generateObject<T extends AIResult>(fn: () => Promise<T>, model: string, ctx: TrackingContext): Promise<T> {
      const startTime = new Date();

      try {
        const result = await fn();

        tracker.record({
          ...mapCtx(ctx),
          model,
          inputTokens: result.usage?.inputTokens ?? result.usage?.promptTokens ?? 0,
          outputTokens: result.usage?.outputTokens ?? result.usage?.completionTokens ?? 0,
          totalTokens: result.usage?.totalTokens ?? 0,
          cachedTokens: result.usage?.cachedTokens,
          reasoningTokens: result.usage?.reasoningTokens,
          latencyMs: Date.now() - startTime.getTime(),
          isStreaming: false,
          status: "success",
          requestedAt: startTime,
          completedAt: new Date(),
        } as UsageEvent);

        return result;
      } catch (error: unknown) {
        tracker.record({
          ...mapCtx(ctx),
          model,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          latencyMs: Date.now() - startTime.getTime(),
          isStreaming: false,
          status: "error",
          errorMessage: (error as Error).message,
          requestedAt: startTime,
          completedAt: new Date(),
        } as UsageEvent);

        throw error;
      }
    },

    /**
     * Returns an onFinish callback for streamText.
     * Plug directly into streamText({ onFinish: ai.onStreamFinish(...) })
     */
    onStreamFinish(model: string, ctx: TrackingContext, startTime: Date) {
      return ({ usage }: StreamFinishPayload) => {
        tracker.record({
          ...mapCtx(ctx),
          model,
          inputTokens: usage?.inputTokens ?? usage?.promptTokens ?? 0,
          outputTokens: usage?.outputTokens ?? usage?.completionTokens ?? 0,
          totalTokens: usage?.totalTokens ?? 0,
          cachedTokens: usage?.cachedTokens,
          reasoningTokens: usage?.reasoningTokens,
          latencyMs: Date.now() - startTime.getTime(),
          isStreaming: true,
          status: "success",
          requestedAt: startTime,
          completedAt: new Date(),
        } as UsageEvent);
      };
    },
  };
}
