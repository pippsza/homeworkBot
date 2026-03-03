import { Schema, type InferSchemaType } from 'mongoose'

const projectSchema = new Schema(
  {
    projectId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: { type: String, required: true },
    description: String,
    url: String,
    environment: {
      type: String,
      enum: ['production', 'staging', 'development'],
    },
    techStack: String,
    team: String,
    contactEmail: String,

    // Статистика (оновлює ZenCore aggregation)
    lastActivityAt: Date,
    totalRequestsAllTime: { type: Number, default: 0 },
    totalCostAllTimeUsd: { type: Number, default: 0 },

    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: 'projects',
  },
)

export type ProjectDoc = InferSchemaType<typeof projectSchema>
export { projectSchema }
