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

export type PricingType = 'per_token' | 'per_minute' | 'per_character'
export type UnitType = 'token' | 'minute' | 'character'
export type Provider = 'openai' | 'anthropic' | 'google' | 'elevenlabs' | 'openrouter' | 'custom'

export interface UsageEvent {
  userId: string
  provider?: Provider
  model: string
  modelGroup?: string
  unitType?: UnitType
  operationType: string
  feature?: string
  endpoint?: string
  // Token-based fields (unitType: 'token')
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cachedTokens?: number
  reasoningTokens?: number
  // Duration-based fields (unitType: 'minute')
  durationSeconds?: number
  // Character-based fields (unitType: 'character')
  characters?: number
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

export interface AvailableModel {
  model: string
  provider: string
  pricingType?: PricingType
  displayName?: string
  description?: string
  contextLength?: number
  // Per-token pricing
  inputPricePerMillionTokens?: number
  outputPricePerMillionTokens?: number
  cachedInputPricePerMillionTokens?: number
  reasoningPricePerMillionTokens?: number
  // Per-minute pricing
  pricePerMinute?: number
  includedMinutesPerMonth?: number
  additionalPricePerMinute?: number
  // Per-character pricing
  pricePerMillionCharacters?: number
  supportsVision: boolean
  supportsToolCalling: boolean
  supportsReasoning: boolean
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
