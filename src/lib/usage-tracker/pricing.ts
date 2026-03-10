import { getModelPricingModel } from './connection'
import type { PricingType } from './types'

/**
 * Fallback-ціни (USD за 1M токенів).
 * Використовуються коли модель відсутня в колекції modelPricing.
 * Актуальні на 2026-02.
 */
const FALLBACK_PRICING: Record<
  string,
  { input: number; output: number; cached?: number; reasoning?: number }
> = {
  'gpt-4.1': { input: 2.0, output: 8.0, cached: 0.5 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6, cached: 0.1 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4, cached: 0.025 },
  'gpt-4o': { input: 2.5, output: 10.0, cached: 1.25 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cached: 0.075 },
  o3: { input: 2.0, output: 8.0, reasoning: 8.0 },
  'o3-mini': { input: 1.1, output: 4.4, reasoning: 4.4 },
  'o4-mini': { input: 1.1, output: 4.4, reasoning: 4.4 },
}

/**
 * Fallback-ціни для embedding моделей (USD за 1M токенів).
 */
const FALLBACK_EMBEDDING_PRICING: Record<string, { input: number }> = {
  'text-embedding-3-small': { input: 0.02 },
  'text-embedding-3-large': { input: 0.13 },
  'text-embedding-ada-002': { input: 0.1 },
}

/**
 * Fallback-ціни для транскрибації (USD за хвилину).
 */
const FALLBACK_TRANSCRIPTION_PRICING: Record<string, { pricePerMinute: number }> = {
  'whisper-1': { pricePerMinute: 0.006 },
  'gpt-4o-transcribe': { pricePerMinute: 0.006 },
  'gpt-4o-mini-transcribe': { pricePerMinute: 0.003 },
  scribe_v2: { pricePerMinute: 0.0033 },
}

export interface PricingEntry {
  pricingType: PricingType
  // Per-token
  input?: number
  output?: number
  cached?: number
  reasoning?: number
  // Per-minute
  pricePerMinute?: number
  includedMinutesPerMonth?: number
  additionalPricePerMinute?: number
  // Per-character
  pricePerMillionCharacters?: number
}

/**
 * Завантажує актуальні ціни з колекції modelPricing.
 * Вибирає тільки активні записи (effectiveFrom <= now, effectiveTo null або > now).
 * При кількох записах для однієї моделі — бере найновішу за effectiveFrom.
 */
export async function loadPricingFromDb(): Promise<Map<string, PricingEntry>> {
  const Model = getModelPricingModel()
  const now = new Date()

  const docs = await Model.find({
    effectiveFrom: { $lte: now },
    $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gt: now } }],
  })
    .sort({ effectiveFrom: -1 })
    .lean()

  const map = new Map<string, PricingEntry>()

  for (const doc of docs) {
    const key = String(doc.model)
    if (map.has(key)) continue

    const pricingType = (doc.pricingType as PricingType) ?? 'per_token'

    map.set(key, {
      pricingType,
      input: (doc.inputPricePerMillionTokens as number | undefined) ?? undefined,
      output: (doc.outputPricePerMillionTokens as number | undefined) ?? undefined,
      cached: (doc.cachedInputPricePerMillionTokens as number | undefined) ?? undefined,
      reasoning: (doc.reasoningPricePerMillionTokens as number | undefined) ?? undefined,
      pricePerMinute: (doc.pricePerMinute as number | undefined) ?? undefined,
      includedMinutesPerMonth: (doc.includedMinutesPerMonth as number | undefined) ?? undefined,
      additionalPricePerMinute: (doc.additionalPricePerMinute as number | undefined) ?? undefined,
      pricePerMillionCharacters: (doc.pricePerMillionCharacters as number | undefined) ?? undefined,
    })
  }

  return map
}

/**
 * Розраховує вартість запиту в USD для per-token моделей.
 */
export function calculateTokenCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens = 0,
  reasoningTokens = 0,
  pricingMap?: Map<string, PricingEntry>,
): number {
  const pricing = pricingMap?.get(model)
  const fallback = FALLBACK_PRICING[model] ?? FALLBACK_EMBEDDING_PRICING[model]

  const input = pricing?.input ?? fallback?.input ?? 0
  const output = pricing?.output ?? (fallback as { output?: number } | undefined)?.output ?? 0
  const cached = pricing?.cached ?? (fallback as { cached?: number } | undefined)?.cached
  const reasoning = pricing?.reasoning ?? (fallback as { reasoning?: number } | undefined)?.reasoning

  if (input === 0 && output === 0) return 0

  let cost = 0
  cost += ((inputTokens - cachedTokens) / 1_000_000) * input
  if (cachedTokens && cached) cost += (cachedTokens / 1_000_000) * cached
  cost += (outputTokens / 1_000_000) * output
  if (reasoningTokens && reasoning) cost += (reasoningTokens / 1_000_000) * reasoning

  return Math.round(cost * 1_000_000) / 1_000_000
}

/**
 * Розраховує вартість транскрибації в USD (per-minute).
 */
export function calculateMinuteCost(
  model: string,
  durationSeconds: number,
  pricingMap?: Map<string, PricingEntry>,
): number {
  const pricing = pricingMap?.get(model)
  const fallback = FALLBACK_TRANSCRIPTION_PRICING[model]

  const pricePerMinute = pricing?.pricePerMinute ?? fallback?.pricePerMinute ?? 0
  if (pricePerMinute === 0) return 0

  const minutes = durationSeconds / 60
  const cost = minutes * pricePerMinute

  return Math.round(cost * 1_000_000) / 1_000_000
}

/**
 * Розраховує вартість per-character в USD.
 */
export function calculateCharacterCost(
  model: string,
  characters: number,
  pricingMap?: Map<string, PricingEntry>,
): number {
  const pricing = pricingMap?.get(model)
  const pricePerMillion = pricing?.pricePerMillionCharacters ?? 0
  if (pricePerMillion === 0) return 0

  const cost = (characters / 1_000_000) * pricePerMillion
  return Math.round(cost * 1_000_000) / 1_000_000
}

/**
 * Універсальний розрахунок вартості — визначає тип за unitType або pricingType з DB.
 */
export function calculateCost(
  model: string,
  opts: {
    unitType?: 'token' | 'minute' | 'character'
    inputTokens?: number
    outputTokens?: number
    cachedTokens?: number
    reasoningTokens?: number
    durationSeconds?: number
    characters?: number
  },
  pricingMap?: Map<string, PricingEntry>,
): number {
  const unitType = opts.unitType ?? pricingMap?.get(model)?.pricingType?.replace('per_', '') as 'token' | 'minute' | 'character' | undefined ?? 'token'

  switch (unitType) {
    case 'minute':
      return calculateMinuteCost(model, opts.durationSeconds ?? 0, pricingMap)
    case 'character':
      return calculateCharacterCost(model, opts.characters ?? 0, pricingMap)
    case 'token':
    default:
      return calculateTokenCost(
        model,
        opts.inputTokens ?? 0,
        opts.outputTokens ?? 0,
        opts.cachedTokens ?? 0,
        opts.reasoningTokens ?? 0,
        pricingMap,
      )
  }
}
