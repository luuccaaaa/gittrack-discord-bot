const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove-repo')
    .setDescription('Completely removes a GitHub repository from this server, including all tracking configurations.')
    .addStringOption(option =>
      option.setName('url')
        .setDescription('Select a repository from the dropdown list')
        .setRequired(true)
        .setAutocomplete(true)), // Enabled autocomplete for URL
  async execute(interaction, prisma) {
    await interaction.deferReply({ ephemeral: true });

    const repoUrl = interaction.options.getString('url');
    const guildId = interaction.guildId;

    try {
      // Create alternative URLs to handle .git suffix differences
      const possibleUrls = [repoUrl];
      if (repoUrl.endsWith('.git')) {
        possibleUrls.push(repoUrl.slice(0, -4)); // Remove .git
      } else {
        possibleUrls.push(repoUrl + '.git'); // Add .git
      }
      
      // Standardize URL format for display
      const standardizedUrl = repoUrl.endsWith('.git') ? repoUrl.slice(0, -4) : repoUrl;

      // Find the repository
      const repository = await prisma.repository.findFirst({
        where: {
          url: { in: possibleUrls },
          server: {
            guildId: guildId
          }
        },
        include: {
          trackedBranches: true
        }
      });

      if (!repository) {
        const embed = {
          color: 0x6C757D, // Gray
          title: '❌ Repository Not Found',
          description: `Repository **${standardizedUrl.split('/').slice(-2).join('/')}** is not linked to this server.`,
          fields: [
            {
              name: '💡 Tip',
              value: 'Use `/status` to see all repositories linked to this server.',
              inline: false
            }
          ],
          footer: { text: 'GitTrack - Repository Not Found' },
          timestamp: new Date().toISOString()
        };
        
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // First delete all tracked branches for this repository
      let trackedBranchCount = 0;
      if (repository.trackedBranches.length > 0) {
        const deleteResult = await prisma.trackedBranch.deleteMany({
          where: {
            repositoryId: repository.id
          }
        });
        trackedBranchCount = deleteResult.count;
      }

      // Then delete event channel mappings for this repository
      const deletedEventChannels = await prisma.repositoryEventChannel.deleteMany({
        where: {
          repositoryId: repository.id
        }
      });

      // Then delete the repository itself
      await prisma.repository.delete({
        where: {
          id: repository.id
        }
      });

      const embed = {
        color: 0xDC3545, // Danger red
        title: '🗑️ Repository Removed Successfully',
        description: `Repository **${standardizedUrl.split('/').slice(-2).join('/')}** has been completely removed from this server.`,
        fields: [
          {
            name: '📦 Repository',
            value: `[${standardizedUrl.split('/').slice(-2).join('/')}](${standardizedUrl})`,
            inline: true
          },
          {
            name: '🧹 Cleanup',
            value: `${trackedBranchCount} branch tracking configuration(s) removed, ${deletedEventChannels.count} event mapping(s) removed`,
            inline: true
          }
        ],
        footer: { text: 'GitTrack - Repository Removed' },
        timestamp: new Date().toISOString()
      };

      if (trackedBranchCount > 0) {
        embed.fields.push({
          name: '⚠️ Important',
          value: 'All webhook notifications for this repository have been disabled on this server.',
          inline: false
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error removing repository:', error);
      await interaction.editReply(`Failed to remove repository. Error: ${error.message}`);
    }
  },

  async autocomplete(interaction, prisma) {
    const focusedOption = interaction.options.getFocused(true);
    const guildId = interaction.guildId;

    if (focusedOption.name === 'url') {
      try {
        const repositories = await prisma.repository.findMany({
          where: { server: { guildId: guildId } },
          select: { url: true } // Select only the URL
        });

        const choices = repositories.map(repo => {
          // Extract a more readable name, e.g., owner/repo
          const nameParts = repo.url.replace(/^https?:\/\//, '').split('/');
          // Format as owner/repo and remove .git suffix if present
          let displayName = nameParts.length > 1 ? 
              `${nameParts[nameParts.length - 2]}/${nameParts[nameParts.length - 1].replace(/\.git$/, '')}` : 
              repo.url.replace(/\.git$/, '');
          
          return { name: displayName, value: repo.url };
        });

        const filtered = choices.filter(choice => 
          choice.name.toLowerCase().includes(focusedOption.value.toLowerCase()) ||
          choice.value.toLowerCase().includes(focusedOption.value.toLowerCase())
        ).slice(0, 25);

        await interaction.respond(filtered);
      } catch (error) {
        // Log concise error message instead of full error stack
        console.info('Repository autocomplete failed: Unable to fetch repositories');
        await interaction.respond([]);
      }
    }
  }
};
