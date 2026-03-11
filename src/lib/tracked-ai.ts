/**
 * Project-specific usage tracker initialization.
 * Uses @pippsza/usage-tracker npm package.
 */
import { createUsageTracker, createTrackedAI, getUsageConnection } from '@pippsza/usage-tracker'
import type { UsageTracker, TrackingContext } from '@pippsza/usage-tracker'

const PROJECT_ID = 'homework-bot'
const ENVIRONMENT = (process.env.NODE_ENV === 'production' ? 'production' : 'development') as
  | 'production'
  | 'staging'
  | 'development'

// Check if tracking is enabled (USAGE_DATABASE_URI must be set)
const isEnabled = !!process.env.USAGE_DATABASE_URI

// ── No-op fallbacks when tracking is disabled ──

const noOpTracker = {
  record() {},
  async flush() {},
  async shutdown() {},
  async getAvailableModels() { return [] as never[] },
}

const noOpAI = {
  async generateObject(fn: () => Promise<any>) { return fn() },
  onStreamFinish() { return () => {} },
  async transcribe(fn: () => Promise<any>) { return fn() },
  async embed(fn: () => Promise<any>) { return fn() },
  async generateMedia(fn: () => Promise<any>) { return fn() },
}

// ── Initialization ──

let usageTracker: UsageTracker | typeof noOpTracker
let ai: ReturnType<typeof createTrackedAI> | typeof noOpAI

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

// ── Exports ──

export function startTracking(): void {
  // Auto-started by createUsageTracker constructor
}

export async function stopTracking(): Promise<void> {
  if (isEnabled) {
    await usageTracker.shutdown()
    const conn = getUsageConnection()
    await conn.close()
  }
}

export { usageTracker, ai, isEnabled }
export type { TrackingContext }
