const { getModelPricingModel } = require("./connection");

// Fallback pricing table (USD per 1M tokens)
// Used when modelPricing collection is not available
const FALLBACK_PRICING = {
  // OpenAI models
  "gpt-4.1": { input: 2.0, output: 8.0, cached: 0.5 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cached: 0.1 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4, cached: 0.025 },
  "gpt-4o": { input: 2.5, output: 10.0, cached: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cached: 0.075 },
  o3: { input: 2.0, output: 8.0, reasoning: 8.0 },
  "o3-mini": { input: 1.1, output: 4.4, reasoning: 4.4 },
  "o4-mini": { input: 1.1, output: 4.4, reasoning: 4.4 },
  // OpenRouter models
  "openai/gpt-4o-mini": { input: 0.15, output: 0.60 },
  "openai/gpt-4o": { input: 2.50, output: 10.00, cached: 1.25 },
  "openai/gpt-4.1": { input: 2.00, output: 8.00, cached: 0.50 },
  "openai/gpt-4.1-mini": { input: 0.40, output: 1.60, cached: 0.10 },
  "openai/gpt-4.1-nano": { input: 0.10, output: 0.40, cached: 0.025 },
  "deepseek/deepseek-chat": { input: 0.32, output: 0.89 },
  "deepseek/deepseek-r1": { input: 0.55, output: 2.19, reasoning: 2.19 },
  "meta-llama/llama-3.3-70b-instruct:free": { input: 0, output: 0 },
  "google/gemini-2.5-flash": { input: 0.15, output: 0.60 },
  "google/gemini-2.5-pro": { input: 1.25, output: 10.00 },
  "google/gemini-2.0-flash": { input: 0.10, output: 0.40 },
  // Google direct
  "gemini-2.5-flash-lite": { input: 0.075, output: 0.30 },
  "gemini-2.5-flash": { input: 0.15, output: 0.60 },
  "gemini-2.5-pro": { input: 1.25, output: 10.00 },
  "gemini-2.0-flash": { input: 0.10, output: 0.40 },
  "gemini-2.0-flash-lite": { input: 0.075, output: 0.30 },
  "gemini-3-flash-preview": { input: 0.15, output: 0.60 },
  "gemini-1.5-flash": { input: 0.075, output: 0.30 },
  "gemini-1.5-pro": { input: 1.25, output: 5.00 },
};

/**
 * Load pricing from modelPricing DB collection.
 * Returns a Map of model → { input, output, cached?, reasoning? }.
 * Falls through to FALLBACK_PRICING if DB is unavailable.
 */
async function loadPricingFromDb() {
  const Model = getModelPricingModel();
  const now = new Date();

  const docs = await Model.find({
    effectiveFrom: { $lte: now },
    $or: [
      { effectiveTo: null },
      { effectiveTo: { $exists: false } },
      { effectiveTo: { $gt: now } },
    ],
  })
    .sort({ effectiveFrom: -1 })
    .lean();

  const map = new Map();

  for (const doc of docs) {
    const key = String(doc.model);
    if (map.has(key)) continue;

    map.set(key, {
      input: doc.inputPricePerMillionTokens,
      output: doc.outputPricePerMillionTokens,
      cached: doc.cachedInputPricePerMillionTokens ?? undefined,
      reasoning: doc.reasoningPricePerMillionTokens ?? undefined,
    });
  }

  return map;
}

/**
 * Calculate estimated cost for a request in USD.
 * @param {Map} [pricingMap] - DB pricing (takes priority over FALLBACK_PRICING)
 */
function calculateCost(
  model,
  inputTokens,
  outputTokens,
  cachedTokens = 0,
  reasoningTokens = 0,
  pricingMap
) {
  const pricing = pricingMap?.get(model) ?? FALLBACK_PRICING[model];
  if (!pricing) return 0;

  let cost = 0;
  cost += ((inputTokens - cachedTokens) / 1_000_000) * pricing.input;
  if (cachedTokens && pricing.cached) {
    cost += (cachedTokens / 1_000_000) * pricing.cached;
  }
  cost += (outputTokens / 1_000_000) * pricing.output;
  if (reasoningTokens && pricing.reasoning) {
    cost += (reasoningTokens / 1_000_000) * pricing.reasoning;
  }

  return Math.round(cost * 1_000_000) / 1_000_000;
}

module.exports = { calculateCost, loadPricingFromDb, FALLBACK_PRICING };
