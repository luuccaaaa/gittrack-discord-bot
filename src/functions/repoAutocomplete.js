// Autocomplete the server's linked repositories (value = repository id).
async function repoAutocomplete(interaction, prisma) {
  const focused = interaction.options.getFocused()?.toLowerCase?.() || '';
  try {
    const server = await prisma.server.findUnique({ where: { guildId: interaction.guildId }, include: { repositories: true } });
    const repos = (server?.repositories || []).filter(r => r.url.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(repos.length
      ? repos.map(r => ({ name: r.url, value: r.id }))
      : [{ name: 'No matching repositories. Use /setup to add one.', value: 'no-match' }]);
  } catch (error) {
    console.error('repoAutocomplete error:', error);
    await interaction.respond([{ name: 'Error fetching repositories', value: 'error' }]);
  }
}

// Merge `patch` into the event's config (creating the mapping if missing). Returns false if repo not found.
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

module.exports = { repoAutocomplete, patchEventConfig };
