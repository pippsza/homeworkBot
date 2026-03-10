import mongoose from 'mongoose'
import { tokenUsageEventSchema } from './schemas/token-usage-event'
import { modelPricingSchema } from './schemas/model-pricing'
import { usageSummarySchema } from './schemas/usage-summary'
import { providerCostSchema } from './schemas/provider-cost'
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
  const conn = getUsageConnection()
  return conn.models['TokenUsageEvent'] || conn.model('TokenUsageEvent', tokenUsageEventSchema)
}

export function getModelPricingModel() {
  const conn = getUsageConnection()
  return conn.models['ModelPricing'] || conn.model('ModelPricing', modelPricingSchema)
}

export function getProjectModel() {
  const conn = getUsageConnection()
  return conn.models['Project'] || conn.model('Project', projectSchema)
}

export function getUserModel() {
  const conn = getUsageConnection()
  return conn.models['User'] || conn.model('User', userSchema)
}

export function getUsageSummaryModel() {
  const conn = getUsageConnection()
  return conn.models['UsageSummary'] || conn.model('UsageSummary', usageSummarySchema)
}

export function getProviderCostModel() {
  const conn = getUsageConnection()
  return conn.models['ProviderCost'] || conn.model('ProviderCost', providerCostSchema)
}
