# Стратегия использования AI-провайдеров

Универсальный гайд для проектов, использующих AI: tool calling, чат, генерация кода, эмбеддинги.

---

## Маршрутизация моделей

Разные задачи требуют разных моделей. Одна модель на всё = переплата или плохое качество.

| Тип задачи | Лучшие модели | Почему | Цена (за 1M токенов) |
|------------|---------------|--------|----------------------|
| **Tool Calling / Агенты** | GPT-4o-mini, Claude Haiku | Надёжный JSON, быстрые | $0.15 вход / $0.60 выход |
| **Сложная логика** | DeepSeek V3, GPT-4o, Claude Sonnet | Лучше рассуждения, длинный контекст | $0.50–3.00 / $1–15 |
| **Простой чат** | Бесплатные (Llama 3.3 70B, Gemma) | Достаточно для Q&A | Бесплатно / ~$0.05 |
| **Эмбеддинги** | text-embedding-3-small | Дёшево, хорошее качество | $0.02 |
| **Генерация кода** | DeepSeek Coder V2, Claude Sonnet | Лучшее качество кода | $0.50–3.00 |

### Ключевой принцип

> Сопоставляй мощность модели со сложностью задачи. Не используй GPT-4o для "да/нет" tool calls. Не используй бесплатные модели для структурированного JSON.

---

## Риски: как retry-цикл сожрёт баланс за ночь

### Риск 1: Авто-ретраи AI SDK

**`maxRetries` по умолчанию = 2** — при 5xx ошибках SDK автоматически повторяет запрос до 2 раз. Каждый ретрай на платной модели = потраченные деньги.

```ts
// ОПАСНО: 3 попытки на запрос (1 оригинал + 2 ретрая)
streamText({ model, messages })

// БЕЗОПАСНО: без авто-ретраев на платных моделях
streamText({ model, messages, maxRetries: 0 })
```

**Правило:** `maxRetries: 0` для платных провайдеров. Ретраи — только для бесплатных.

### Риск 2: Циклы Tool Call

Если тулза постоянно фейлится (например, БД упала), модель будет снова и снова вызывать её. Каждый раунд = новый API-вызов = деньги.

```ts
// ОПАСНО: модель может зациклить вызовы тулзов
streamText({ model, messages, tools, stopWhen: stepCountIs(10) })

// БЕЗОПАСНО: ограничить раунды
streamText({ model, messages, tools, stopWhen: stepCountIs(3) })
```

> В AI SDK <6 используется `maxSteps: 3` вместо `stopWhen: stepCountIs(3)`.

**Сценарий:** БД упала → `search_games` бросает ошибку → модель говорит "попробую ещё раз" → вызывает `search_games` → опять ошибка → повторяет... × `stepCount` раз. Каждый шаг = полная стоимость генерации.

### Риск 3: Нет лимита длины ответа

Без `maxTokens` модель может сгенерировать очень длинный ответ. На pay-per-token моделях это прямые расходы.

```ts
// ОПАСНО: модель может выдать 16K+ токенов
streamText({ model, messages })

// БЕЗОПАСНО: ограничить выход
streamText({ model, messages, maxOutputTokens: 1024 })
```

> В AI SDK <6 используется `maxTokens` вместо `maxOutputTokens`.

**Правило:** `maxOutputTokens` пропорционально сложности задачи:

- Tool calling: 200–300 токенов (JSON тулзы ~30 + короткий ответ ~200)
- Чат-ответы: 512–1024 токенов
- Генерация кода: 1024–2048 токенов

### Риск 4: Нет rate limiting на API-роуте

Без серверного рейт-лимитинга бот (или юзер с DevTools) может спамить endpoint.

```ts
// Простой in-memory rate limiter
const requestCounts = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(userId: string, maxPerMinute = 10): boolean {
  const now = Date.now()
  const entry = requestCounts.get(userId)

  if (!entry || now > entry.resetAt) {
    requestCounts.set(userId, { count: 1, resetAt: now + 60_000 })
    return true
  }

  if (entry.count >= maxPerMinute) return false
  entry.count++
  return true
}
```

### Риск 5: Растущий контекст диалога

Каждый запрос отправляет ВСЮ историю переписки. Диалог из 50 сообщений = вы платите за все 50 сообщений как входные токены при каждом запросе.

```
Сообщение 1:   500 токенов на входе
Сообщение 2:  1000 токенов на входе
Сообщение 3:  1500 токенов на входе
...
Сообщение 50: 25000 токенов на входе  ← платите за ЭТО каждый раз
```

