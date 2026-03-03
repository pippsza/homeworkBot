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

export function getUsageSummaryModel() {
  return getUsageConnection().model('UsageSummary', usageSummarySchema)
}

export function getProviderCostModel() {
  return getUsageConnection().model('ProviderCost', providerCostSchema)
}
