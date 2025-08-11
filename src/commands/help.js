const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Shows all available commands and their usage.'),
  
  async execute(interaction, prisma) {
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('🤖 GitTrack Bot Commands')
      .setDescription('Here are all the available commands:')
      .addFields(
        {
          name: '📋 **Setup Commands**',
          value: 
            '• `/setup` - Configure a GitHub repository for webhook integration\n' +
            '• `/link` - Link a repository to a specific branch and channel\n' +
            '• `/unlink` - Remove a linked repository from your server',
          inline: false
        },
        {
          name: '📊 **Information Commands**',
          value: 
            '• `/status` - Check your server\'s current configuration and limits\n' +
            '• `/ping` - Check if the bot is responsive',
          inline: false
        },
        {
          name: '🔧 **Management Commands**',
          value: 
            '• `/remove-repo` - Remove a repository from tracking\n' +
            '• `/set-default-channel` - Set the default notification channel\n' +
            '• `/set-event-channel` - Route a specific event (e.g., issues, release) to a channel\n' +
            '• `/edit-event` - Configure filters for a routed event (e.g., only issues opened, no comments)\n' +
            '• `/remove-event-channel` - Remove a specific event route from a repository\n' +
            '• `/reset` - Reset all bot data for this server (Admin only)',
          inline: false
        },
        {
          name: '❓ **Support Commands**',
          value: 
            '• `/help` - Show this help message',
          inline: false
        }
      )
      .setFooter({ 
        text: 'GitTrack • GitHub Integration for Discord', 
        iconURL: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png' 
      })
      .setTimestamp();

    const components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('GitHub Repo')
          .setStyle(ButtonStyle.Link)
          .setURL('https://github.com/luuccaaaa/gittrack-discord-bot')
      )
    ];

    await interaction.reply({ embeds: [embed], components, ephemeral: true });
  },
};