**Решения:**
- Ограничить историю (например, последние 20 сообщений)
- Суммаризировать старые сообщения перед отправкой
- Начинать новые сессии чата периодически

### Риск 6: Client-side retry при обрыве стрима

Если стрим обрывается, клиент (например, хук `useChat`) может авто-ретраить. Сервер уже заплатил за частичный ответ И платит снова за полный ретрай.

**Решение:** Отключить клиентский авто-ретрай или реализовать idempotency keys.

---

## Чеклист безопасности

Перед деплоем AI с платными провайдерами:

- [ ] `maxRetries: 0` на платных моделях
- [ ] `maxOutputTokens` установлен для каждого вызова `streamText`/`generateText`
- [ ] `stopWhen: stepCountIs(N)` ограничен (если используется tool calling)
- [ ] Серверный rate limiting по юзеру
- [ ] Обрезка истории диалога
- [ ] Алерты по расходам в дашборде провайдера (OpenRouter, OpenAI и т.д.)
- [ ] Auth-проверка на API-роуте (нет анонимного доступа)
- [ ] Ошибки не триггерят клиентские ретраи
- [ ] Логирование: трекать стоимость каждого запроса

---

## OpenAI: Strict Tool Schema

OpenAI (и OpenRouter при использовании OpenAI-моделей типа `gpt-4o-mini`) требует **strict JSON Schema** для tool parameters. Все поля из `properties` **обязаны** быть в `required`. Если поле не в `required` — API возвращает `400 Invalid schema`.

### Проблема

```ts
// СЛОМАНО: description не в required → OpenAI отклоняет
parameters: z.object({
  title: z.string(),
  description: z.string().optional(),  // ← генерирует НЕ required поле
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
})
// Ошибка: "Missing 'description' in required"
```

### Решение

Убрать `.optional()` и `.default()`. Вместо этого использовать пустые строки/массивы как "нет значения" и описать это в `.describe()`:

```ts
// ПРАВИЛЬНО: все поля required, пустая строка = нет значения
parameters: z.object({
  title: z.string().describe('Заголовок'),
  description: z.string().describe('Описание. Пустая строка если нет'),
  priority: z.enum(['low', 'medium', 'high']).describe('Приоритет'),
  tags: z.array(z.string()).describe('Теги. Пустой массив если нет'),
  dueDate: z.string().describe('Дедлайн ISO. Пустая строка если нет'),
})
```

В `execute` обрабатывать через truthy-проверки:

```ts
execute: async ({ description, dueDate, tags }) => {
  // Пустая строка = falsy, не попадёт в БД
  if (description) data.description = description;
  if (dueDate) data.dueDate = new Date(dueDate);
  if (tags.length) data.tags = tags;
}
```

### Для enum с "пустым" значением

Если поле опционально и enum, добавить пустую строку в варианты:

```ts
status: z.enum(['pending', 'in_progress', 'done', '']).describe('Фильтр. Пустая строка — все'),
```

> **Важно:** Это ограничение OpenAI, не Gemini/Claude. Но если используешь OpenRouter с разными моделями через единый набор тулзов — делай schema совместимой с OpenAI.

---

## AI SDK v6: критические изменения

При апгрейде с AI SDK v4/v5 на v6 — множество ломающих изменений. Если что-то не работает — проверь этот раздел первым.

### Переименованные параметры

| Было (v4/v5) | Стало (v6) | Где |
| --- | --- | --- |
| `maxTokens` | `maxOutputTokens` | `streamText`, `generateText` |
| `maxSteps: 3` | `stopWhen: stepCountIs(3)` | `streamText`, `generateText` (импорт `stepCountIs` из `ai`) |
| `LanguageModelV1` | `LanguageModel` | Тип модели (импорт из `ai`) |
| `parameters` | `inputSchema` | Определение тулзов |

### Тулзы: `parameters` → `inputSchema`

**Это самая частая ошибка.** В v6 `tool()` — это identity-функция для вывода типов TypeScript. Она НЕ трансформирует объект. SDK читает `tool.inputSchema`, а не `tool.parameters`.

Если использовать старое имя `parameters`, SDK получает `inputSchema = undefined` → генерирует пустую JSON Schema без `type` → OpenAI отклоняет с ошибкой `type: "None"`.

