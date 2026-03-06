import { randomUUID } from "crypto";
import { getTokenUsageEventModel } from "./connection";
import { calculateCost, loadPricingFromDb } from "./pricing";
import { registerProject, syncUser } from "./registry";

export interface TrackerConfig {
  projectId: string;
  environment: string;
  project?: {
    name: string;
    description?: string;
    techStack?: string;
    [key: string]: unknown;
  };
  buffer?: {
    maxSize?: number;
    flushIntervalMs?: number;
  };
}

export interface UsageEvent {
  traceId?: string;
  userId: string;
  provider?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  isStreaming?: boolean;
  operationType: string;
  feature?: string;
  endpoint?: string;
  latencyMs: number;
  status: string;
  errorMessage?: string;
  requestedAt: Date;
  completedAt: Date;
  userInfo?: Record<string, unknown>;
  [key: string]: unknown;
}

interface EnrichedEvent extends Omit<UsageEvent, "userInfo"> {
  projectId: string;
  environment: string;
  estimatedCostUsd?: number;
}

export class UsageTracker {
  private config: TrackerConfig;
  private buffer: EnrichedEvent[];
  private syncedUsers: Map<string, number>;
  private flushTimer: ReturnType<typeof setInterval> | null;
  private _started: boolean;

  constructor(config: TrackerConfig) {
    this.config = config;
    this.buffer = [];
    this.syncedUsers = new Map();
    this.flushTimer = null;
    this._started = false;
  }

  /**
   * Start the tracker. Registers project and starts flush timer.
   * Call this after DB connection is ready.
   */
  start(): void {
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
   * Record a usage event. Cost is calculated later in flush() with fresh DB pricing.
   */
  record(event: UsageEvent): void {
    if (!this._started) return;

    // Sync user data (debounced 60s)
    this._maybeSyncUser(event);

    const enriched: EnrichedEvent = {
      ...event,
      traceId: event.traceId || randomUUID(),
      projectId: this.config.projectId,
      environment: this.config.environment,
      provider: event.provider ?? "google",
      isStreaming: event.isStreaming ?? false,
    };

    // Remove userInfo from the event (it's only for user sync)
    delete (enriched as Record<string, unknown>).userInfo;

    this.buffer.push(enriched);

    const maxSize = this.config.buffer?.maxSize ?? 50;
    if (this.buffer.length >= maxSize) {
      this.flush();
    }
  }

  private _maybeSyncUser(event: UsageEvent): void {
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
   * Loads fresh pricing from DB before calculating costs.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const events = [...this.buffer];
    this.buffer = [];

    try {
      // Load fresh pricing from DB (falls back to FALLBACK_PRICING if unavailable)
      let pricingMap: Map<string, { input: number; output: number; cached?: number; reasoning?: number }> | undefined;
      try {
        pricingMap = await loadPricingFromDb();
      } catch {
        // DB pricing unavailable — calculateCost will use FALLBACK_PRICING
      }

      // Calculate cost for each event before saving
      for (const event of events) {
        event.estimatedCostUsd = calculateCost(
          event.model as string,
          event.inputTokens as number,
          event.outputTokens as number,
          event.cachedTokens as number | undefined,
          event.reasoningTokens as number | undefined,
          pricingMap
        );
      }

      const Model = getTokenUsageEventModel();
      await Model.insertMany(events, { ordered: false });
    } catch (error: unknown) {
      // Return unsent events to buffer
      this.buffer.unshift(...events);
      console.error("[UsageTracker] Flush failed:", (error as Error).message);
    }
  }

  /**
   * Graceful shutdown: flush remaining events and clear timer.
   */
  async shutdown(): Promise<void> {
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
export function createUsageTracker(config: TrackerConfig): UsageTracker {
  return new UsageTracker(config);
}
