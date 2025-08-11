const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// Supported non-branch events (should mirror routing-capable events)
const ROUTABLE_EVENTS = [
  'issues',
  'release',
  'star',
  'fork',
  'create',
  'delete',
  'pull_request',
  'milestone',
  'ping',
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove-event-channel')
    .setDescription('Remove a configured event-to-channel route for a repository')
    .addStringOption(option =>
      option.setName('repository')
        .setDescription('The GitHub repository')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName('event')
        .setDescription('GitHub event to remove routing for')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction, prisma) {
    try {
      const focused = interaction.options.getFocused(true); // { name, value }
      const guildId = interaction.guildId;

      if (focused.name === 'repository') {
        const focusedValue = focused.value?.toLowerCase?.() || '';
        const server = await prisma.server.findUnique({
          where: { guildId },
          include: { repositories: true }
        });

        if (!server || !server.repositories || server.repositories.length === 0) {
          return interaction.respond([
            { name: 'No repositories found. Use /setup to add one.', value: 'no-repos' }
          ]);
        }

        const choices = server.repositories
          .filter(r => r.url.toLowerCase().includes(focusedValue))
          .map(repo => {
            const parts = repo.url.split('/');
            const name = parts[parts.length - 1] || parts[parts.length - 2] || repo.url;
            return { name: `${name} (${repo.url})`, value: repo.id };
          })
          .slice(0, 25);
        return interaction.respond(choices.length ? choices : [{ name: 'No matching repositories found', value: 'no-match' }]);
      }

      if (focused.name === 'event') {
        // Suggest only currently mapped events for the selected repository
        const repositoryId = interaction.options.getString('repository');
        if (!repositoryId || ['no-repos', 'no-match', 'error'].includes(repositoryId)) {
          return interaction.respond([{ name: 'Select a repository first', value: 'no-repo-selected' }]);
        }
        const mappings = await prisma.repositoryEventChannel.findMany({
          where: { repositoryId }
        });
        const available = mappings.map(m => m.eventType).filter((v, i, arr) => arr.indexOf(v) === i);
        const filtered = available
          .filter(ev => ev.toLowerCase().includes((focused.value || '').toLowerCase()))
          .slice(0, 25)
          .map(ev => ({ name: ev, value: ev }));
        if (filtered.length > 0) return interaction.respond(filtered);

        // Fallback: show routable events to guide user
        return interaction.respond(ROUTABLE_EVENTS.map(ev => ({ name: ev, value: ev })).slice(0, 25));
      }

      return interaction.respond([]);
    } catch (error) {
      console.error('Autocomplete error in remove-event-channel:', error);
      try {
        return interaction.respond([{ name: 'Error loading autocomplete', value: 'error' }]);
      } catch {}
    }
  },

  async execute(interaction, prisma) {
    await interaction.deferReply({ ephemeral: true });

    const repositoryId = interaction.options.getString('repository');
    const eventType = interaction.options.getString('event');
    const guildId = interaction.guildId;

    if (!repositoryId || ['no-repos', 'no-match', 'error', 'no-repo-selected'].includes(repositoryId)) {
      await interaction.editReply('Please select a valid repository.');
      return;
    }

    if (!eventType || !ROUTABLE_EVENTS.includes(eventType)) {
      await interaction.editReply('Please select a valid event to remove.');
      return;
    }

    try {
      const repository = await prisma.repository.findFirst({
        where: { id: repositoryId, server: { guildId } }
      });
      if (!repository) {
        await interaction.editReply('Repository not found.');
        return;
      }

      let existing = await prisma.repositoryEventChannel.findFirst({
        where: { repositoryId: repository.id, eventType }
      });
      // Legacy support: if user tries to remove issue_comment, remove issues mapping
      if (!existing && eventType === 'issue_comment') {
        existing = await prisma.repositoryEventChannel.findFirst({
          where: { repositoryId: repository.id, eventType: 'issues' }
        });
      }

      if (!existing) {
       const embed = new EmbedBuilder()
          .setColor(0xF59E0B)
          .setTitle('No Event Route Found')
          .setDescription('There is no event-specific routing configured for this selection.')
          .addFields(
            { name: 'Repository', value: repository.url, inline: false },
            { name: 'Event', value: `\`${eventType === 'issue_comment' ? 'issues (comments)' : eventType}\``, inline: true }
          )
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      await prisma.repositoryEventChannel.delete({ where: { id: existing.id } });

      const displayUrl = repository.url.endsWith('.git') ? repository.url.slice(0, -4) : repository.url;
      const formattedEvent = eventType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const embed = new EmbedBuilder()
        .setColor(0x10B981)
        .setTitle('Event Routing Removed')
        .setDescription('The event-to-channel route has been removed:')
        .addFields(
          { name: 'Repository', value: displayUrl, inline: false },
          { name: 'Event', value: `\`${formattedEvent}\``, inline: true }
        )
        .setFooter({ text: 'Use /status to confirm current routes.' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error removing event channel:', error);
      const embed = new EmbedBuilder()
        .setColor(0xEF4444)
        .setTitle('Failed to Remove Event Route')
        .setDescription('An error occurred while removing the event routing configuration:')
        .addFields({ name: 'Error', value: `\`${error.message}\`` })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    }
  }
};


