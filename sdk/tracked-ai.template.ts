/**
 * Usage Tracker initialization template.
 *
 * 1. Copy this file to src/lib/tracked-ai.ts
 * 2. Replace TODOs with your project data
 * 3. Import { ai } from this file in your endpoints
 */

import { createUsageTracker, createTrackedAI } from './usage-tracker'

// ── Tracker initialization ───────────────────────────────────────────

export const usageTracker = createUsageTracker({
  projectId: 'TODO-project-id', // TODO: unique project ID (kebab-case)
  environment: (process.env.NODE_ENV as 'production' | 'staging' | 'development') ?? 'development',
  project: {
    name: 'TODO Project Name', // TODO: human-readable name
    description: '',           // TODO: project description (optional)
    url: '',                   // TODO: project URL (optional)
    techStack: '',             // TODO: tech stack (optional)
  },
})

export const ai = createTrackedAI(usageTracker)

// ── Graceful shutdown ────────────────────────────────────────────────

process.on('beforeExit', () => usageTracker.shutdown())

// ── Usage examples ───────────────────────────────────────────────────
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
