const { SlashCommandBuilder } = require('discord.js');
const { describeBranchPattern } = require('../functions/branchMatcher');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('Unlinks a specific branch from a repository for a channel.')
    .addStringOption(option =>
      option.setName('url')
        .setDescription('Select a repository from the dropdown list')
        .setRequired(true)
        .setAutocomplete(true))
    .addStringOption(option =>
      option.setName('branch')
        .setDescription('Select the branch pattern to unlink (e.g., main, features/*, * for all)')
        .setRequired(true)
        .setAutocomplete(true))
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel to unlink notifications from (optional)')
        .setRequired(false)),
  async execute(interaction, prisma) {
    await interaction.deferReply({ ephemeral: true });

    const repoUrl = interaction.options.getString('url');
    const branchName = interaction.options.getString('branch');
    const channel = interaction.options.getChannel('channel');
    const channelId = channel ? channel.id : null;
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

      // Build the filter for the tracked branch
      const filter = {
        repositoryId: repository.id,
      };
      
      // If branch is *, we want to remove all branch configurations
      // Otherwise, only remove the specific branch
      if (branchName !== '*') {
        filter.branchName = branchName;
      }
      
      // Add channelId to filter if specified
      if (channelId) {
        filter.channelId = channelId;
      }

      // Delete the specified tracked branch(es)
      const deleteResult = await prisma.trackedBranch.deleteMany({
        where: filter
      });

      if (deleteResult.count === 0) {
        const embed = {
          color: 0xFF9800, // Warning orange
          title: '⚠️ Nothing to Unlink',
          description: `No tracking configurations found to remove for repository **${standardizedUrl.split('/').slice(-2).join('/')}**.`,
          fields: [
            {
              name: '🔍 Searched For',
              value: branchName === '*' ? 'All branches' : `Branch \`${branchName}\``,
              inline: true
            },
            {
              name: '📍 In Channel',
              value: channelId ? `<#${channelId}>` : 'All channels',
              inline: true
            },
            {
              name: '💡 Tip',
              value: 'Use `/status` to see current tracking configurations.',
              inline: false
            }
          ],
          footer: { text: 'GitTrack - Nothing Found' },
          timestamp: new Date().toISOString()
        };
        
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const branchDescription = describeBranchPattern(branchName);
      
      const embed = {
        color: 0x28A745, // Success green
        title: '🔗 Successfully Unlinked',
        description: `Tracking configurations have been removed for repository **${standardizedUrl.split('/').slice(-2).join('/')}**.`,
        fields: [
          {
            name: '📦 Repository',
            value: `[${standardizedUrl.split('/').slice(-2).join('/')}](${standardizedUrl})`,
            inline: true
          },
          {
            name: '🌿 Branch Pattern',
            value: `\`${branchName}\` - ${branchDescription}`,
            inline: true
          },
          {
            name: '📍 Removed From',
            value: channelId ? `<#${channelId}>` : 'All channels',
            inline: true
          },
          {
            name: '🧹 Cleanup',
            value: `${deleteResult.count} tracking configuration(s) removed`,
            inline: true
          }
        ],
        footer: { text: 'GitTrack - Branch Unlinked' },
        timestamp: new Date().toISOString()
      };

      if (deleteResult.count > 0) {
        embed.fields.push({
          name: '⚠️ Note',
          value: 'Webhook notifications for these branches will no longer be sent to the specified channel(s).',
          inline: false
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error unlinking branch:', error);
      await interaction.editReply(`Failed to unlink branch. Error: ${error.message}`);
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
    } else if (focusedOption.name === 'branch') {
      // Get the repository URL from the interaction options
      const repoUrl = interaction.options.getString('url');
      if (!repoUrl) {
        // Return default branches if URL isn't provided yet
        return interaction.respond([
          { name: '* (All branches)', value: '*' },
          { name: 'main', value: 'main' },
          { name: 'master', value: 'master' },
          { name: 'develop', value: 'develop' },
          { name: 'features/* (All feature branches)', value: 'features/*' },
          { name: 'hotfix/* (All hotfix branches)', value: 'hotfix/*' },
        ]);
      }

      try {
        // Create alternative URLs to handle .git suffix differences
        const possibleUrls = [repoUrl];
        if (repoUrl.endsWith('.git')) {
          possibleUrls.push(repoUrl.slice(0, -4)); // Remove .git
        } else {
          possibleUrls.push(repoUrl + '.git'); // Add .git
        }

        // Find the repository
        const repository = await prisma.repository.findFirst({
          where: {
            url: { in: possibleUrls },
            server: { guildId: guildId }
          },
          include: {
            trackedBranches: true
          }
        });

        if (repository && repository.trackedBranches.length > 0) {
          // Get the unique branch names from trackedBranches
          const branchNames = [...new Set(repository.trackedBranches.map(branch => branch.branchName))];
          
          // Add the "all branches" option at the beginning
          const allOptions = [{ name: '* (All branches)', value: '*' }];
          
          // Filter branches based on user's input
          const filtered = branchNames
            .filter(branch => branch.toLowerCase().includes(focusedOption.value.toLowerCase()))
            .slice(0, 24); // Discord allows max 25 choices, we reserve one for * option
          
          // If no branches were found but we have a user input, include it as an option
          if (filtered.length === 0 && focusedOption.value.trim() !== '' && focusedOption.value !== '*') {
            filtered.push(focusedOption.value.trim());
          }
          
          // Combine all options
          const finalOptions = '*'.includes(focusedOption.value.toLowerCase()) ? 
            allOptions.concat(filtered) : 
            filtered.length > 0 ? allOptions.concat(filtered) : allOptions;
          
          await interaction.respond(
            finalOptions.map(branch => {
              if (typeof branch === 'string') {
                return { name: branch, value: branch };
              }
              return branch;
            })
          );
        } else {
          // Default options if repository or branches not found
          await interaction.respond([
            { name: '* (All branches)', value: '*' },
            { name: 'main', value: 'main' },
            { name: 'master', value: 'master' },
            { name: 'develop', value: 'develop' },
          ]);
        }
      } catch (error) {
        // Log concise error message instead of full error stack
        console.info('Branch autocomplete failed: Unable to fetch tracked branches');
        
        // Add the user's typed value as an option even on error
        const options = [
          { name: '* (All branches)', value: '*' },
          { name: 'main', value: 'main' },
          { name: 'master', value: 'master' },
          { name: 'develop', value: 'develop' },
          { name: 'features/* (All feature branches)', value: 'features/*' },
          { name: 'hotfix/* (All hotfix branches)', value: 'hotfix/*' },
        ];
        
        // If user has typed something, add it as the first option
        if (focusedOption.value.trim() !== '') {
          options.unshift({ 
            name: `${focusedOption.value} (custom)`, 
            value: focusedOption.value.trim() 
          });
        }
        
        await interaction.respond(options);
      }
    }
  }
};
