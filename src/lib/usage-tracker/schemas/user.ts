import { Schema, type InferSchemaType } from 'mongoose'

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
    email: String,
    name: String,
    role: String,
    avatarUrl: String,

    // Будь-які додаткові мета-поля від проєкту
    meta: { type: Schema.Types.Mixed, default: {} },

    // Статистика (оновлює ZenCore aggregation)
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

export type UserDoc = InferSchemaType<typeof userSchema>
export { userSchema }
