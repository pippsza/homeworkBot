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
