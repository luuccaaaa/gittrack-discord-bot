// Per-event settings live in RepositoryEventChannel.config (JSON). Every writer goes through
// patchEventConfig so concurrent or stale writers can't overwrite each other's keys.

// Saves for the same repository + event run one at a time. The bot runs as a single process,
// so this serializes every config write (webhook routing only reads, apart from creating a
// missing default mapping).
const locks = new Map();

async function withLock(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  const tail = previous.then(() => current);
  locks.set(key, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === tail) { locks.delete(key); }
  }
}

// Shallow merge, except actionsEnabled which is merged per action.
function mergeConfig(current, patch) {
  const merged = { ...current, ...patch };
  if (patch.actionsEnabled) {
    merged.actionsEnabled = { ...(current.actionsEnabled || {}), ...patch.actionsEnabled };
  }
  return merged;
}

/**
 * Merge a change into the latest saved config of a repository event, creating the mapping if
 * missing. Only the keys in `patch` change (per action for actionsEnabled).
 * `options.channelId` also sets the mapping's channel.
 * Returns the saved config, or false if the repository does not belong to the guild.
 */
async function patchEventConfig(prisma, guildId, repositoryId, eventType, patch, options = {}) {
  const repo = await prisma.repository.findFirst({ where: { id: repositoryId, server: { guildId } } });
  if (!repo) { return false; }

  return withLock(`${repositoryId}:${eventType}`, async () => {
    const existing = await prisma.repositoryEventChannel.findFirst({ where: { repositoryId, eventType } });
    const current = (existing && existing.config) || { explicitChannel: false };
    const config = mergeConfig(current, patch);
    const channelData = options.channelId ? { channelId: options.channelId } : {};

    if (existing) {
      await prisma.repositoryEventChannel.update({ where: { id: existing.id }, data: { config, ...channelData } });
    } else {
      await prisma.repositoryEventChannel.create({ data: { repositoryId, eventType, channelId: 'default', config, ...channelData } });
    }
    return config;
  });
}

module.exports = { patchEventConfig, mergeConfig };
