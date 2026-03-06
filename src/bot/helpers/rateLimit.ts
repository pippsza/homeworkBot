/**
 * Simple per-user rate limiter for bot AI chat.
 * Returns true if the request is allowed, false if rate-limited.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 10; // 10 AI requests per minute per user

const limits = new Map<number, RateLimitEntry>();

export function checkRateLimit(userId: number): boolean {
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
  for (const [key, entry] of Array.from(limits)) {
    if (now > entry.resetAt) limits.delete(key);
  }
}, 5 * 60_000);
