import { getModelPricingModel } from './connection'

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

export interface PricingEntry {
  input: number
  output: number
  cached?: number
  reasoning?: number
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

    map.set(key, {
      input: doc.inputPricePerMillionTokens as number,
      output: doc.outputPricePerMillionTokens as number,
      cached: (doc.cachedInputPricePerMillionTokens as number | undefined) ?? undefined,
      reasoning: (doc.reasoningPricePerMillionTokens as number | undefined) ?? undefined,
    })
  }

  return map
}

/**
 * Розраховує вартість запиту в USD.
 * @param pricingMap — ціни з DB (якщо передано, має пріоритет над FALLBACK_PRICING)
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens = 0,
  reasoningTokens = 0,
  pricingMap?: Map<string, PricingEntry>,
): number {
  const pricing = pricingMap?.get(model) ?? FALLBACK_PRICING[model]
  if (!pricing) return 0

  let cost = 0
  cost += ((inputTokens - cachedTokens) / 1_000_000) * pricing.input
  if (cachedTokens && pricing.cached) cost += (cachedTokens / 1_000_000) * pricing.cached
  cost += (outputTokens / 1_000_000) * pricing.output
  if (reasoningTokens && pricing.reasoning)
    cost += (reasoningTokens / 1_000_000) * pricing.reasoning

  return Math.round(cost * 1_000_000) / 1_000_000
}
