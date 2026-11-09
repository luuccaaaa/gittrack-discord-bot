const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, RoleSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const { patchEventConfig } = require('../functions/eventConfig');

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
  { name: 'workflow_run', value: 'workflow_run' },
  { name: 'workflow_job', value: 'workflow_job' },
  { name: 'check_run', value: 'check_run' },
  { name: 'check_suite', value: 'check_suite' },
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
  workflow_run: ['completed', 'requested'],
  workflow_job: ['queued', 'in_progress', 'completed', 'waiting'],
  check_run: ['created', 'requested', 'rerequested', 'completed'],
  check_suite: ['requested', 'rerequested', 'completed'],
};

const MAX_PING_ROLES = 5;

function formatRepoUrlForDisplay(url) {
  return url && url.endsWith('.git') ? url.slice(0, -4) : url;
}

// A role ping only notifies if the role is mentionable or the bot has Mention Everyone.
function pingRoleWarning(roles, guild) {
  const me = guild && guild.members && guild.members.me;
  if (me && me.permissions && me.permissions.has(PermissionFlagsBits.MentionEveryone)) { return null; }
  const silent = roles.filter(role => role && !role.mentionable);
  if (!silent.length) { return null; }
  const list = silent.map(role => `<@&${role.id}>`).join(', ');
  return `Saved, but ${list} ${silent.length === 1 ? 'isn\'t' : 'aren\'t'} mentionable, so ${silent.length === 1 ? 'it' : 'they'} won't be notified. ` +
    'Make the role mentionable (Server Settings → Roles) or give the bot the **Mention Everyone** permission.';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('edit-event')
    .setDescription('Configure filters, role ping and options for a non-branch GitHub event')
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

      let mapping = await prisma.repositoryEventChannel.findFirst({
        where: { repositoryId: repository.id, eventType }
      });

      // If mapping doesn't exist yet, create one upfront with defaults so the first interaction works
      if (!mapping) {
        const supportedActions = EVENT_ACTION_PRESETS[eventType] || [];
        const defaultActions = supportedActions.reduce((acc, action) => {
          acc[action] = action === 'comments' ? false : true;
          return acc;
        }, {});
        mapping = await prisma.repositoryEventChannel.create({
          data: {
            repositoryId: repository.id,
            eventType,
            channelId: 'default',
            config: { actionsEnabled: defaultActions, explicitChannel: false }
          }
        });
      }

      const displayUrl = formatRepoUrlForDisplay(repository.url);
      const supportedActions = EVENT_ACTION_PRESETS[eventType] || [];
      // Local copy of the stored config; every change is saved with patchEventConfig so other keys are kept.
      const config = { ...((mapping && mapping.config) || {}) };
      const actionsEnabled = config.actionsEnabled || supportedActions.reduce((acc, action) => {
        acc[action] = action === 'comments' ? false : true;
        return acc;
      }, {});
      config.actionsEnabled = actionsEnabled;
      const pingRoleIds = () => (Array.isArray(config.pingRoleIds) ? config.pingRoleIds : []);
      const channelDisplay = (mapping && mapping.channelId && mapping.channelId !== 'default')
        ? `<#${mapping.channelId}>`
        : (repository.notificationChannelId ? `<#${repository.notificationChannelId}> (default)` : 'Not set (default channel pending)');

      const buildEmbed = () => {
        const embed = new EmbedBuilder()
          .setColor(0x3B82F6)
          .setTitle('Edit Event Settings')
          .setDescription(`Toggle which actions trigger notifications, and pick up to ${MAX_PING_ROLES} roles to ping when one is posted:`)
          .addFields(
            { name: 'Repository', value: displayUrl, inline: false },
            { name: 'Event', value: `\`${eventType}\``, inline: true },
            { name: 'Channel', value: channelDisplay, inline: true },
            { name: 'Ping roles', value: pingRoleIds().length ? pingRoleIds().map(id => `<@&${id}>`).join(' ') : 'None', inline: true }
          );
        const pingsAlsoFor = { issues: 'issue comments', pull_request: 'PR comments, reviews and review comments' }[eventType];
        if (pingsAlsoFor) {
          embed.addFields({ name: 'Note', value: `These roles are also pinged for ${pingsAlsoFor} (when \`comments\` is on).`, inline: false });
        }
        if (eventType === 'release') {
          embed.addFields({ name: 'Release notes', value: config.noLimit ? 'Full (long notes continue in extra messages)' : 'Truncated to 1500 characters', inline: false });
        }
        return embed
          .setFooter({ text: 'Changes are saved immediately.' })
          .setTimestamp();
      };

      // Layout (max 5 rows): action buttons (<= 2 rows), role select, then [release option] [Close].
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
        if (count > 0) {rows.push(row);}

        const roleSelect = new RoleSelectMenuBuilder()
          .setCustomId(`edit_evt_role:${repository.id}:${eventType}`)
          .setPlaceholder('Roles to ping (none)')
          .setMinValues(0)
          .setMaxValues(MAX_PING_ROLES);
        if (pingRoleIds().length) { roleSelect.setDefaultRoles(...pingRoleIds()); }
        rows.push(new ActionRowBuilder().addComponents(roleSelect));

        const lastRow = new ActionRowBuilder();
        if (eventType === 'release') {
          lastRow.addComponents(new ButtonBuilder()
            .setCustomId(`edit_evt_opt:${repository.id}:${eventType}:noLimit`)
            .setLabel(`Full release notes: ${config.noLimit ? 'on' : 'off'}`)
            .setStyle(config.noLimit ? ButtonStyle.Success : ButtonStyle.Secondary));
        }
        lastRow.addComponents(
          new ButtonBuilder().setCustomId(`edit_evt_close:${repository.id}:${eventType}`).setLabel('Close').setStyle(ButtonStyle.Danger)
        );
        rows.push(lastRow);
        return rows;
      };

      const save = async (patch) => {
        Object.assign(config, patch);
        await patchEventConfig(prisma, guildId, repository.id, eventType, patch);
      };

      const message = await interaction.editReply({ embeds: [buildEmbed()], components: buildRows() });

      const collector = message.createMessageComponentCollector({ time: 180_000 });

      collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
          await i.reply({ content: 'Only the command user can change these settings.', ephemeral: true });
          return;
        }

        try {
          // Close button
          if (i.customId.startsWith('edit_evt_close:')) {
            collector.stop('closed');
            await i.update({ components: [] });
            return;
          }

          // Roles to ping (empty selection removes the ping). @everyone is dropped.
          if (i.customId.startsWith('edit_evt_role:')) {
            const selected = i.values || [];
            const roleIds = selected.filter(id => id !== guildId);
            await save({ pingRoleIds: roleIds });
            await i.update({ embeds: [buildEmbed()], components: buildRows() });
            const notes = [];
            if (roleIds.length < selected.length) { notes.push('@everyone can\'t be used as a ping role, so it was left out.'); }
            const warning = pingRoleWarning(roleIds.map(id => i.roles && i.roles.get(id)), interaction.guild);
            if (warning) { notes.push(warning); }
            if (notes.length) { await i.followUp({ content: notes.join('\n'), ephemeral: true }); }
            return;
          }

          // Release: full notes toggle
          if (i.customId.startsWith('edit_evt_opt:') && i.customId.endsWith(':noLimit')) {
            await save({ noLimit: !config.noLimit });
            await i.update({ embeds: [buildEmbed()], components: buildRows() });
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

          actionsEnabled[action] = !actionsEnabled[action];
          await save({ actionsEnabled });

          // Re-render buttons
          await i.update({ components: buildRows() });
        } catch (error) {
          console.error('Error updating /edit-event settings:', error);
          const content = `Failed to save: \`${error.message}\``;
          try {
            if (i.replied || i.deferred) { await i.followUp({ content, ephemeral: true }); } else { await i.reply({ content, ephemeral: true }); }
          } catch { }
        }
      });

      collector.on('end', async () => {
        try {
          await interaction.editReply({ components: [] });
        } catch { }
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


