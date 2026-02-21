// Fallback pricing table (USD per 1M tokens)
// Used when modelPricing collection is not available
const FALLBACK_PRICING = {
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
  // Google direct (free tier)
  "gemini-2.5-flash": { input: 0, output: 0 },
  "gemini-2.5-pro": { input: 0, output: 0 },
  "gemini-2.0-flash": { input: 0, output: 0 },
  "gemini-2.0-flash-lite": { input: 0, output: 0 },
  "gemini-1.5-flash": { input: 0, output: 0 },
  "gemini-1.5-pro": { input: 0, output: 0 },
};

/**
 * Calculate estimated cost for a request.
 * Uses fallback hardcoded prices. Hub will fill modelPricing collection later.
 */
function calculateCost(
  model,
  inputTokens,
  outputTokens,
  cachedTokens = 0,
  reasoningTokens = 0
) {
  const pricing = FALLBACK_PRICING[model];
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

module.exports = { calculateCost, FALLBACK_PRICING };
