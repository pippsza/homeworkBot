# Usage Tracker SDK — Quick Start

Трекінг токенів AI-викликів з автоматичним розрахунком вартості.

Дані збираються в центральну MongoDB → дашборд UsageHub.

---

## Встановлення (3 хвилини)

### 1. Скопіюй `usage-tracker/` в проєкт

```bash
cp -r usage-tracker/ <your-project>/src/lib/usage-tracker/
```

### 2. Додай mongoose (якщо ще немає)

```bash
pnpm add mongoose
```

### 3. Додай env-змінну

```env
# .env
USAGE_DATABASE_URI=mongodb://user:pass@host:27017/api_tokens_usage
```

URI має вказувати на **ту саму БД**, що й UsageHub.

### 4. Створи файл ініціалізації

Скопіюй шаблон і заповни TODO:

```bash
cp tracked-ai.template.ts <your-project>/src/lib/tracked-ai.ts
```

Відредагуй `tracked-ai.ts`:

```typescript
export const usageTracker = createUsageTracker({
  projectId: 'my-project',              // ← твій ID
  environment: process.env.NODE_ENV as 'production' | 'development',
  project: {
    name: 'My Project',                 // ← назва для дашборду
  },
})

export const ai = createTrackedAI(usageTracker)
process.on('beforeExit', () => usageTracker.shutdown())
```

### 5. Обгорни AI-виклики

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

## Що трекається автоматично

| Поле | Джерело |
|------|---------|
| Токени (input, output, cached, reasoning) | AI SDK `usage` |
| Вартість (USD) | `modelPricing` колекція (fallback на хардкод) |
| Latency | Автоматичний замір |
| Статус (success/error) | Try-catch обгортка |
| Проєкт | `projectId` з конфігу |
| Юзер (email, name, role) | `TrackingContext.user` |

---

## TrackingContext — всі поля

```typescript
{
  userId: string           // Обов'язково
  operationType: string    // Обов'язково: "chat", "generation", "embedding"
  feature?: string         // Фіча: "question-gen", "search"
  endpoint?: string        // Ендпоінт: "/api/chat"
  entityType?: string      // Бізнес-сутність: "test", "document"
  entityId?: string        // ID сутності
  traceId?: string         // Для групування викликів (auto-generated)
  promptSummary?: string   // Опис промпту (~500 символів)
  user?: {                 // Довідникові дані юзера
    email?: string
    name?: string
    role?: string          // "student", "teacher", "admin"
    avatarUrl?: string
    meta?: Record<string, unknown>
  }
}
```

---

## Як працює під капотом

```
ai.generateObject(fn, model, ctx)
    │
    ├─ fn() → оригінальний AI-виклик
    ├─ tracker.record(event) → буфер (до 50 подій)
    │     └─ maybeSyncUser() → оновлення колекції users (debounce 60с)
    │
    └─ flush() (кожні 5с або при заповненні буфера)
          ├─ loadPricingFromDb() → ціни з БД
          ├─ calculateCost() → вартість кожного евента
          └─ insertMany() → batch-запис в tokenUsageEvents
```

- Буфер: **50 подій** або **5 секунд** (що раніше)
- Вартість рахується при flush (одне завантаження цін на батч)
- Якщо DB цін недоступна → fallback pricing (хардкод)
- Якщо flush впав → події повертаються в буфер
- TTL: сирі події видаляються через **90 днів**

---

## Конфігурація

```typescript
createUsageTracker({
  projectId: string                    // Унікальний ID (kebab-case)
  environment: 'production' | 'staging' | 'development'
  buffer?: {
    maxSize?: number                   // Default: 50
    flushIntervalMs?: number           // Default: 5000
  }
  project?: {
    name: string                       // Назва для дашборду
    description?: string
    url?: string
    techStack?: string
    team?: string
    contactEmail?: string
  }
})
```

---

## Чек-лист

- [ ] `src/lib/usage-tracker/` скопійовано
- [ ] `mongoose` встановлено
- [ ] `USAGE_DATABASE_URI` в `.env`
- [ ] `src/lib/tracked-ai.ts` створено з `projectId`
- [ ] AI-виклики обгорнуті через `ai.generateObject()` / `ai.onStreamFinish()`
- [ ] `userId` передається в кожному виклику
- [ ] Graceful shutdown підключено
- [ ] Перевірено в дашборді UsageHub

---

## Troubleshooting

| Проблема | Рішення |
|----------|---------|
| Проєкт не з'являється в дашборді | Перевір `USAGE_DATABASE_URI`, `projectId`, логи `[UsageTracker]` |
| Вартість $0.00 | Назва моделі в коді має збігатися з `modelPricing`. Sync через UsageHub |
| Events не пишуться | Перевір write-права MongoDB-юзера, `tracker.shutdown()` при зупинці |

---

## Структура файлів після інтеграції

```
src/lib/
├── tracked-ai.ts              ← твій файл (з projectId)
└── usage-tracker/             ← SDK (скопійовано)
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
