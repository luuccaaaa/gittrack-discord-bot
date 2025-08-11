const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// Event types eligible for per-event routing (non-branch specific)
const ROUTABLE_EVENTS = [
  { name: 'issues', value: 'issues' },
  { name: 'release', value: 'release' },
  { name: 'star', value: 'star' },
  { name: 'fork', value: 'fork' },
  { name: 'create', value: 'create' },
  { name: 'delete', value: 'delete' },
  { name: 'pull_request', value: 'pull_request' },
  { name: 'milestone', value: 'milestone' },
  { name: 'ping', value: 'ping' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-event-channel')
    .setDescription('Route a specific GitHub event (non-branch) to a channel for a repository')
    .addStringOption(option =>
      option.setName('repository')
        .setDescription('The GitHub repository')
        .setRequired(true)
        .setAutocomplete(true))
    .addStringOption(option => {
      let builder = option
        .setName('event')
        .setDescription('GitHub event to route (non-branch)')
        .setRequired(true);
      // Add choices for better UX
      ROUTABLE_EVENTS.forEach(ev => { builder = builder.addChoices({ name: ev.name, value: ev.value }); });
      return builder;
    })
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel to send this event to')
        .addChannelTypes(0) // GuildText only
        .setRequired(true)
    ),

  async autocomplete(interaction, prisma) {
    const focusedValue = interaction.options.getFocused()?.toLowerCase?.() || '';
    const guildId = interaction.guildId;

    try {
      const server = await prisma.server.findUnique({
        where: { guildId },
        include: { repositories: true }
      });

      if (!server || !server.repositories || server.repositories.length === 0) {
        return interaction.respond([
          { name: 'No repositories found. Use /setup to add one.', value: 'no-repos' }
        ]);
      }

      const filtered = server.repositories
        .filter(repo => repo.url.toLowerCase().includes(focusedValue))
        .map(repo => {
          const urlParts = repo.url.split('/');
          const repoName = urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2] || repo.url;
          return { name: `${repoName} (${repo.url})`, value: repo.id };
        })
        .slice(0, 25);

      await interaction.respond(filtered.length > 0 ? filtered : [
        { name: 'No matching repositories found', value: 'no-match' }
      ]);
    } catch (error) {
      console.error('Autocomplete error in set-event-channel:', error);
      await interaction.respond([
        { name: 'Error fetching repositories', value: 'error' }
      ]);
    }
  },

  async execute(interaction, prisma) {
    await interaction.deferReply({ ephemeral: true });

    const repositoryId = interaction.options.getString('repository');
    const eventType = interaction.options.getString('event');
    const channel = interaction.options.getChannel('channel');
    const guildId = interaction.guildId;

    if (!channel || !channel.isTextBased()) {
      await interaction.editReply('The selected channel must be a text-based channel.');
      return;
    }

    if (repositoryId === 'no-repos' || repositoryId === 'no-match' || repositoryId === 'error') {
      await interaction.editReply('Please set up a repository first using the /setup command.');
      return;
    }

    if (!ROUTABLE_EVENTS.find(e => e.value === eventType)) {
      await interaction.editReply('Invalid event type. Choose one of the provided events.');
      return;
    }

    try {
      const repository = await prisma.repository.findFirst({
        where: {
          id: repositoryId,
          server: { guildId }
        },
        include: { server: true }
      });

      if (!repository) {
        await interaction.editReply('Repository not found. Please use the autocomplete to select a valid repository.');
        return;
      }

      // Upsert mapping
      const existing = await prisma.repositoryEventChannel.findFirst({
        where: { repositoryId: repository.id, eventType }
      });

      let statusText = 'Created';
      if (existing) {
        await prisma.repositoryEventChannel.update({
          where: { id: existing.id },
          data: { channelId: channel.id }
        });
        statusText = 'Updated';
      } else {
        await prisma.repositoryEventChannel.create({
          data: {
            repositoryId: repository.id,
            eventType,
            channelId: channel.id
          }
        });
      }

      // Nicely formatted embedded response
      const displayUrl = repository.url.endsWith('.git') ? repository.url.slice(0, -4) : repository.url;
      const formattedEvent = eventType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      const embed = new EmbedBuilder()
        .setColor(0x3B82F6)
        .setTitle('Event Routing Saved')
        .setDescription('GitHub event routing has been configured for this repository:')
        .addFields(
          { name: 'Repository', value: displayUrl, inline: false },
          { name: 'Event', value: `\`${formattedEvent}\``, inline: true },
          { name: 'Channel', value: `<#${channel.id}>`, inline: true },
          { name: 'Status', value: statusText, inline: true }
        )
        .setFooter({ text: 'Use /status to view all event routes and branch links.' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error setting event channel:', error);
      const embed = new EmbedBuilder()
        .setColor(0xEF4444)
        .setTitle('Failed to Set Event Channel')
        .setDescription('An error occurred while saving the event routing configuration:')
        .addFields(
          { name: 'Error', value: `\`${error.message}\`` }
        )
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    }
  }
};


