const { SlashCommandBuilder } = require('discord.js');
const { repoAutocomplete, patchEventConfig } = require('../functions/repoAutocomplete');

const EVENTS = ['issues', 'pull_request', 'release', 'star', 'fork', 'create', 'delete', 'milestone', 'workflow_run', 'workflow_job', 'check_run', 'check_suite'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-ping-role')
    .setDescription('Ping a role when a type of notification is posted (omit role to remove)')
    .addStringOption(o => o.setName('repository').setDescription('The GitHub repository').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('event').setDescription('Notification type').setRequired(true)
      .addChoices(...EVENTS.map(e => ({ name: e, value: e }))))
    .addRoleOption(o => o.setName('role').setDescription('Role to ping (leave empty to remove the ping)')),

  autocomplete: repoAutocomplete,

  async execute(interaction, prisma) {
    await interaction.deferReply({ ephemeral: true });
    const repositoryId = interaction.options.getString('repository');
    const eventType = interaction.options.getString('event');
    const role = interaction.options.getRole('role');
    try {
      const ok = await patchEventConfig(prisma, interaction.guildId, repositoryId, eventType, { pingRoleId: role ? role.id : null });
      await interaction.editReply(ok
        ? (role ? `<@&${role.id}> will be pinged for \`${eventType}\` notifications.` : `Role ping removed for \`${eventType}\`.`)
        : 'Repository not found. Use the autocomplete to select one.');
    } catch (error) {
      console.error('Error in /set-ping-role:', error);
      await interaction.editReply(`Failed: \`${error.message}\``);
    }
  }
};
