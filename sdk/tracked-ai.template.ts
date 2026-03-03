/**
 * Шаблон ініціалізації Usage Tracker.
 *
 * 1. Скопіюй цей файл в src/lib/tracked-ai.ts
 * 2. Заміни TODO на реальні дані проєкту
 * 3. Імпортуй { ai } з цього файлу в ендпоінтах
 */

import { createUsageTracker, createTrackedAI } from './usage-tracker'

// ── Ініціалізація трекера ──────────────────────────────────────────

export const usageTracker = createUsageTracker({
  projectId: 'TODO-project-id', // TODO: унікальний ID проєкту (kebab-case)
  environment: (process.env.NODE_ENV as 'production' | 'staging' | 'development') ?? 'development',
  project: {
    name: 'TODO Project Name', // TODO: людиночитабельна назва
    description: '',           // TODO: опис проєкту (опціонально)
    url: '',                   // TODO: URL проєкту (опціонально)
    techStack: '',             // TODO: стек технологій (опціонально)
  },
})

export const ai = createTrackedAI(usageTracker)

// ── Graceful shutdown ──────────────────────────────────────────────

process.on('beforeExit', () => usageTracker.shutdown())

// ── Приклади використання ──────────────────────────────────────────
//
// import { generateObject, streamText } from 'ai'
// import { openai } from '@ai-sdk/openai'
// import { ai } from '@/lib/tracked-ai'
//
// // generateObject / generateText:
// const result = await ai.generateObject(
//   () => generateObject({ model: openai('gpt-4.1'), schema, prompt }),
//   'gpt-4.1',
//   {
//     userId: session.user.id,
//     operationType: 'generation',
//     feature: 'my-feature',
//     user: { email: session.user.email, name: session.user.name },
//   },
// )
//
// // streamText:
// const startTime = new Date()
// const result = streamText({
//   model: openai('gpt-4.1'),
//   messages,
//   onFinish: ai.onStreamFinish('gpt-4.1', {
//     userId: session.user.id,
//     operationType: 'chat',
//     user: { email: session.user.email, name: session.user.name },
//   }, startTime),
// })
