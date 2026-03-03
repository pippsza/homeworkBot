/**
 * Creates tracked AI wrappers for automatic usage recording.
 *
 * Usage:
 *   const ai = createTrackedAI(tracker)
 *   const result = await ai.generateObject(() => generateText({...}), 'model-id', ctx)
 */
function createTrackedAI(tracker) {
  function mapCtx(ctx) {
    const { user, ...rest } = ctx;
    return { ...rest, userInfo: user };
  }

  return {
    /**
     * Wrapper for generateText / generateObject.
     * Tracks usage automatically after getting the result.
     *
     * @param {Function} fn - Async function that calls generateText/generateObject
     * @param {string} model - Model ID for tracking
     * @param {object} ctx - Tracking context (userId, operationType, etc.)
     * @returns {Promise} The original result from fn()
     */
    async generateObject(fn, model, ctx) {
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
        });

        return result;
      } catch (error) {
        tracker.record({
          ...mapCtx(ctx),
          model,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          latencyMs: Date.now() - startTime.getTime(),
          isStreaming: false,
          status: "error",
          errorMessage: error.message,
          requestedAt: startTime,
          completedAt: new Date(),
        });

        throw error;
      }
    },

    /**
     * Returns an onFinish callback for streamText.
     * Plug directly into streamText({ onFinish: ai.onStreamFinish(...) })
     *
     * @param {string} model - Model ID for tracking
     * @param {object} ctx - Tracking context
     * @param {Date} startTime - When the request started
     * @returns {Function} onFinish callback
     */
    onStreamFinish(model, ctx, startTime) {
      return ({ usage }) => {
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
        });
      };
    },
  };
}

module.exports = { createTrackedAI };
