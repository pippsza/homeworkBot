export interface TrackerConfig {
  projectId: string
  environment: 'production' | 'staging' | 'development'
  buffer?: {
    maxSize?: number
    flushIntervalMs?: number
  }
  project?: {
    name: string
    description?: string
    url?: string
    techStack?: string
    team?: string
    contactEmail?: string
  }
}

export interface UsageEvent {
  userId: string
  provider?: 'openai' | 'anthropic' | 'google' | 'custom'
  model: string
  modelGroup?: string
  operationType: string
  feature?: string
  endpoint?: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens?: number
  reasoningTokens?: number
  latencyMs: number
  isStreaming?: boolean
  status: 'success' | 'error' | 'timeout' | 'rate_limited'
  errorCode?: string
  errorMessage?: string
  promptSummary?: string
  responseSummary?: string
  entityType?: string
  entityId?: string
  traceId?: string
  requestedAt: Date
  completedAt: Date
  userInfo?: {
    email?: string
    name?: string
    role?: string
    avatarUrl?: string
    meta?: Record<string, unknown>
  }
}

export interface TrackingContext {
  userId: string
  operationType: string
  feature?: string
  endpoint?: string
  promptSummary?: string
  entityType?: string
  entityId?: string
  traceId?: string
  user?: {
    email?: string
    name?: string
    role?: string
    avatarUrl?: string
    meta?: Record<string, unknown>
  }
}
