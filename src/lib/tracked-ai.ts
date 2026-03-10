/**
 * Project-specific usage tracker initialization.
 * This file is NOT copied between projects — it's unique per project.
 */
import { createUsageTracker, createTrackedAI, getUsageConnection } from './usage-tracker'
import type { UsageTracker, TrackingContext } from './usage-tracker'

const PROJECT_ID = 'homework-bot'
const ENVIRONMENT = (process.env.NODE_ENV === 'production' ? 'production' : 'development') as
  | 'production'
  | 'staging'
  | 'development'

// Check if tracking is enabled (USAGE_DATABASE_URI must be set)
const isEnabled = !!process.env.USAGE_DATABASE_URI

// ── TrackedAI interface (matches createTrackedAI return from tool.ts) ──

interface TrackedAI {
  generateObject<T>(
    fn: () => Promise<
      T & {
        usage: {
          inputTokens?: number
          outputTokens?: number
          promptTokens?: number
          completionTokens?: number
          totalTokens?: number
        }
      }
    >,
    model: string,
    ctx: TrackingContext,
  ): Promise<
    T & {
      usage: {
        inputTokens?: number
        outputTokens?: number
        promptTokens?: number
        completionTokens?: number
        totalTokens?: number
      }
    }
  >
  onStreamFinish(
    model: string,
    ctx: TrackingContext,
    startTime: Date,
  ): (arg: {
    usage: {
      inputTokens?: number
      outputTokens?: number
      promptTokens?: number
      completionTokens?: number
      totalTokens?: number
    }
    text?: string
  }) => void
  transcribe<T>(fn: () => Promise<T>, model: string, durationSeconds: number, ctx: TrackingContext): Promise<T>
  embed<T>(
    fn: () => Promise<T & { usage?: { totalTokens?: number; promptTokens?: number } }>,
    model: string,
    ctx: TrackingContext,
  ): Promise<T & { usage?: { totalTokens?: number; promptTokens?: number } }>
}

// ── No-op implementations ──

interface NoOpTracker {
  record(): void
  flush(): Promise<void>
  shutdown(): Promise<void>
  getAvailableModels(): Promise<never[]>
}

const noOpTracker: NoOpTracker = {
  record() {},
  async flush() {},
  async shutdown() {},
  async getAvailableModels() {
    return []
  },
}

const noOpAI: TrackedAI = {
  async generateObject(fn) {
    return fn()
  },
  onStreamFinish() {
    return () => {}
  },
  async transcribe(fn) {
    return fn()
  },
  async embed(fn) {
    return fn()
  },
}

// ── Initialization (auto-start via constructor) ──

let usageTracker: UsageTracker | NoOpTracker
let ai: TrackedAI

if (isEnabled) {
  usageTracker = createUsageTracker({
    projectId: PROJECT_ID,
    environment: ENVIRONMENT,
    project: {
      name: 'HomeworkBot',
      description: 'Telegram homework bot with AI features',
      techStack: 'Node.js, Telegraf v4, Express v5, Mongoose',
    },
  })

  ai = createTrackedAI(usageTracker as UsageTracker)
} else {
  usageTracker = noOpTracker
  ai = noOpAI
}

// ── Graceful shutdown ──

process.on('beforeExit', () => (usageTracker as UsageTracker).shutdown?.())

// ── Backward-compatible exports for index.ts ──

/**
 * Start the tracker. No-op — the new SDK auto-starts in the constructor.
 */
export function startTracking(): void {
  // Auto-started by createUsageTracker constructor
}

/**
 * Graceful shutdown: flush events and close connection.
 */
export async function stopTracking(): Promise<void> {
  if (isEnabled) {
    await usageTracker.shutdown()
    const conn = getUsageConnection()
    await conn.close()
  }
}

export { usageTracker, ai, isEnabled }