```ts
// СЛОМАНО (v4/v5 синтаксис):
export const myToolSchema = {
  description: '...',
  parameters: z.object({ query: z.string() }),  // ← SDK игнорирует!
}
// Ошибка: "schema must be a JSON Schema of 'type: "object"', got 'type: "None"'"

// ПРАВИЛЬНО (v6):
export const myToolSchema = {
  description: '...',
  inputSchema: z.object({ query: z.string() }),  // ← SDK читает это
}
```

Типы тоже обновить:

```ts
// Было:
export type MyParams = z.infer<typeof myToolSchema.parameters>
// Стало:
export type MyParams = z.infer<typeof myToolSchema.inputSchema>
```

### OpenRouter: `.chat()` обязателен

В AI SDK v6 `createOpenAI` по умолчанию использует **Responses API** (`/v1/responses`). OpenRouter — OpenAI-совместимый прокси, он работает только через **Chat Completions API** (`/v1/chat/completions`).

```ts
const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
})

// СЛОМАНО: пойдёт на /v1/responses → OpenRouter не поддерживает
const model = openrouter('openai/gpt-4o-mini')

// ПРАВИЛЬНО: пойдёт на /v1/chat/completions
const model = openrouter.chat('openai/gpt-4o-mini')
```

> Это касается ЛЮБОГО OpenAI-совместимого провайдера (OpenRouter, LiteLLM, Ollama, vLLM и т.д.). Прямой OpenAI (`openai('gpt-4o-mini')`) — можно без `.chat()`, они поддерживают Responses API.

### `onFinish` и дженерики тулзов

Тип `onFinish` в `streamText` — это `StreamTextOnFinishCallback<TOOLS>`. Если передать конкретную (не-дженерик) функцию, TypeScript не может вывести тип `TOOLS` → ломается вывод типов всех тулзов.

**Решение:** `as any` на `onFinish`:

```ts
streamText({
  model,
  tools: { ... },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onFinish: myCallback as any,
})
```

### `convertToModelMessages`

В v6 для конвертации `UIMessage[]` (от клиента) в `ModelMessage[]` (для SDK) используется:

```ts
import { convertToModelMessages } from 'ai'
const messages = await convertToModelMessages(uiMessages)
```

> В v4/v5 это было `convertToCoreMessages`.

### Кодмод

AI SDK предоставляет автоматическую миграцию:

```bash
npx @ai-sdk/codemod v6
```

---

## OpenRouter

