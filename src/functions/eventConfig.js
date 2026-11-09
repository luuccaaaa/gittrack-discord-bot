// Merge `patch` into a repository event's config, creating the mapping if missing.
// Returns false if the repository does not belong to the guild.
async function patchEventConfig(prisma, guildId, repositoryId, eventType, patch) {
  const repo = await prisma.repository.findFirst({ where: { id: repositoryId, server: { guildId } } });
  if (!repo) { return false; }
  const existing = await prisma.repositoryEventChannel.findFirst({ where: { repositoryId, eventType } });
  if (existing) {
    await prisma.repositoryEventChannel.update({ where: { id: existing.id }, data: { config: { ...(existing.config || {}), ...patch } } });
  } else {
    await prisma.repositoryEventChannel.create({ data: { repositoryId, eventType, channelId: 'default', config: { explicitChannel: false, ...patch } } });
  }
  return true;
}

module.exports = { patchEventConfig };
