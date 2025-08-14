const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { checkPermissions } = require('../functions/permissionChecker');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Reset the bot for this server by removing all repository configurations.')
    .addBooleanOption(option =>
      option.setName('confirm')
        .setDescription('Confirm that you want to reset the bot for this server (this is required)')
        .setRequired(true)),
  
  async execute(interaction, prisma) {
    // Check if the user has the required permissions (Admin or Manage Webhooks permission)
    if (!checkPermissions(interaction)) {
      await interaction.reply({
        content: "❌ You need the `Manage Webhooks` permission to use this command.",
        ephemeral: true
      });
      return;
    }

    const isConfirmed = interaction.options.getBoolean('confirm');
    
    if (!isConfirmed) {
      await interaction.reply({
        content: "❌ You must confirm the reset action by setting the 'confirm' option to true.",
        ephemeral: true
      });
      return;
    }

    // Create a confirmation button
    const confirmButton = new ButtonBuilder()
      .setCustomId('confirm_reset')
      .setLabel('Yes, reset everything')
      .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
      .setCustomId('cancel_reset')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder()
      .addComponents(confirmButton, cancelButton);

    const embed = new EmbedBuilder()
      .setTitle('⚠️ Warning: Bot Reset')
      .setColor(0xFF0000)
      .setDescription(`**This action will delete ALL repository configurations for this server (${interaction.guild.name}).**\n\n` +
                     'All tracked repositories, branches, and webhook configurations for this server will be permanently removed.\n\n' +
                     'Other servers using GitTrack will not be affected.\n\n' +
                     'Are you absolutely sure you want to continue?')
      .setFooter({ text: 'This action cannot be undone!' });

    const response = await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true
    });

    // Create a collector for the button interaction
    const collector = response.createMessageComponentCollector({ 
      time: 15_000 // 15 seconds
    });

    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) {
        await i.reply({ content: 'Only the command user can confirm this action.', ephemeral: true });
        return;
      }

      // Handle the buttons
      if (i.customId === 'confirm_reset') {
        await i.update({ 
          content: 'Processing reset...',
          embeds: [],
          components: []
        });

        try {
          // Get the current server (guild) to update its notification channel
          const server = await prisma.server.findUnique({
            where: { guildId: interaction.guildId }
          });

          let deletionStats = {};

          // First delete all tracked branches
          const deletedBranches = await prisma.trackedBranch.deleteMany({
            where: {
              repository: {
                server: {
                  guildId: interaction.guildId
                }
              }
            }
          });
          deletionStats.branches = deletedBranches.count;

          // Then delete all repository event channel mappings for this guild
          const deletedEventChannels = await prisma.repositoryEventChannel.deleteMany({
            where: {
              repository: {
                server: {
                  guildId: interaction.guildId
                }
              }
            }
          });
          deletionStats.eventChannels = deletedEventChannels.count;

          // Then delete all repositories for this guild
          const deletedRepos = await prisma.repository.deleteMany({
            where: {
              server: {
                guildId: interaction.guildId
              }
            }
          });
          deletionStats.repositories = deletedRepos.count;

          // Create a results embed
          const resultsEmbed = new EmbedBuilder()
            .setTitle('Bot Reset Complete')
            .setColor(0x00FF00)
            .setDescription(`The bot has been successfully reset for this server.`)
            .addFields(
              { name: 'Repositories Removed', value: `${deletionStats.repositories}`, inline: true },
              { name: 'Branch Configurations Removed', value: `${deletionStats.branches}`, inline: true },
              { name: 'Event Channel Mappings Removed', value: `${deletionStats.eventChannels}` , inline: true }
            )
            .setFooter({ text: `Reset performed by ${interaction.user.tag}` })
            .setTimestamp();

          await i.editReply({
            content: '',
            embeds: [resultsEmbed],
            components: []
          });
        } catch (error) {
          console.error('Error resetting bot:', error);
          await i.editReply({
            content: `❌ An error occurred while resetting the bot: ${error.message}`,
            embeds: [],
            components: []
          });
        }
      } else if (i.customId === 'cancel_reset') {
        await i.update({
          content: '✅ Reset cancelled.',
          embeds: [],
          components: []
        });
      }
    });

    collector.on('end', async (collected, reason) => {
      if (reason === 'time' && collected.size === 0) {
        await interaction.editReply({
          content: '⏱️ Confirmation timed out. Reset cancelled.',
          embeds: [],
          components: []
        });
      }
    });
  },
};