[OpenRouter](https://openrouter.ai/) — единый API-шлюз для 100+ моделей через OpenAI-совместимый API.

### Бесплатные модели

При балансе > $10 вы получаете **1000 запросов/день** к `:free` моделям (например, `meta-llama/llama-3.3-70b-instruct:free`). Ниже $10 — бесплатный доступ отключается.

### Подключение через AI SDK

```ts
import { createOpenAI } from '@ai-sdk/openai'

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: {
    'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL,
    'X-Title': 'My App Name',
  },
})

// ВАЖНО: .chat() обязателен — OpenRouter не поддерживает Responses API
const model = openrouter.chat('openai/gpt-4o-mini')
```

---

## Google Gemini

### Лимиты бесплатного тира (2025)

| Модель | RPM | RPD |
|--------|-----|-----|
| gemini-2.5-flash | 10 | 500 |
| gemini-2.0-flash | 15 | 1500 |
| gemini-2.0-flash-lite | 30 | 1500 |

**Важно:** Лимиты бесплатного тира общие для ВСЕХ проектов одного Google-аккаунта. Создание новых проектов с новыми API-ключами НЕ даёт отдельные квоты.

### Ротация ключей

Если есть несколько Google-аккаунтов, можно ротировать ключи:

```ts
const keys = process.env.GOOGLE_AI_KEYS?.split(',').filter(Boolean) ?? []
let keyIndex = 0

function getNextGeminiKey(): string {
  const key = keys[keyIndex % keys.length]
  keyIndex = (keyIndex + 1) % keys.length
  return key
}
```

---

## Динамический выбор моделей из БД (вместо хардкода)

Вместо хардкода моделей в конфиг-файлах — модели хранятся в БД и выбираются через админ-панель. Это позволяет менять модели без редеплоя.

### Архитектура (3 слоя)

```
┌─────────────────────┐
│   Admin UI (React)  │  Выбирает модель для каждой роли
└─────────┬───────────┘
          │ PUT /api/admin/model-config
┌─────────▼───────────┐
│  AppSettings (MongoDB)│  Хранит назначения: роль → modelId + provider
└─────────┬───────────┘
          │ читает при запросе (кеш 5 мин)
┌─────────▼───────────┐
│  models.ts (кеш)    │  Резолвит LanguageModel объекты из AI SDK
└─────────┬───────────┘
          │ используют getChatModels() / getSolveModels()
┌─────────▼───────────┐
│  Потребители         │  ai.ts, autoSolve.ts, message.ts, chat.ts
└─────────────────────┘
```

### Слой 1: Каталог моделей — `modelPricing` (usage DB)

Коллекция `modelPricing` в **отдельной usage DB** хранит все доступные модели с ценами и характеристиками. Заполняется **извне** — хаб-приложение фетчит данные из OpenRouter API (`GET https://openrouter.ai/api/v1/models`) и записывает в БД.

**Поля (расширенная схема):**

```ts
const modelPricingSchema = new Schema({
  provider: { type: String, required: true },       // "openrouter" | "google"
  model: { type: String, required: true, index: true }, // "openai/gpt-4o-mini"
  inputPricePerMillionTokens: { type: Number, required: true, min: 0 },
  outputPricePerMillionTokens: { type: Number, required: true, min: 0 },
  cachedInputPricePerMillionTokens: { type: Number, min: 0 },
  reasoningPricePerMillionTokens: { type: Number, min: 0 },
  effectiveFrom: { type: Date, required: true },
  effectiveTo: Date,
  source: String,

  // Характеристики модели (добавлены для фильтрации в UI)
  displayName: { type: String },                     // "GPT-4o Mini"
  contextLength: { type: Number },                   // 128000
  supportsVision: { type: Boolean, default: false },
  supportsToolCalling: { type: Boolean, default: false },
  supportsReasoning: { type: Boolean, default: false },
}, { timestamps: true, collection: 'modelPricing' });
```

Это **справочник** — приложения его **только читают** (`GET /api/admin/models`), а хаб пишет.

### Слой 2: Конфиг назначений — `AppSettings` (основная DB проекта)

Одна запись `{ key: 'modelConfig' }` хранит маппинг **ролей → конкретные модели**. Каждый проект определяет свои роли.

```ts
interface ModelRoleConfig {
  modelId: string;           // "openai/gpt-4o-mini"
  provider: 'openrouter' | 'google';
  fallbackModelId?: string;  // запасная модель при 429
  fallbackProvider?: 'openrouter' | 'google';
}

interface ModelRolesConfig {
  chat: ModelRoleConfig;           // чат с тулзами (нужен tool calling)
  solveText: ModelRoleConfig;      // решение текстовых заданий
  solveTextPro: ModelRoleConfig;   // решение текста премиум-моделью
  solveImage: ModelRoleConfig;     // решение заданий с фото (нужен vision)
  solveImagePro: ModelRoleConfig;  // решение с фото премиум
}
```

**Дефолты** (если записи нет в БД):
```ts
const DEFAULT_MODEL_ROLES: ModelRolesConfig = {
  chat:          { modelId: 'openai/gpt-4o-mini',    provider: 'openrouter', fallbackModelId: 'gemini-2.0-flash', fallbackProvider: 'google' },
  solveText:     { modelId: 'google/gemini-2.5-flash', provider: 'openrouter', fallbackModelId: 'gemini-2.5-flash', fallbackProvider: 'google' },
  solveTextPro:  { modelId: 'google/gemini-2.5-pro',   provider: 'openrouter' },
  solveImage:    { modelId: 'google/gemini-2.5-flash', provider: 'openrouter', fallbackModelId: 'gemini-2.5-flash', fallbackProvider: 'google' },
  solveImagePro: { modelId: 'google/gemini-2.5-pro',   provider: 'openrouter' },
};
```

**API:**
- `GET /api/admin/model-config` — текущий конфиг
- `PUT /api/admin/model-config` — сохранить + сбросить кеш

### Слой 3: Резолвер моделей — `models.ts` (серверный in-memory кеш)

Центральный файл. **Кеш в памяти** (5 мин TTL). Преобразует строки `modelId + provider` в объекты `LanguageModel` из AI SDK.

```ts
// Провайдеры
const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: config.openrouterApiKey,
});
const google = createGoogleGenerativeAI({ apiKey: config.googleAiApiKey });

function createModel(modelId: string, provider: string): LanguageModel {
  if (provider === 'google') return google(modelId);
  return openrouter(modelId);
}

// Публичный API:
export async function getChatModels(): Promise<ResolvedModels>
export async function getSolveModels(hasImages: boolean): Promise<ResolvedModels>
export async function getProSolveModels(hasImages: boolean): Promise<ResolvedModels>
export function invalidateModelCache(): void
```

**`ResolvedModels`:**
```ts
interface ResolvedModels {
  primary: LanguageModel;      // основная модель (объект AI SDK)
  fallback?: LanguageModel;    // запасная (при 429)
  primaryId: string;           // для трекинга использования
  fallbackId?: string;
  primaryProvider: string;
  fallbackProvider?: string;
}
```

**Роутинг по изображениям:** `getSolveModels(hasImages)` — если в задании есть фото, берёт `solveImage`, иначе `solveText`. Это позволяет использовать дешёвый DeepSeek для текста и Gemini с vision для фото.

### Как потребители используют

```ts
// В чате:
const models = await getChatModels();
streamText({ model: models.primary, ... });
// при 429 → streamText({ model: models.fallback!, ... });

// В авто-решении:
const hasImages = homework.attachments.some(a => a.mimeType?.startsWith('image/'));
const models = await getSolveModels(hasImages);
generateText({ model: models.primary, ... });
```

### Admin UI: выбор моделей

Вкладка "Модели" в админ-панели — **5 карточек** (по одной на роль). Каждая показывает текущую модель кнопкой. Клик → **полноэкранный диалог** `ModelPicker` с:
- Поиском по названию/провайдеру
- Фильтрами: Vision, Tools, Reasoning (toggle)
- Фильтрами по цене: Free, < $1, < $5, Все
- Детальными карточками моделей (название, цены in/out, контекст, бейджи)

Роли автоматически фильтруют модели:
- `chat` → только модели с `supportsToolCalling: true`
- `solveImage` / `solveImagePro` → только модели с `supportsVision: true`

### Как имплементировать в другом проекте

1. **Скопировать `modelPricing` schema** (в usage-tracker — она уже общая)
2. **Создать `AppSettings` модель** в основной DB проекта — определить свои роли
3. **Создать `models.ts`** — резолвер с кешем, адаптировать роли под проект
4. **Добавить 3 API эндпоинта**: `GET /models`, `GET /model-config`, `PUT /model-config`
5. **UI**: карточки ролей + `ModelPicker` диалог (можно скопировать компонент)
6. **В хабе**: добавить синхронизацию новых полей (`displayName`, `contextLength`, `supportsVision`, `supportsToolCalling`, `supportsReasoning`) из OpenRouter API

---

## Структура конфиг-файла (legacy — для справки)

> **Устаревший подход** — хардкод моделей в конфиге. Оставлен для справки. В новых проектах используй динамический выбор из БД (см. выше).

```ts
// ai.config.ts
export const aiConfig = {
  providers: {
    openrouter: {
      baseURL: 'https://openrouter.ai/api/v1',
      envKey: 'OPENROUTER_API_KEY',
    },
    google: {
      envKey: 'GOOGLE_GENERATIVE_AI_API_KEYS',
    },
  },
  routing: {
    toolCalling: {
      primary:  { provider: 'openrouter', model: 'openai/gpt-4o-mini' },
      fallback: { provider: 'google',     model: 'gemini-2.0-flash' },
    },
    chat: {
      primary:  { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' },
      fallback: { provider: 'google',     model: 'gemini-2.0-flash' },
    },
    reasoning: {
      primary:  { provider: 'openrouter', model: 'deepseek/deepseek-chat' },
      fallback: { provider: 'openrouter', model: 'openai/gpt-4o-mini' },
    },
  },
  safety: {
    maxOutputTokens: { toolCalling: 300, chat: 1024, reasoning: 2048 },
    maxRetries:      { paid: 0, free: 2 },
    stepCount:       3,
    rateLimit:   { maxPerMinute: 10 },
    maxMessages: 10,
  },
}
```

---

## Блок-схема принятия решений

```
Новый AI-запрос
│
├─ Загрузить модель из AppSettings (кеш 5 мин)
│   ├─ Есть в БД → использовать
│   └─ Нет → использовать DEFAULT_MODEL_ROLES
│
├─ Отправить на primary модель (maxRetries: 0)
│   ├─ Успех → Вернуть
│   └─ 429/5xx → Есть fallback?
│       ├─ Да → Отправить на fallback (maxRetries: 2)
│       │        ├─ Успех → Вернуть
│       │        └─ Ошибка → Вернуть ошибку юзеру
│       └─ Нет → Вернуть ошибку юзеру
│
└─ Всё трекается через usage-tracker (токены, стоимость, модель)
```
