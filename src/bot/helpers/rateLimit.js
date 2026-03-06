/**
 * Simple per-user rate limiter for bot AI chat.
 * Returns true if the request is allowed, false if rate-limited.
 */

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 10; // 10 AI requests per minute per user

// Map<userId, { count, resetAt }>
const limits = new Map();

function checkRateLimit(userId) {
  const now = Date.now();
  const entry = limits.get(userId);

  if (!entry || now > entry.resetAt) {
    limits.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (entry.count >= MAX_REQUESTS) {
    return false;
  }

  entry.count++;
  return true;
}

// Cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of limits) {
    if (now > entry.resetAt) limits.delete(key);
  }
}, 5 * 60_000);

module.exports = { checkRateLimit };
