import { getProjectModel, getUserModel } from "./connection";

interface ProjectInfo {
  projectId: string;
  environment?: string;
  name?: string;
  description?: string;
  techStack?: string;
  [key: string]: unknown;
}

interface UserInfo {
  userId: string;
  [key: string]: unknown;
}

/**
 * Register a project in the directory.
 * Called once at SDK initialization. Upsert by projectId.
 */
export async function registerProject(info: ProjectInfo): Promise<void> {
  try {
    const Project = getProjectModel();
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
      { upsert: true }
    );
  } catch (error: unknown) {
    console.error(
      "[UsageTracker] Failed to register project:",
      (error as Error).message
    );
  }
}

/**
 * Sync user data in the directory.
 * Called by SDK on each AI call (debounced in tracker).
 * Upsert by userId + projectId.
 */
export async function syncUser(projectId: string, info: UserInfo): Promise<void> {
  try {
    const User = getUserModel();
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
      { upsert: true }
    );
  } catch (error: unknown) {
    console.error("[UsageTracker] Failed to sync user:", (error as Error).message);
  }
}
