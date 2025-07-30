/**
 * Utility functions to check repository and channel limits based on environment variables
 */

/**
 * Get the maximum number of repositories allowed per server
 * @returns {number} Maximum repositories allowed
 */
function getMaxReposAllowed() {
  const maxRepos = process.env.MAX_REPOS_ALLOWED;
  if (maxRepos && !isNaN(parseInt(maxRepos))) {
    return parseInt(maxRepos);
  }
  return 10; // Default fallback
}

/**
 * Get the maximum number of notification channels allowed per server
 * @returns {number} Maximum channels allowed
 */
function getMaxChannelsAllowed() {
  const maxChannels = process.env.MAX_NOTIFICATION_CHANNELS_ALLOWED;
  if (maxChannels && !isNaN(parseInt(maxChannels))) {
    return parseInt(maxChannels);
  }
  return Infinity; // Default to unlimited
}

/**
 * Check if a server is at or beyond the repository limit
 * @param {Object} prisma - Prisma client instance
 * @param {string} serverId - Server ID to check
 * @returns {Promise<Object>} Repository limit status
 */
async function checkRepositoryLimit(prisma, serverId) {
  try {
    const currentRepoCount = await prisma.repository.count({
      where: { serverId }
    });

    const maxAllowed = getMaxReposAllowed();
    
    return {
      isAtLimit: currentRepoCount >= maxAllowed,
      currentCount: currentRepoCount,
      maxAllowed,
      remaining: Math.max(0, maxAllowed - currentRepoCount)
    };
  } catch (error) {
    console.error('Error checking repository limit:', error);
    return { isAtLimit: false, currentCount: 0, maxAllowed: getMaxReposAllowed(), remaining: getMaxReposAllowed() };
  }
}

/**
 * Check if a server is at or beyond the channel limit
 * @param {Object} prisma - Prisma client instance
 * @param {string} serverId - Server ID to check
 * @param {string|null} excludeChannelId - Channel ID to exclude from count
 * @param {string|null} includeNewChannelId - Channel ID to include in calculation
 * @returns {Promise<Object>} Channel limit status
 */
async function checkChannelLimit(prisma, serverId, excludeChannelId = null, includeNewChannelId = null) {
  try {
    const maxAllowed = getMaxChannelsAllowed();
    
    // If unlimited channels, always return false for limit
    if (maxAllowed === Infinity) {
      return { isAtLimit: false, currentCount: 0, maxAllowed: Infinity, remaining: Infinity };
    }

    // Get server with repositories and tracked branches
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      include: { 
        repositories: {
          include: {
            trackedBranches: true
          }
        }
      }
    });

    if (!server) {
      console.error(`No server found for serverId: ${serverId}`);
      return { isAtLimit: false, currentCount: 0, maxAllowed, remaining: maxAllowed };
    }

    // Create a map to track all channels used
    const channelUsage = new Map(); // channelId -> { isRepoDefault: boolean, isUsedExplicitly: boolean }
    
    // Mark repository default channels
    const repoDefaultChannels = new Set();
    for (const repo of server.repositories) {
      if (repo.notificationChannelId) {
        repoDefaultChannels.add(repo.notificationChannelId);
        channelUsage.set(repo.notificationChannelId, { 
          isRepoDefault: true, 
          isUsedExplicitly: false 
        });
      }
    }

    // Count all channels that are explicitly used for branch tracking
    for (const repo of server.repositories) {
      for (const branch of repo.trackedBranches) {
        if (branch.channelId && branch.channelId !== excludeChannelId) {
          if (!channelUsage.has(branch.channelId)) {
            channelUsage.set(branch.channelId, {
              isRepoDefault: repoDefaultChannels.has(branch.channelId),
              isUsedExplicitly: true
            });
          } else {
            const info = channelUsage.get(branch.channelId);
            info.isUsedExplicitly = true;
            channelUsage.set(branch.channelId, info);
          }
        }
      }
    }
    
    // Calculate current count WITHOUT including the potential new channel
    const distinctChannelsCurrentlyInUse = new Set();
    for (const [channelId, info] of channelUsage.entries()) {
      if (info.isUsedExplicitly) {
        distinctChannelsCurrentlyInUse.add(channelId);
      }
    }
    
    // Now, if we're checking for a new channel, calculate what the count would be if we added it
    let potentialChannelCount = distinctChannelsCurrentlyInUse.size;
    let isNewChannelAlreadyInUse = false;
    
    if (includeNewChannelId) {
      isNewChannelAlreadyInUse = distinctChannelsCurrentlyInUse.has(includeNewChannelId);
      
      if (!isNewChannelAlreadyInUse) {
        // Only increment the count if this channel isn't already counted
        potentialChannelCount++;
      }
    }

    // Log for debugging
    console.log(`Channel limit check - Server: ${serverId}`);
    console.log(`Repo default channels: ${Array.from(repoDefaultChannels).join(', ')}`);
    console.log(`Distinct channels used for branch tracking: ${Array.from(distinctChannelsCurrentlyInUse).join(', ')}`);
    console.log(`Total distinct channels currently in use: ${distinctChannelsCurrentlyInUse.size}`);
    if (includeNewChannelId) {
      console.log(`Checking if adding channel ${includeNewChannelId} would exceed limit`);
      console.log(`Potential channel count: ${potentialChannelCount}`);
    }

    const currentCount = distinctChannelsCurrentlyInUse.size;
    
    return {
      isAtLimit: potentialChannelCount > maxAllowed,
      currentCount,
      maxAllowed,
      potentialCount: potentialChannelCount,
      remaining: Math.max(0, maxAllowed - currentCount)
    };
  } catch (error) {
    console.error('Error checking channel limit:', error);
    return { isAtLimit: false, currentCount: 0, maxAllowed: getMaxChannelsAllowed(), remaining: getMaxChannelsAllowed() };
  }
}

module.exports = { 
  checkRepositoryLimit, 
  checkChannelLimit, 
  getMaxReposAllowed, 
  getMaxChannelsAllowed 
}; 