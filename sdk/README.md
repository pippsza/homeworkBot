# Usage Tracker SDK — Quick Start

AI token tracking with automatic cost calculation.

Data is collected into a central MongoDB → UsageHub dashboard.

---

## Installation (3 minutes)

### 1. Copy `usage-tracker/` into your project

```bash
cp -r usage-tracker/ <your-project>/src/lib/usage-tracker/
```

### 2. Add mongoose (if not already installed)

```bash
pnpm add mongoose
```

### 3. Add env variable

```env
# .env
USAGE_DATABASE_URI=mongodb://user:pass@host:27017/api_tokens_usage
```

The URI must point to the **same database** as UsageHub.

### 4. Create initialization file

Copy the template and fill in the TODOs:

```bash
cp tracked-ai.template.ts <your-project>/src/lib/tracked-ai.ts
```

Edit `tracked-ai.ts`:

```typescript
export const usageTracker = createUsageTracker({
  projectId: 'my-project',              // ← your ID
  environment: process.env.NODE_ENV as 'production' | 'development',
  project: {
    name: 'My Project',                 // ← display name for dashboard
  },
})

export const ai = createTrackedAI(usageTracker)
process.on('beforeExit', () => usageTracker.shutdown())
```

### 5. Wrap AI calls

**generateObject / generateText:**

```typescript
import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { ai } from '@/lib/tracked-ai'

const result = await ai.generateObject(
  () => generateObject({ model: openai('gpt-4.1'), schema, prompt }),
  'gpt-4.1',
  {
    userId: session.user.id,
    operationType: 'generation',
    feature: 'question-gen',
    user: { email: session.user.email, name: session.user.name },
  },
)
```

**streamText:**

```typescript
import { streamText } from 'ai'
import { ai } from '@/lib/tracked-ai'

const startTime = new Date()

const result = streamText({
  model: openai('gpt-4.1'),
  messages,
  onFinish: ai.onStreamFinish('gpt-4.1', {
    userId: session.user.id,
    operationType: 'chat',
    user: { email: session.user.email, name: session.user.name },
  }, startTime),
})
```

---

## What gets tracked automatically

| Field | Source |
|-------|--------|
| Tokens (input, output, cached, reasoning) | AI SDK `usage` object |
| Cost (USD) | `modelPricing` collection (fallback to hardcoded) |
| Latency | Automatic measurement |
| Status (success/error) | Try-catch wrapper |
| Project | `projectId` from config |
| User (email, name, role) | `TrackingContext.user` |

---

## AI SDK compatibility

The SDK supports both **Vercel AI SDK v5** and **v6** field names:

| Field | v5 (old) | v6 (current) |
|-------|----------|--------------|
| Input tokens | `usage.promptTokens` | `usage.inputTokens` |
| Output tokens | `usage.completionTokens` | `usage.outputTokens` |
| Total tokens | `usage.totalTokens` | `usage.totalTokens` |

The wrapper reads v6 names first, falling back to v5 names for backward compatibility.

> **Important:** If you see `$0.00` cost in the dashboard but token counts are correct,
> check that `inputTokens` and `outputTokens` are non-zero in the raw events.
> A mismatch between SDK version and field names causes `inputTokens: 0, outputTokens: 0`
> while `totalTokens` is populated — resulting in zero cost calculation.

---

## TrackingContext — all fields

```typescript
{
  userId: string           // Required
  operationType: string    // Required: "chat", "generation", "embedding"
  feature?: string         // Feature: "question-gen", "search"
  endpoint?: string        // Endpoint: "/api/chat"
  entityType?: string      // Business entity: "test", "document"
  entityId?: string        // Entity ID
  traceId?: string         // For grouping calls (auto-generated)
  promptSummary?: string   // Prompt description (~500 chars)
  user?: {                 // User reference data
    email?: string
    name?: string
    role?: string          // "student", "teacher", "admin"
    avatarUrl?: string
    meta?: Record<string, unknown>
  }
}
```

