const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

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

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
