const { randomUUID } = require("crypto");
const { getTokenUsageEventModel } = require("./connection");
const { calculateCost } = require("./pricing");
const { registerProject, syncUser } = require("./registry");

class UsageTracker {
  constructor(config) {
    this.config = config;
    this.buffer = [];
    this.syncedUsers = new Map(); // userId → lastSyncTs (debounce)
    this.flushTimer = null;
    this._started = false;
  }

  /**
   * Start the tracker. Registers project and starts flush timer.
   * Call this after DB connection is ready.
   */
  start() {
    if (this._started) return;
    this._started = true;

    const interval = this.config.buffer?.flushIntervalMs ?? 5_000;
    this.flushTimer = setInterval(() => this.flush(), interval);
    if (this.flushTimer.unref) this.flushTimer.unref();

    // Auto-register project
    if (this.config.project) {
      registerProject({
        projectId: this.config.projectId,
        environment: this.config.environment,
        ...this.config.project,
      });
    }

    console.log(`[UsageTracker] Started for project: ${this.config.projectId}`);
  }

  /**
   * Record a usage event. Automatically enriches with project info and cost.
   */
  record(event) {
    if (!this._started) return;

    // Sync user data (debounced 60s)
    this._maybeSyncUser(event);

    const enriched = {
      ...event,
      traceId: event.traceId || randomUUID(),
      projectId: this.config.projectId,
      environment: this.config.environment,
      provider: event.provider ?? "openrouter",
      isStreaming: event.isStreaming ?? false,
      estimatedCostUsd: calculateCost(
        event.model,
        event.inputTokens,
        event.outputTokens,
        event.cachedTokens,
        event.reasoningTokens
      ),
    };

    // Remove userInfo from the event (it's only for user sync)
    delete enriched.userInfo;

    this.buffer.push(enriched);

    const maxSize = this.config.buffer?.maxSize ?? 50;
    if (this.buffer.length >= maxSize) {
      this.flush();
    }
  }

  _maybeSyncUser(event) {
    if (!event.userInfo) return;

    const key = `${event.userId}:${this.config.projectId}`;
    const lastSync = this.syncedUsers.get(key) ?? 0;
    const now = Date.now();

    // Debounce: no more than once per 60s per user
    if (now - lastSync < 60_000) return;

    this.syncedUsers.set(key, now);

    // Fire-and-forget
    syncUser(this.config.projectId, {
      userId: event.userId,
      ...event.userInfo,
    });
  }

  /**
   * Flush buffered events to MongoDB.
   */
  async flush() {
    if (this.buffer.length === 0) return;

    const events = [...this.buffer];
    this.buffer = [];

    try {
      const Model = getTokenUsageEventModel();
      await Model.insertMany(events, { ordered: false });
    } catch (error) {
      // Return unsent events to buffer
      this.buffer.unshift(...events);
      console.error("[UsageTracker] Flush failed:", error.message);
    }
  }

  /**
   * Graceful shutdown: flush remaining events and clear timer.
   */
  async shutdown() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
    this._started = false;
    console.log("[UsageTracker] Shut down gracefully");
  }
}

/**
 * Create a new UsageTracker instance.
 * Call .start() when ready (after DB connection).
 */
function createUsageTracker(config) {
  return new UsageTracker(config);
}

module.exports = { UsageTracker, createUsageTracker };
