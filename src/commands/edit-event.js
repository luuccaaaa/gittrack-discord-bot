const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Supported routable non-branch events and their common actions
const ROUTABLE_EVENTS = [
  { name: 'issues', value: 'issues' },
  { name: 'pull_request', value: 'pull_request' },
  { name: 'release', value: 'release' },
  { name: 'star', value: 'star' },
  { name: 'fork', value: 'fork' },
  { name: 'create', value: 'create' },
  { name: 'delete', value: 'delete' },
  { name: 'milestone', value: 'milestone' },
  { name: 'ping', value: 'ping' },
];

// Minimal action presets per event (extendable)
const EVENT_ACTION_PRESETS = {
  issues: ['opened', 'closed', 'reopened', 'edited', 'labeled', 'assigned', 'comments'],
  pull_request: ['opened', 'closed', 'reopened', 'comments'],
  release: ['published'],
  star: ['created', 'deleted'],
  fork: ['created'],
  create: ['created'],
  delete: ['deleted'],
  milestone: ['created', 'closed', 'opened'],
  ping: ['ping']
};

function formatRepoUrlForDisplay(url) {
  return url && url.endsWith('.git') ? url.slice(0, -4) : url;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('edit-event')
    .setDescription('Configure filters for a non-branch GitHub event on a repository')
    .addStringOption(option =>
      option.setName('repository')
        .setDescription('The GitHub repository')
        .setRequired(true)
        .setAutocomplete(true))
    .addStringOption(option => {
      let builder = option
        .setName('event')
        .setDescription('GitHub event to configure (non-branch)')
        .setRequired(true);
      ROUTABLE_EVENTS.forEach(ev => { builder = builder.addChoices({ name: ev.name, value: ev.value }); });
      return builder;
    }),

  async autocomplete(interaction, prisma) {
    const focusedValue = interaction.options.getFocused()?.toLowerCase?.() || '';
    const guildId = interaction.guildId;

    try {
      const server = await prisma.server.findUnique({
        where: { guildId },
        include: { repositories: true }
      });

      if (!server || !server.repositories?.length) {
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

      await interaction.respond(filtered.length ? filtered : [{ name: 'No matching repositories found', value: 'no-match' }]);
    } catch (error) {
      console.error('Autocomplete error in edit-event:', error);
      await interaction.respond([{ name: 'Error fetching repositories', value: 'error' }]);
    }
  },

  async execute(interaction, prisma) {
    await interaction.deferReply({ ephemeral: true });

    const repositoryId = interaction.options.getString('repository');
    const eventType = interaction.options.getString('event');
    const guildId = interaction.guildId;

    if (repositoryId === 'no-repos' || repositoryId === 'no-match' || repositoryId === 'error') {
      await interaction.editReply('Please set up a repository first using the /setup command.');
      return;
    }

    try {
      const repository = await prisma.repository.findFirst({
        where: { id: repositoryId, server: { guildId } },
        include: { server: true }
      });

      if (!repository) {
        await interaction.editReply('Repository not found. Please use the autocomplete to select a valid repository.');
        return;
      }

      const mapping = await prisma.repositoryEventChannel.findFirst({
        where: { repositoryId: repository.id, eventType }
      });

      const displayUrl = formatRepoUrlForDisplay(repository.url);
      const supportedActions = EVENT_ACTION_PRESETS[eventType] || [];
      const currentConfig = (mapping && mapping.config) || {};
      const actionsEnabled = currentConfig.actionsEnabled || supportedActions.reduce((acc, action) => {
        acc[action] = action === 'comments' ? false : true;
        return acc;
      }, {});

      const embed = new EmbedBuilder()
        .setColor(0x3B82F6)
        .setTitle('Edit Event Filters')
        .setDescription('Toggle which actions for this event should trigger notifications:')
        .addFields(
          { name: 'Repository', value: displayUrl, inline: false },
          { name: 'Event', value: `\`${eventType}\``, inline: true },
          { name: 'Channel', value: mapping ? `<#${mapping.channelId}>` : (repository.notificationChannelId ? `<#${repository.notificationChannelId}> (default)` : 'Not set (default channel pending)'), inline: true }
        )
        .setFooter({ text: 'Changes are saved immediately when you toggle buttons.' })
        .setTimestamp();

      const buildRows = () => {
        const rows = [];
        let row = new ActionRowBuilder();
        let count = 0;
        for (const action of supportedActions) {
          const enabled = Boolean(actionsEnabled[action]);
          const btn = new ButtonBuilder()
            .setCustomId(`edit_evt:${repository.id}:${eventType}:${action}`)
            .setLabel(`${action}`)
            .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary);
          if (count === 5) { // discord max 5 buttons per row
            rows.push(row);
            row = new ActionRowBuilder();
            count = 0;
          }
          row.addComponents(btn);
          count += 1;
        }
        if (count > 0) rows.push(row);
        // Add a close row
        rows.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`edit_evt_close:${repository.id}:${eventType}`).setLabel('Close').setStyle(ButtonStyle.Danger)
        ));
        return rows;
      };

      const message = await interaction.editReply({ embeds: [embed], components: buildRows() });

      const collector = message.createMessageComponentCollector({ time: 60_000 });

      collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
          await i.reply({ content: 'Only the command user can change these settings.', ephemeral: true });
          return;
        }

        // Close button
        if (i.customId.startsWith('edit_evt_close:')) {
          collector.stop('closed');
          await i.update({ components: [] });
          return;
        }

        const parts = i.customId.split(':');
        if (parts.length !== 4 || parts[0] !== 'edit_evt') {
          await i.deferUpdate();
          return;
        }
        const [, repoId, evtType, action] = parts;
        if (repoId !== repository.id || evtType !== eventType) {
          await i.deferUpdate();
          return;
        }

        const enabledNow = !Boolean(actionsEnabled[action]);
        actionsEnabled[action] = enabledNow;

        // Persist immediately (upsert mapping if missing, using fallback/default channel)
        if (mapping) {
          await prisma.repositoryEventChannel.update({
            where: { id: mapping.id },
            data: { config: { actionsEnabled } }
          });
        } else {
          await prisma.repositoryEventChannel.create({
            data: {
              repositoryId: repository.id,
              eventType,
              channelId: repository.notificationChannelId || 'pending',
              config: { actionsEnabled }
            }
          });
        }

        // Re-render buttons
        await i.update({ components: buildRows() });
      });

      collector.on('end', async () => {
        try {
          await interaction.editReply({ components: [] });
        } catch {}
      });
    } catch (error) {
      console.error('Error in /edit-event:', error);
      const embed = new EmbedBuilder()
        .setColor(0xEF4444)
        .setTitle('Failed to open editor')
        .setDescription(`An error occurred: \`${error.message}\``);
      await interaction.editReply({ embeds: [embed], components: [] });
    }
  }
};