---

## How it works under the hood

```
ai.generateObject(fn, model, ctx)
    │
    ├─ fn() → original AI call
    ├─ tracker.record(event) → buffer (up to 50 events)
    │     └─ maybeSyncUser() → update users collection (debounce 60s)
    │
    └─ flush() (every 5s or when buffer is full)
          ├─ loadPricingFromDb() → prices from DB
          ├─ calculateCost() → cost for each event
          └─ insertMany() → batch write to tokenUsageEvents
```

- Buffer: **50 events** or **5 seconds** (whichever comes first)
- Buffer overflow protection: trimmed to 10,000 events if DB is consistently unavailable
- Cost is calculated at flush time (one pricing load per batch)
- If pricing DB is unavailable → fallback pricing (hardcoded)
- If flush fails → events are returned to buffer
- TTL: raw events are deleted after **90 days**

---

## Pricing — how cost is calculated

The SDK **does not hardcode prices**. On each flush it:

1. Loads current prices from `modelPricing` collection in the same MongoDB
2. If model found in DB → uses that price
3. If model **not found** → falls back to hardcoded pricing (only basic OpenAI models)

```
flush() → loadPricingFromDb() → calculateCost(model, tokens, pricingMap)
                │                        │
                ▼                        ▼
         modelPricing collection    pricingMap ?? FALLBACK_PRICING
         (shared with UsageHub)     (only gpt-4.1, o3, o4-mini)
```

**To keep prices accurate:**

1. Open UsageHub → Models
2. Click **Sync** — this loads current prices from OpenRouter API into `modelPricing`
3. SDK automatically picks them up on next flush

> Fallback covers only: `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-4o`, `gpt-4o-mini`, `o3`, `o3-mini`, `o4-mini`. For **any other models** (Claude, Gemini, DeepSeek, Llama, etc.) — sync via UsageHub is required, otherwise cost will be $0.00.

---

## Configuration

```typescript
createUsageTracker({
  projectId: string                    // Unique ID (kebab-case)
  environment: 'production' | 'staging' | 'development'
  buffer?: {
    maxSize?: number                   // Default: 50
    flushIntervalMs?: number           // Default: 5000
  }
  project?: {
    name: string                       // Display name for dashboard
    description?: string
    url?: string
    techStack?: string
    team?: string
    contactEmail?: string
  }
})
```

---

## Checklist

- [ ] `src/lib/usage-tracker/` copied
- [ ] `mongoose` installed
- [ ] `USAGE_DATABASE_URI` in `.env`
- [ ] `src/lib/tracked-ai.ts` created with `projectId`
- [ ] AI calls wrapped via `ai.generateObject()` / `ai.onStreamFinish()`
- [ ] `userId` passed in every call
- [ ] Graceful shutdown connected
- [ ] Verified in UsageHub dashboard

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Project not appearing in dashboard | Check `USAGE_DATABASE_URI`, `projectId`, `[UsageTracker]` logs |
| Cost $0.00 | Model name must match `modelPricing`. Verify `inputTokens`/`outputTokens` are non-zero (see AI SDK compatibility) |
| Events not writing | Check MongoDB user write permissions, ensure `tracker.shutdown()` on exit |
| Tokens correct but cost zero | AI SDK version mismatch — SDK reads `inputTokens`/`outputTokens` (v6). Older versions use `promptTokens`/`completionTokens` |

---

## File structure after integration

```
src/lib/
├── tracked-ai.ts              ← your file (with projectId)
└── usage-tracker/             ← SDK (copied)
    ├── index.ts
    ├── tracker.ts
    ├── tool.ts
    ├── pricing.ts
    ├── registry.ts
    ├── connection.ts
    ├── types.ts
    └── schemas/
        ├── token-usage-event.ts
        ├── usage-summary.ts
        ├── provider-cost.ts
        ├── model-pricing.ts
        ├── project.ts
        └── user.ts
```
