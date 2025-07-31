const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-default-channel')
    .setDescription('Set or change the default notification channel for a repository')
    .addStringOption(option =>
      option.setName('repository')
        .setDescription('The GitHub repository URL or name')
        .setRequired(true)
        .setAutocomplete(true))
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel where GitHub notifications for this repository will be sent')
        .setRequired(true)),
        
  async autocomplete(interaction, prisma) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const guildId = interaction.guildId;
    
    try {
      // Fetch repositories for this guild
      const server = await prisma.server.findUnique({
        where: { guildId },
        include: { repositories: true }
      });
      
      if (!server || !server.repositories || server.repositories.length === 0) {
        return interaction.respond([
          { name: 'No repositories found. Use /setup to add one.', value: 'no-repos' }
        ]);
      }
      
      // Filter repositories based on input
      const filtered = server.repositories
        .filter(repo => repo.url.toLowerCase().includes(focusedValue))
        .map(repo => {
          // Extract repo name from URL for display
          const urlParts = repo.url.split('/');
          const repoName = urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2] || repo.url;
          return {
            name: `${repoName} (${repo.url})`,
            value: repo.id
          };
        })
        .slice(0, 25); // Discord only allows 25 choices
      
      await interaction.respond(filtered.length > 0 ? filtered : [
        { name: 'No matching repositories found', value: 'no-match' }
      ]);
    } catch (error) {
      console.error('Error during repository autocomplete:', error);
      await interaction.respond([
        { name: 'Error fetching repositories', value: 'error' }
      ]);
    }
  },
        
  async execute(interaction, prisma) {
    await interaction.deferReply({ ephemeral: true });

    const repositoryId = interaction.options.getString('repository');
    const channel = interaction.options.getChannel('channel');
    const guildId = interaction.guildId;

    if (!channel.isTextBased()) {
      await interaction.editReply('The selected channel must be a text-based channel.');
      return;
    }
    
    if (repositoryId === 'no-repos' || repositoryId === 'no-match' || repositoryId === 'error') {
      await interaction.editReply('Please set up a repository first using the /setup command.');
      return;
    }

    try {
      // Find the repository
      const repository = await prisma.repository.findFirst({
        where: { 
          id: repositoryId,
          server: { guildId }
        }
      });
      
      if (!repository) {
        await interaction.editReply('Repository not found. Please use the autocomplete to select a valid repository.');
        return;
      }
      
      // Update the repository notification channel
      await prisma.repository.update({
        where: { id: repository.id },
        data: { notificationChannelId: channel.id }
      });

      await interaction.editReply(
        `Default notification channel for repository \`${repository.url}\` has been set to ${channel}. This channel will be used for all repository-wide GitHub notifications.`
      );
    } catch (error) {
      console.error('Error setting repository default channel:', error);
      await interaction.editReply(`Failed to set repository notification channel. Error: ${error.message}`);
    }
  },
};
