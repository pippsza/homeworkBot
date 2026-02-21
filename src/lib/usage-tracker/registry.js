const { getProjectModel, getUserModel } = require("./connection");

/**
 * Register a project in the directory.
 * Called once at SDK initialization. Upsert by projectId.
 */
async function registerProject(info) {
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
  } catch (error) {
    console.error(
      "[UsageTracker] Failed to register project:",
      error.message
    );
  }
}

/**
 * Sync user data in the directory.
 * Called by SDK on each AI call (debounced in tracker).
 * Upsert by userId + projectId.
 */
async function syncUser(projectId, info) {
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
  } catch (error) {
    console.error("[UsageTracker] Failed to sync user:", error.message);
  }
}

module.exports = { registerProject, syncUser };
