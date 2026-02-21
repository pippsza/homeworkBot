# Система відстеження використання токенів — Проєктний документ

> **Статус:** Пропозиція
> **Дата:** 2026-02-16
> **Область:** Усі особисті проєкти → UsageHub як центральний дашборд

---

## Зміст

1. [Постановка проблеми](#1-постановка-проблеми)
2. [Цілі](#2-цілі)
3. [Архітектура: окрема БД + Mongoose](#3-архітектура-окрема-бд--mongoose)
4. [Mongoose-схеми](#4-mongoose-схеми)
5. [Папка `usage-tracker`](#5-папка-usage-tracker-копіюється-між-проєктами)
6. [Тулза `trackedAI` — підключення в ендпоінтах](#6-тулза-trackedai--підключення-в-ендпоінтах)
7. [Хаб UsageHub: API та агрегація](#7-хаб-usagehub-api-та-агрегація)
8. [Розрахунок вартості та аномалії](#8-розрахунок-вартості-та-аномалії)
9. [Дашборд та візуалізація](#9-дашборд-та-візуалізація)
10. [Гайд з інтеграції в будь-який проєкт](#10-гайд-з-інтеграції-в-будь-який-проєкт)
11. [Безпека](#11-безпека)

---

## 1. Постановка проблеми

У проєктах виклики до AI-провайдерів відбуваються без централізованого відстеження:

- **Нульова видимість** споживання токенів по користувачах і проєктах
- **Відсутність контролю витрат** — окрім MVP rate-limiting
- **Неможливість виявлення аномалій** — скомпрометовані ключі або зловживання непомітні
- **Немає порівняння** з реальними рахунками від провайдера
- **Немає бюджетування**

---

## 2. Цілі

| Пріоритет | Ціль |
| --------- | ---- |
| P0 | Трекати кожен AI-виклик: токени, модель, користувач, проєкт |
| P0 | Централізувати дані в окремій БД `usage_tracking` |
| P0 | Порівнювати внутрішній трекінг з рахунками OpenAI |
| P1 | Дашборди з графіками в UsageHub |
| P1 | Алерти на аномалії |
| P2 | Бюджетні ліміти на користувача/проєкт |

---

## 3. Архітектура: окрема БД + Mongoose

### Принцип

Окрема MongoDB-база **`usage_tracking`**. Проєкти підключаються до неї через **`mongoose.createConnection()`** — паралельно з основним Payload-підключенням, без конфлікту.

```text
┌──────────────────────────────┐
│  Project A                   │
│  ├─ Payload → project_a_db   │
│  └─ Mongoose → usage_tracking     │  ← SDK пише сюди
└──────────────────────────────┘
┌──────────────────────────────┐
│  Project B                   │
│  ├─ Payload → project_b_db   │
│  └─ Mongoose → usage_tracking     │  ← SDK пише сюди
└──────────────────────────────┘
                                    ┌─────────────────────┐
                                    │     usage_tracking        │
                                    │  (окрема MongoDB)    │
                                    │                      │
                                    │  - tokenUsageEvents  │
                                    │  - usageSummaries    │
                                    │  - providerCosts     │
                                    │  - modelPricing      │
                                    │  - projects          │  ← довідник
                                    │  - users             │  ← довідник
                                    └──────────┬───────────┘
                                               │ Читає
                                               ▼
                                        ┌──────────────┐
                                        │   UsageHub    │
                                        │  (дашборд)   │
                                        └──────────────┘
```

### Чому Mongoose standalone

- `mongoose.createConnection()` створює **ізольоване підключення** — не чіпає Payload
- Mongoose вже є в `node_modules` кожного Payload-проєкту (залежність Payload)
- Вбудована валідація схем, middleware, type casting
- Не потрібно піднімати другий Payload-інстанс

### Чому окрема БД

- Usage-дані не засмічують робочі БД проєктів
- Незалежний TTL (90 днів на сирі події)
- UsageHub не потребує доступу до БД кожного проєкту
- Можна перенести на окремий сервер
- Проєкти мають write-only доступ; read — тільки UsageHub

---

## 4. Mongoose-схеми

### Огляд колекцій

| Колекція | Тип | Призначення |
| -------- | --- | ----------- |
| `tokenUsageEvents` | Дані | Кожен AI-виклик |
| `usageSummaries` | Дані | Агреговані метрики |
| `providerCosts` | Дані | Порівняння з рахунками |
| `modelPricing` | Довідник | Таблиця цін моделей |
| `projects` | Довідник | Людиночитабельні дані проєктів |
| `users` | Довідник | Людиночитабельні дані користувачів |

---

### 4.1 `TokenUsageEvent` — основна колекція

Один документ = один виклик AI API.

```typescript
import mongoose, { Schema, type InferSchemaType } from 'mongoose'

const tokenUsageEventSchema = new Schema(
  {
    // ── Ідентифікація ──
    traceId: {
      type: String,
      required: true,
      index: true,
    },

    // ── Джерело ──
    projectId: {
      type: String,
      required: true,
      index: true,
    },
    environment: {
      type: String,
      required: true,
      enum: ['production', 'staging', 'development'],
      default: 'production',
    },
    serverInstanceId: String,

    // ── Користувач ──
    // Людиночитабельні дані (email, name, role) — в колекції `users`
    userId: {
      type: String,
      required: true,
      index: true,
    },

    // ── AI-провайдер ──
    provider: {
      type: String,
      required: true,
      enum: ['openrouter', 'openai', 'anthropic', 'google', 'custom'],
      default: 'openrouter',
    },
    model: {
      type: String,
      required: true,
      index: true,
    },
    modelGroup: String, // "chatModel", "generationModel" — визначає проєкт

    // ── Токени ──
    inputTokens: { type: Number, required: true, min: 0 },
    outputTokens: { type: Number, required: true, min: 0 },
    totalTokens: { type: Number, required: true, min: 0 },
    cachedTokens: { type: Number, min: 0 },
    reasoningTokens: { type: Number, min: 0 },

    // ── Вартість ──
    estimatedCostUsd: { type: Number, required: true, min: 0 },
    pricingVersion: String,

    // ── Метадані запиту (довільні, визначає проєкт) ──
    operationType: {
      type: String,
      required: true, // "chat", "generation", "embedding" тощо
    },
    feature: String, // "question-generation", "document-analysis" тощо
    endpoint: String, // "/api/chat", "/api/generate"

    // ── Продуктивність ──
    latencyMs: { type: Number, required: true, min: 0 },
    isStreaming: { type: Boolean, default: false },

    // ── Статус ──
    status: {
      type: String,
      required: true,
      enum: ['success', 'error', 'timeout', 'rate_limited'],
      default: 'success',
    },
    errorCode: String,
    errorMessage: String,

    // ── Контекст сутності (довільний, визначає проєкт) ──
    entityType: String, // "test", "document", "order" — що завгодно
    entityId: String,

    // ── Часові мітки запиту ──
    requestedAt: { type: Date, required: true },
    completedAt: { type: Date, required: true },
  },
  {
    timestamps: true, // createdAt, updatedAt
    collection: 'tokenUsageEvents',
  },
)

// Складені індекси для типових запитів дашборду
tokenUsageEventSchema.index({ projectId: 1, createdAt: -1 })
tokenUsageEventSchema.index({ userId: 1, createdAt: -1 })
tokenUsageEventSchema.index({ projectId: 1, userId: 1, createdAt: -1 })
tokenUsageEventSchema.index({ model: 1, createdAt: -1 })

// TTL: автоматичне видалення сирих подій через 90 днів
tokenUsageEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 })

export type TokenUsageEventDoc = InferSchemaType<typeof tokenUsageEventSchema>
export { tokenUsageEventSchema }
```

### 4.2 `UsageSummary` — агреговані дані

```typescript
const usageSummarySchema = new Schema(
  {
    periodType: {
      type: String,
      required: true,
      enum: ['hourly', 'daily', 'weekly', 'monthly'],
    },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },

    // Виміри
    projectId: { type: String, required: true, index: true },
    userId: String,        // порожнє = агрегація на рівні проєкту
    model: String,         // порожнє = усі моделі
    operationType: String, // порожнє = усі операції

    // Метрики
    totalRequests: { type: Number, required: true, min: 0 },
    successfulRequests: { type: Number, required: true, min: 0 },
    failedRequests: { type: Number, required: true, min: 0 },

    totalInputTokens: { type: Number, required: true, min: 0 },
    totalOutputTokens: { type: Number, required: true, min: 0 },
    totalTokens: { type: Number, required: true, min: 0 },
    totalCachedTokens: { type: Number, default: 0, min: 0 },
    totalReasoningTokens: { type: Number, default: 0, min: 0 },

    totalEstimatedCostUsd: { type: Number, required: true, min: 0 },

    avgLatencyMs: { type: Number, min: 0 },
    p95LatencyMs: { type: Number, min: 0 },
    maxLatencyMs: { type: Number, min: 0 },
  },
  {
    timestamps: true,
    collection: 'usageSummaries',
  },
)

usageSummarySchema.index({ periodType: 1, periodStart: -1, projectId: 1 })
usageSummarySchema.index({ periodType: 1, periodStart: -1, userId: 1 })

export { usageSummarySchema }
```

### 4.3 `ProviderCost` — порівняння з рахунками

```typescript
const providerCostSchema = new Schema(
  {
    provider: {
      type: String,
      required: true,
      enum: ['openrouter', 'openai', 'anthropic', 'google'],
    },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },

    // Наші дані
    internalTotalTokens: { type: Number, required: true, min: 0 },
    internalEstimatedCostUsd: { type: Number, required: true, min: 0 },
    internalRequestCount: { type: Number, required: true, min: 0 },

    // Дані провайдера
    providerReportedCostUsd: { type: Number, min: 0 },
    providerReportedTokens: { type: Number, min: 0 },

    // Розбіжність
    discrepancyUsd: Number,
    discrepancyPercent: Number,
    discrepancyStatus: {
      type: String,
      enum: ['within_threshold', 'warning', 'critical', 'pending'],
      default: 'pending',
    },

    notes: String,
    importedBy: String,
  },
  {
    timestamps: true,
    collection: 'providerCosts',
  },
)

export { providerCostSchema }
```

### 4.4 `ModelPricing` — таблиця цін + характеристики моделей

Окрім цін, зберігає характеристики моделей для фільтрації в UI адмін-панелі (vision, tool calling, reasoning тощо). Ці поля заповнює хаб при синхронізації з OpenRouter API.

```typescript
const modelPricingSchema = new Schema(
  {
    provider: { type: String, required: true },
    model: { type: String, required: true, index: true },

    inputPricePerMillionTokens: { type: Number, required: true, min: 0 },
    outputPricePerMillionTokens: { type: Number, required: true, min: 0 },
    cachedInputPricePerMillionTokens: { type: Number, min: 0 },
    reasoningPricePerMillionTokens: { type: Number, min: 0 },

    effectiveFrom: { type: Date, required: true },
    effectiveTo: Date, // null = поточна активна ціна

    source: String, // "openai-pricing-page-2026-02"

    // Характеристики моделі (для UI фільтрації та динамічного вибору)
    displayName: { type: String },                     // "GPT-4o Mini" — людиночитабельне ім'я
    contextLength: { type: Number },                   // 128000 — розмір контекстного вікна
    supportsVision: { type: Boolean, default: false },  // може обробляти зображення
    supportsToolCalling: { type: Boolean, default: false }, // підтримує function calling
    supportsReasoning: { type: Boolean, default: false },   // reasoning модель (R1, o3, Gemini 2.5)
  },
  {
    timestamps: true,
    collection: 'modelPricing',
  },
)

export { modelPricingSchema }
```

**Нові поля (додані для системи динамічного вибору моделей):**

| Поле | Тип | Призначення |
| ---- | --- | ----------- |
| `displayName` | String | Людиночитабельне ім'я для UI ("GPT-4o Mini") |
| `contextLength` | Number | Розмір контекстного вікна (для відображення) |
| `supportsVision` | Boolean | Фільтрація моделей для ролей із зображеннями |
| `supportsToolCalling` | Boolean | Фільтрація моделей для чат-ролей із tool calling |
| `supportsReasoning` | Boolean | Маркер reasoning-моделей (DeepSeek R1, o3, Gemini 2.5) |

> **Важливо:** Ці поля повинні заповнюватись у хабі при синхронізації моделей з OpenRouter API. Проєкти їх тільки читають для відображення в адмін-панелі.

### 4.5 `Project` — довідник проєктів

Людиночитабельна інформація про кожен проєкт. Оновлюється SDK при ініціалізації — проєкт «реєструє себе» автоматично.

```typescript
const projectSchema = new Schema(
  {
    projectId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: { type: String, required: true },         // "Zen Tests", "Zen Core"
    description: String,                             // "Платформа тестування"
    url: String,                                     // "https://tests.zen.software"
    environment: {
      type: String,
      enum: ['production', 'staging', 'development'],
    },
    techStack: String,                               // "Next.js 15, Payload 3"
    team: String,                                    // "backend", "platform"
    contactEmail: String,                            // відповідальний за проєкт

    // Статистика (оновлює UsageHub aggregation)
    lastActivityAt: Date,                            // Останній AI-виклик
    totalRequestsAllTime: { type: Number, default: 0 },
    totalCostAllTimeUsd: { type: Number, default: 0 },

    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: 'projects',
  },
)

export { projectSchema }
```

### 4.6 `User` — довідник користувачів

Людиночитабельні дані користувачів з усіх проєктів. Оновлюється SDK при кожному виклику (upsert по `userId + projectId`).

```typescript
const userSchema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    projectId: {
      type: String,
      required: true,
      index: true,
    },

    // Людиночитабельні поля
    email: String,                                    // "ivan@example.com"
    name: String,                                     // "Іван Петренко"
    role: String,                                     // "student", "teacher", "admin"
    avatarUrl: String,

    // Будь-які додаткові мета-поля від проєкту
    meta: { type: Schema.Types.Mixed, default: {} }, // { plan: "pro", org: "Acme" }

    // Статистика (оновлює UsageHub aggregation)
    lastActivityAt: Date,
    totalRequests: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    totalCostUsd: { type: Number, default: 0 },

    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: 'users',
  },
)

// Один юзер може бути в кількох проєктах — унікальність по парі
userSchema.index({ userId: 1, projectId: 1 }, { unique: true })
userSchema.index({ email: 1 })

export { userSchema }
```

**Чому `userId + projectId` а не глобальний юзер:**

- Один і той самий userId може мати різні ролі/імена в різних проєктах
- Проєкти незалежні — не всі шарять одну систему авторизації
- Статистика рахується окремо по проєктах

---

## 5. Папка `usage-tracker` (копіюється між проєктами)

### 5.1 Підхід: локальна папка замість npm-пакету

Замість окремого npm-пакету або git-залежності, `usage-tracker` — це папка `src/lib/usage-tracker/`, яка **копіюється в кожен проєкт** як є. Залежність одна — `mongoose` (вже є через Payload, додається як пряма).

**Чому так:**

- Нуль інфраструктури (без npm registry, без окремого репо)
- Працює одразу після копіювання
- Не потрібно синхронізувати версії
- Кожен проєкт може адаптувати під себе (якщо потрібно)

### 5.2 Структура папки

```text
src/lib/usage-tracker/        ← копіювати цілком в інші проєкти
├── index.ts                  # Публічне API (реекспорти)
├── connection.ts             # mongoose.createConnection + моделі
├── tracker.ts                # Клас UsageTracker з буфером
├── registry.ts               # Синхронізація довідників (projects, users)
├── pricing.ts                # Розрахунок вартості
├── tool.ts                   # Тулза createTrackedAI для ендпоінтів
├── types.ts                  # Типи для публічного API
└── schemas/
    ├── token-usage-event.ts
    ├── usage-summary.ts
    ├── provider-cost.ts
    ├── model-pricing.ts
    ├── project.ts
    └── user.ts

src/lib/tracked-ai.ts         ← специфічний для кожного проєкту (не копіювати)
```

### 5.2 Підключення до БД

```typescript
// src/connection.ts

import mongoose from 'mongoose'
import { tokenUsageEventSchema } from './schemas/token-usage-event'
import { modelPricingSchema } from './schemas/model-pricing'
import { projectSchema } from './schemas/project'
import { userSchema } from './schemas/user'

let connection: mongoose.Connection | null = null

export function getUsageConnection(): mongoose.Connection {
  if (!connection) {
    const uri = process.env.USAGE_DATABASE_URI
    if (!uri) throw new Error('[UsageTracker] USAGE_DATABASE_URI is not set')

    connection = mongoose.createConnection(uri)

    connection.on('error', (err) => {
      console.error('[UsageTracker] MongoDB connection error:', err.message)
    })
  }
  return connection
}

export function getTokenUsageEventModel() {
  return getUsageConnection().model('TokenUsageEvent', tokenUsageEventSchema)
}

export function getModelPricingModel() {
  return getUsageConnection().model('ModelPricing', modelPricingSchema)
}

export function getProjectModel() {
  return getUsageConnection().model('Project', projectSchema)
}

export function getUserModel() {
  return getUsageConnection().model('User', userSchema)
}
```

### 5.3 Трекер з буфером

```typescript
// src/tracker.ts

import { getTokenUsageEventModel } from './connection'
import { calculateCost } from './pricing'
import { registerProject, syncUser } from './registry'

interface TrackerConfig {
  projectId: string
  environment: 'production' | 'staging' | 'development'
  buffer?: {
    maxSize?: number       // default: 50
    flushIntervalMs?: number // default: 5000
  }
  // Довідникові дані проєкту (людиночитабельні)
  project?: {
    name: string               // "Zen Tests"
    description?: string       // "Платформа тестування"
    url?: string               // "https://tests.zen.software"
    techStack?: string         // "Next.js 15, Payload 3"
    team?: string
    contactEmail?: string
  }
}

interface UsageEvent {
  userId: string
  provider?: 'openrouter' | 'openai' | 'anthropic' | 'google' | 'custom'
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
  entityType?: string
  entityId?: string
  traceId?: string
  requestedAt: Date
  completedAt: Date
  // Довідникові дані юзера (для синхронізації в колекцію users)
  userInfo?: {
    email?: string
    name?: string
    role?: string
    avatarUrl?: string
    meta?: Record<string, unknown>
  }
}

class UsageTracker {
  private buffer: UsageEvent[] = []
  private config: TrackerConfig
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private syncedUsers = new Map<string, number>() // userId → lastSyncTs (debounce)

  constructor(config: TrackerConfig) {
    this.config = config
    const interval = config.buffer?.flushIntervalMs ?? 5_000
    this.flushTimer = setInterval(() => this.flush(), interval)
    if (this.flushTimer.unref) this.flushTimer.unref()

    // Авто-реєстрація проєкту при створенні трекера
    if (config.project) {
      registerProject({
        projectId: config.projectId,
        environment: config.environment,
        ...config.project,
      })
    }
  }

  record(event: UsageEvent): void {
    // Синхронізувати дані юзера (debounce 60с)
    this.maybeSyncUser(event)

    // Дорахувати вартість якщо не задано
    const enriched = {
      ...event,
      projectId: this.config.projectId,
      environment: this.config.environment,
      provider: event.provider ?? 'openai',
      isStreaming: event.isStreaming ?? false,
      estimatedCostUsd: calculateCost(
        event.model,
        event.inputTokens,
        event.outputTokens,
        event.cachedTokens,
        event.reasoningTokens,
      ),
    }

    this.buffer.push(enriched as any)

    const maxSize = this.config.buffer?.maxSize ?? 50
    if (this.buffer.length >= maxSize) {
      this.flush()
    }
  }

  private maybeSyncUser(event: UsageEvent): void {
    if (!event.userInfo) return

    const key = `${event.userId}:${this.config.projectId}`
    const lastSync = this.syncedUsers.get(key) ?? 0
    const now = Date.now()

    // Debounce: не частіше ніж раз на 60 секунд для одного юзера
    if (now - lastSync < 60_000) return

    this.syncedUsers.set(key, now)

    // Fire-and-forget — не блокує основний потік
    syncUser(this.config.projectId, {
      userId: event.userId,
      ...event.userInfo,
    })
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return

    const events = [...this.buffer]
    this.buffer = []

    try {
      const Model = getTokenUsageEventModel()
      await Model.insertMany(events, { ordered: false })
    } catch (error) {
      // Повернути невідправлені в буфер
      this.buffer.unshift(...events)
      console.error('[UsageTracker] Flush failed:', (error as Error).message)
    }
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer)
    await this.flush()
  }
}

export function createUsageTracker(config: TrackerConfig): UsageTracker {
  return new UsageTracker(config)
}
```

### 5.4 Реєстр довідників

SDK автоматично синхронізує людиночитабельні дані в `projects` і `users`. Проєкт реєструє себе при ініціалізації, а юзери оновлюються при кожному AI-виклику (upsert — вставка або оновлення).

```typescript
// src/registry.ts

import { getProjectModel, getUserModel } from './connection'

interface ProjectInfo {
  projectId: string
  name: string
  description?: string
  url?: string
  environment?: 'production' | 'staging' | 'development'
  techStack?: string
  team?: string
  contactEmail?: string
}

interface UserInfo {
  userId: string
  email?: string
  name?: string
  role?: string
  avatarUrl?: string
  meta?: Record<string, unknown>
}

/**
 * Реєструє проєкт у довіднику.
 * Викликається один раз при ініціалізації SDK.
 * Upsert по projectId — безпечно викликати повторно.
 */
export async function registerProject(info: ProjectInfo): Promise<void> {
  try {
    const Project = getProjectModel()
    await Project.updateOne(
      { projectId: info.projectId },
      {
        $set: {
          ...info,
          isActive: true,
          lastActivityAt: new Date(),
        },
        $setOnInsert: {
          totalRequestsAllTime: 0,
          totalCostAllTimeUsd: 0,
        },
      },
      { upsert: true },
    )
  } catch (error) {
    console.error('[UsageTracker] Failed to register project:', (error as Error).message)
  }
}

/**
 * Оновлює дані юзера в довіднику.
 * Викликається SDK при кожному AI-виклику (debounce в tracker).
 * Upsert по userId + projectId.
 */
export async function syncUser(projectId: string, info: UserInfo): Promise<void> {
  try {
    const User = getUserModel()
    await User.updateOne(
      { userId: info.userId, projectId },
      {
        $set: {
          ...info,
          projectId,
          isActive: true,
          lastActivityAt: new Date(),
        },
        $setOnInsert: {
          totalRequests: 0,
          totalTokens: 0,
          totalCostUsd: 0,
        },
      },
      { upsert: true },
    )
  } catch (error) {
    console.error('[UsageTracker] Failed to sync user:', (error as Error).message)
  }
}
```

**Важливо:** `syncUser` не блокує основний потік — викликається `fire-and-forget` (без `await` в трекері). Debounce: оновлення одного юзера не частіше ніж раз на 60 секунд (кешується в пам'яті).

---

## 6. Тулза `trackedAI` — підключення в ендпоінтах

### Ідея

Замість того щоб у кожному ендпоінті писати boilerplate для трекінгу, проєкт створює **одну тулзу** — обгортку над AI SDK, яка автоматично трекає кожен виклик. В ендпоінті міняється тільки ім'я функції.

### 6.1 Реалізація тулзи

```typescript
// src/tool.ts (в SDK)

import type { UsageTracker } from './tracker'

interface TrackingContext {
  userId: string
  operationType: string
  feature?: string
  endpoint?: string
  entityType?: string
  entityId?: string
  traceId?: string
  // Довідникові дані юзера (синхронізуються в колекцію users)
  user?: {
    email?: string
    name?: string
    role?: string
    avatarUrl?: string
    meta?: Record<string, unknown>
  }
}

/**
 * Створює обгортки над AI SDK функціями з автоматичним трекінгом.
 *
 * Використання в проєкті:
 *   const ai = createTrackedAI(tracker)
 *   const result = await ai.generateObject({ ... }, context)
 */
export function createTrackedAI(tracker: UsageTracker) {
  // Хелпер: маппить TrackingContext → UsageEvent поля
  function mapCtx(ctx: TrackingContext) {
    const { user, ...rest } = ctx
    return { ...rest, userInfo: user }
  }

  return {
    /**
     * Обгортка над generateObject / generateText.
     * Трекає usage автоматично після отримання результату.
     */
    async generateObject<T>(
      fn: () => Promise<T & { usage: { promptTokens: number; completionTokens: number; totalTokens: number } }>,
      model: string,
      ctx: TrackingContext,
    ): Promise<T & { usage: any }> {
      const startTime = new Date()

      try {
        const result = await fn()

        tracker.record({
          ...mapCtx(ctx),
          model,
          inputTokens: result.usage.promptTokens,
          outputTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
          latencyMs: Date.now() - startTime.getTime(),
          isStreaming: false,
          status: 'success',
          requestedAt: startTime,
          completedAt: new Date(),
        })

        return result
      } catch (error) {
        tracker.record({
          ...mapCtx(ctx),
          model,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          latencyMs: Date.now() - startTime.getTime(),
          isStreaming: false,
          status: 'error',
          errorMessage: (error as Error).message,
          requestedAt: startTime,
          completedAt: new Date(),
        })

        throw error
      }
    },

    /**
     * Повертає onFinish callback для streamText.
     * Підключається напряму в параметри streamText.
     */
    onStreamFinish(
      model: string,
      ctx: TrackingContext,
      startTime: Date,
    ) {
      return ({ usage }: { usage: { promptTokens: number; completionTokens: number; totalTokens: number } }) => {
        tracker.record({
          ...mapCtx(ctx),
          model,
          inputTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          latencyMs: Date.now() - startTime.getTime(),
          isStreaming: true,
          status: 'success',
          requestedAt: startTime,
          completedAt: new Date(),
        })
      }
    },
  }
}
```

### 6.2 Ініціалізація в проєкті (один раз)

```typescript
// src/lib/tracked-ai.ts

import { createUsageTracker, createTrackedAI } from './usage-tracker'

export const usageTracker = createUsageTracker({
  projectId: process.env.PROJECT_ID!,
  environment: process.env.NODE_ENV as 'production' | 'development',
  // Людиночитабельні дані проєкту — записуються в колекцію projects
  project: {
    name: 'Steam Diploma',
    description: 'Платформа тестування',
    url: 'https://tests.zen.software',
    techStack: 'Next.js 15, Payload 3',
  },
})

export const ai = createTrackedAI(usageTracker)

// Graceful shutdown
process.on('beforeExit', () => usageTracker.shutdown())
```

### 6.3 Використання в ендпоінтах

**До (без трекінгу):**

```typescript
import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'

const result = await generateObject({
  model: openai('gpt-4.1'),
  schema: mySchema,
  prompt: '...',
})
```

**Після (з трекінгом — одна зміна):**

```typescript
import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { ai } from '@/lib/tracked-ai'

const result = await ai.generateObject(
  () => generateObject({ model: openai('gpt-4.1'), schema: mySchema, prompt: '...' }),
  'gpt-4.1',
  {
    userId: session.user.id,
    operationType: 'generation',
    feature: 'question-generation',
    endpoint: '/api/chat',
    entityType: 'test',
    entityId: testId,
    traceId: runId,
    // Людиночитабельні дані юзера — синхронізуються в колекцію users
    user: {
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,  // "student", "teacher" тощо
    },
  },
)
// result — той самий об'єкт, usage зафіксовано автоматично
```

**Для streaming:**

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
    feature: 'main-chat',
    endpoint: '/api/chat',
    traceId: runId,
    user: {
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
    },
  }, startTime),
})
```

### 6.4 Що дає тулза

| Без тулзи | З тулзою |
| --------- | -------- |
| 15+ рядків boilerplate в кожному ендпоінті | Один виклик `ai.generateObject(...)` або `ai.onStreamFinish(...)` |
| Легко забути зафіксувати помилку | Автоматичний трекінг і success, і error |
| Ручний розрахунок latency | Автоматичний |
| Ручний розрахунок вартості | Автоматичний (SDK рахує з таблиці цін) |
| Дублювання коду по ендпоінтах | Один import, один рядок |

---

## 7. Хаб UsageHub: API та агрегація

### 7.1 Підключення UsageHub до `usage_tracking`

UsageHub також використовує `mongoose.createConnection()` для читання:

```typescript
// zen-core/src/lib/usage-db.ts

import mongoose from 'mongoose'
import {
  tokenUsageEventSchema,
  usageSummarySchema,
  providerCostSchema,
  modelPricingSchema,
  projectSchema,
  userSchema,
} from './usage-tracker'

const conn = mongoose.createConnection(process.env.USAGE_DATABASE_URI!)

// Дані
export const TokenUsageEvent = conn.model('TokenUsageEvent', tokenUsageEventSchema)
export const UsageSummary = conn.model('UsageSummary', usageSummarySchema)
export const ProviderCost = conn.model('ProviderCost', providerCostSchema)
export const ModelPricing = conn.model('ModelPricing', modelPricingSchema)

// Довідники (людиночитабельні дані)
export const Project = conn.model('Project', projectSchema)
export const User = conn.model('User', userSchema)
```

### 7.2 API-ендпоінти

```text
UsageHub (читає з usage_tracking):

GET  /api/usage/summary         ?projectId=...&userId=...&period=daily&from=...&to=...
GET  /api/usage/top-users       ?projectId=...&period=monthly&limit=20
GET  /api/usage/models          ?projectId=...
GET  /api/usage/cost-comparison ?provider=openai&from=...&to=...
GET  /api/usage/anomalies
POST /api/usage/provider-cost   # Імпорт рахунку провайдера
GET  /api/usage/export          ?format=csv|json

# Довідники
GET  /api/usage/projects                    # Список проєктів (з назвами, статистикою)
GET  /api/usage/projects/:projectId         # Деталі проєкту
GET  /api/usage/users         ?projectId=...&search=...  # Пошук юзерів
GET  /api/usage/users/:userId               # Профіль юзера + історія
```

### 7.3 Aggregation Pipeline (фоновий cron)

```typescript
async function computeHourlyAggregates(hour: Date) {
  const pipeline = [
    {
      $match: {
        createdAt: { $gte: startOfHour(hour), $lt: endOfHour(hour) },
      },
    },
    {
      $group: {
        _id: {
          projectId: '$projectId',
          userId: '$userId',
          model: '$model',
          operationType: '$operationType',
        },
        totalRequests: { $sum: 1 },
        successfulRequests: {
          $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] },
        },
        failedRequests: {
          $sum: { $cond: [{ $ne: ['$status', 'success'] }, 1, 0] },
        },
        totalInputTokens: { $sum: '$inputTokens' },
        totalOutputTokens: { $sum: '$outputTokens' },
        totalTokens: { $sum: '$totalTokens' },
        totalCachedTokens: { $sum: { $ifNull: ['$cachedTokens', 0] } },
        totalReasoningTokens: { $sum: { $ifNull: ['$reasoningTokens', 0] } },
        totalEstimatedCostUsd: { $sum: '$estimatedCostUsd' },
        avgLatencyMs: { $avg: '$latencyMs' },
        maxLatencyMs: { $max: '$latencyMs' },
      },
    },
  ]

  const results = await TokenUsageEvent.aggregate(pipeline)

  for (const result of results) {
    await UsageSummary.updateOne(
      {
        periodType: 'hourly',
        periodStart: startOfHour(hour),
        projectId: result._id.projectId,
        userId: result._id.userId,
        model: result._id.model,
      },
      { $set: { ...result, periodEnd: endOfHour(hour) } },
      { upsert: true },
    )
  }
}
```

---

## 8. Розрахунок вартості та аномалії

### 8.1 Таблиця цін (fallback, актуальна на 2026-02)

```typescript
// src/pricing.ts

const FALLBACK_PRICING: Record<string, { input: number; output: number; cached?: number; reasoning?: number }> = {
  // USD за 1M токенів
  // OpenRouter models
  'openai/gpt-4o-mini':                          { input: 0.15,  output: 0.60 },
  'deepseek/deepseek-chat':                      { input: 0.32,  output: 0.89 },
  'meta-llama/llama-3.3-70b-instruct:free':      { input: 0,     output: 0 },
  // OpenAI direct
  'gpt-4.1':      { input: 2.00,  output: 8.00,  cached: 0.50 },
  'gpt-4.1-mini': { input: 0.40,  output: 1.60,  cached: 0.10 },
  'gpt-4.1-nano': { input: 0.10,  output: 0.40,  cached: 0.025 },
  'gpt-4o':       { input: 2.50,  output: 10.00, cached: 1.25 },
  'gpt-4o-mini':  { input: 0.15,  output: 0.60,  cached: 0.075 },
  'o3':           { input: 2.00,  output: 8.00,  reasoning: 8.00 },
  'o3-mini':      { input: 1.10,  output: 4.40,  reasoning: 4.40 },
  'o4-mini':      { input: 1.10,  output: 4.40,  reasoning: 4.40 },
  // Google Gemini (free tier)
  'gemini-2.0-flash':      { input: 0, output: 0 },
  'gemini-2.0-flash-lite': { input: 0, output: 0 },
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens = 0,
  reasoningTokens = 0,
): number {
  // TODO: підтягувати ціни з колекції modelPricing, fallback на хардкод
  const pricing = FALLBACK_PRICING[model]
  if (!pricing) return 0

  let cost = 0
  cost += ((inputTokens - cachedTokens) / 1_000_000) * pricing.input
  if (cachedTokens && pricing.cached) cost += (cachedTokens / 1_000_000) * pricing.cached
  cost += (outputTokens / 1_000_000) * pricing.output
  if (reasoningTokens && pricing.reasoning) cost += (reasoningTokens / 1_000_000) * pricing.reasoning

  return Math.round(cost * 1_000_000) / 1_000_000
}
```

### 8.2 Правила аномалій

| Правило | Тригер | Severity |
| ------- | ------ | -------- |
| `cost_spike` | Годинна вартість > 3x середньої за 7 днів | warning |
| `user_burst` | Один користувач > 50% бюджету за годину | critical |
| `billing_discrepancy` | Розбіжність з провайдером > 10% | warning/critical |
| `unusual_model` | Нехарактерна модель для проєкту | info |
| `off_hours_activity` | > 20 запитів між 1-5 ранку UTC | warning |

---

## 9. Дашборд та візуалізація

### Сторінки (UsageHub)

```text
/admin/usage/                    # Огляд по всіх проєктах
/admin/usage/[projectId]         # Деталі проєкту
/admin/usage/users               # Розбивка по користувачах
/admin/usage/users/[userId]      # Історія користувача
/admin/usage/models              # Порівняння моделей
/admin/usage/cost-comparison     # Наші дані vs рахунки провайдера
/admin/usage/anomalies           # Алерти
/admin/usage/export              # Експорт CSV/JSON
```

### Віджети

| Віджет | Тип |
| ------ | --- |
| Загальна вартість (період) | KPI-картка |
| Вартість по проєктах | Stacked bar |
| Вартість у часі | Line chart |
| Топ-10 користувачів | Horizontal bar |
| Розподіл по моделях | Donut chart |
| Об'єм запитів | Area chart |
| Внутрішня vs провайдерська вартість | Dual-axis chart |
| Активні аномалії | Список алертів |

**Рекомендована бібліотека:** Tremor (React + Tailwind, створена для дашбордів).

---

## 10. Гайд з інтеграції в будь-який проєкт

### Крок 1: Скопіювати папку + встановити mongoose

```bash
# Скопіювати папку usage-tracker з іншого проєкту
cp -r ../zen-tests/src/lib/usage-tracker src/lib/usage-tracker

# Додати mongoose як залежність (якщо ще немає)
pnpm add mongoose
```

### Крок 2: Env-змінна

```env
PROJECT_ID=my-project
USAGE_DATABASE_URI=mongodb://user:pass@host:27017/api_tokens_usage
```

### Крок 3: Створити тулзу (один файл)

```typescript
// src/lib/tracked-ai.ts

import { createUsageTracker, createTrackedAI } from './usage-tracker'

export const usageTracker = createUsageTracker({
  projectId: process.env.PROJECT_ID!,
  environment: process.env.NODE_ENV as 'production' | 'development',
  project: {
    name: 'My Project',           // Людиночитабельна назва
    description: 'Опис проєкту',
    url: 'https://my-project.zen.software',
  },
})

export const ai = createTrackedAI(usageTracker)

process.on('beforeExit', () => usageTracker.shutdown())
```

### Крок 4: Використовувати в ендпоінтах

```typescript
import { ai } from '@/lib/tracked-ai'

// generateObject / generateText:
const result = await ai.generateObject(
  () => generateObject({ model, schema, prompt }),
  'gpt-4.1',
  {
    userId,
    operationType: 'generation',
    feature: 'my-feature',
    user: { email: session.user.email, name: session.user.name, role: 'student' },
  },
)

// streamText:
const startTime = new Date()
streamText({
  model,
  messages,
  onFinish: ai.onStreamFinish('gpt-4.1', {
    userId,
    operationType: 'chat',
    user: { email: session.user.email, name: session.user.name },
  }, startTime),
})
```

Все. Чотири кроки, один файл конфігу, один import в ендпоінтах.
Довідникові дані (назва проєкту, ім'я/емейл юзера) синхронізуються автоматично.

---

## 11. Безпека

| Загроза | Мітигація |
| ------- | --------- |
| Витік USAGE_DATABASE_URI | Окремий MongoDB-юзер з write-only правами |
| PII в подіях | Ніколи не записувати промпти/відповіді. Емейли/імена — тільки в довідниках, не в events |
| Несанкціонований доступ до дашборду | UsageHub admin-авторизація |
| Підробка вартості | UsageHub перераховує з `modelPricing` |
| Replay-атаки | Mongoose `_id` + TTL |
| Крос-проєктне читання | Write-only юзер не має read-прав |

---

## 12. Динамічний вибір моделей через адмін-панель

Колекція `modelPricing` в usage DB використовується не лише для розрахунку вартості, а й як **каталог доступних моделей** для вибору через адмін-панель. Це дозволяє змінювати AI-моделі без редеплою.

### Як це працює

1. **Хаб** фетчить моделі з OpenRouter API → пише в `modelPricing` (з полями `displayName`, `contextLength`, `supportsVision`, `supportsToolCalling`, `supportsReasoning`)
2. **Проєкт** читає `modelPricing` через `GET /api/admin/models` → показує каталог в адмін-панелі
3. **Адмін** обирає модель для кожної ролі → зберігається в `AppSettings` (основна БД проєкту)
4. **Сервер** при AI-запиті читає `AppSettings` (кеш 5 хв) → резолвить `LanguageModel` об'єкт

### Що додати в кожен проєкт

- `AppSettings` модель в основній БД (зберігає маппінг роль → модель)
- `models.ts` — резолвер з кешем (async геттери замість статичних імпортів)
- API ендпоінти: `GET /models`, `GET /model-config`, `PUT /model-config`
- UI: адмін-панель із `ModelPicker` діалогом

> Повний опис архітектури — в `docs/AI_STRATEGY.md`, секція "Динамический выбор моделей из БД".

---

## Додаток A: Змінні середовища

```env
# ── Кожен проєкт ──
PROJECT_ID=my-project
USAGE_DATABASE_URI=mongodb://usage_writer:pass@host:27017/usage_tracking

# ── UsageHub ──
USAGE_DATABASE_URI=mongodb://usage_admin:pass@host:27017/usage_tracking
OPENAI_ORG_ID=org-xxx
ANOMALY_ALERT_WEBHOOK=https://hooks.slack.com/...
```

## Додаток B: OpenAI Usage API

```typescript
async function fetchOpenAIUsage(startDate: string, endDate: string) {
  const response = await fetch(
    `https://api.openai.com/v1/organization/usage/completions?` +
    `start_time=${startDate}&end_time=${endDate}&bucket_width=1d`,
    {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_ADMIN_KEY}`,
        'OpenAI-Organization': process.env.OPENAI_ORG_ID,
      },
    },
  )
  return response.json()
}
```

## Додаток C: Чек-лист

- [x] Створити MongoDB-базу `api_tokens_usage`
- [x] Створити папку `src/lib/usage-tracker/`
- [x] Mongoose-схеми + індекси (6 колекцій)
- [x] Реалізувати `UsageTracker` з буфером
- [x] Реалізувати реєстр довідників (`registerProject`, `syncUser`)
- [x] Реалізувати тулзу `createTrackedAI`
- [x] `calculateCost` з fallback-цінами
- [x] Розширити `modelPricing` характеристиками (displayName, contextLength, vision, tools, reasoning)
- [x] Інтегрувати в перший проєкт (help-bot)
- [x] Динамічний вибір моделей: `AppSettings` + `models.ts` кеш + адмін API
- [x] Адмін-панель: `ModelPicker` діалог із фільтрами (vision, tools, reasoning, ціна)
- [ ] Заповнити `modelPricing` через хаб (синхронізація з OpenRouter API)
- [ ] UsageHub: підключити моделі через `createConnection`
- [ ] UsageHub: aggregation pipeline (cron) + оновлення статистики в довідниках
- [ ] UsageHub: API ендпоінти для довідників (projects, users)
- [ ] UsageHub: дашборд з Tremor (юзери з іменами, проєкти з назвами)
- [ ] Правила аномалій
- [ ] OpenAI Usage API інтеграція
- [ ] Алертинг (Slack/Discord webhook)
- [ ] TTL-індекс на сирі події (90 днів)
- [ ] Онбордити решту проєктів
