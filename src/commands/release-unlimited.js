const { SlashCommandBuilder } = require('discord.js');
const { repoAutocomplete, patchEventConfig } = require('../functions/repoAutocomplete');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('release-unlimited')
    .setDescription('Show full release notes with no length limit (long notes continue in extra messages)')
    .addStringOption(o => o.setName('repository').setDescription('The GitHub repository').setRequired(true).setAutocomplete(true))
    .addBooleanOption(o => o.setName('enabled').setDescription('true = no limit, false = default 1500 character limit').setRequired(true)),

  autocomplete: repoAutocomplete,

  async execute(interaction, prisma) {
    await interaction.deferReply({ ephemeral: true });
    const repositoryId = interaction.options.getString('repository');
    const enabled = interaction.options.getBoolean('enabled');
    try {
      const ok = await patchEventConfig(prisma, interaction.guildId, repositoryId, 'release', { noLimit: enabled });
      await interaction.editReply(ok
        ? `Release notes length limit ${enabled ? 'removed' : 'restored (1500 characters)'} for this repository.`
        : 'Repository not found. Use the autocomplete to select one.');
    } catch (error) {
      console.error('Error in /release-unlimited:', error);
      await interaction.editReply(`Failed: \`${error.message}\``);
    }
  }
};
