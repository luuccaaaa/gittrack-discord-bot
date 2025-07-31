const djs = require('discord.js'); // Import the whole module
const { SlashCommandBuilder } = require('discord.js');
const { checkRepositoryLimit, checkChannelLimit } = require('../functions/limitChecker');

// Helper function to extract owner and repo from GitHub URL
function extractOwnerAndRepo(url) {
  try {
    const parsedUrl = new URL(url);
    const pathParts = parsedUrl.pathname.split('/').filter(part => part.length > 0);
    if (pathParts.length >= 2) {
      return {
        owner: pathParts[0],
        repo: pathParts[1].replace('.git', '')
      };
    }
  } catch (error) {
    console.error('Error extracting owner and repo:', error);
  }
  return null;
}

// Helper function to fetch branches from GitHub API
async function fetchBranches(repoUrl) {
  try {
    const { owner, repo } = extractOwnerAndRepo(repoUrl);
    if (!owner || !repo) return [];

    const githubToken = process.env.GITHUB_TOKEN;
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'GitTrack-Bot'
    };

    if (githubToken) {
      headers['Authorization'] = `token ${githubToken}`;
    }

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches`, { headers });
    
    if (!response.ok) {
      console.log(`GitHub API error: ${response.status} - ${response.statusText}`);
      return [];
    }

    const branches = await response.json();
    return branches.map(branch => branch.name);
  } catch (error) {
    console.error('Error fetching branches:', error);
    return [];
  }
}

// Helper function to validate branch pattern
function isValidBranchPattern(pattern) {
  // Allow alphanumeric, hyphens, underscores, dots, slashes, and asterisks
  const validPattern = /^[a-zA-Z0-9\-_.\/*]+$/;
  return validPattern.test(pattern);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link a GitHub repository to a specific branch and channel for notifications')
    .addStringOption(option =>
      option.setName('url')
        .setDescription('The HTTPS URL or name of the GitHub repository')
        .setRequired(true)
        .setAutocomplete(true)) // Enabled autocomplete for URL
    .addStringOption(option =>
      option.setName('branch')
        .setDescription('The branch to track (e.g., main, features/*, hotfix/*) or * for all branches')
        .setRequired(true)
        .setAutocomplete(true))
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel where notifications for this repository will be sent.')
        .addChannelTypes(0) // GuildText only
        .setRequired(true)),
        
  async execute(interaction, prisma) {
    await interaction.deferReply({ ephemeral: true });

    const repoUrl = interaction.options.getString('url');
    const branchName = interaction.options.getString('branch');
    const notificationChannel = interaction.options.getChannel('channel');
    const guildId = interaction.guildId;
    const guildName = interaction.guild.name;

    // Basic URL validation
    try {
      const parsedUrl = new URL(repoUrl);
      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        await interaction.editReply('Invalid repository URL. Please use an HTTP or HTTPS URL.');
        return;
      }
      // Check for GitHub URL
      if (!parsedUrl.hostname.includes('github.com')) {
        await interaction.editReply('Please provide a valid GitHub repository URL.');
        return;
      }
    } catch (error) {
      await interaction.editReply('Invalid repository URL format. Please provide a valid URL.');
      return;
    }

    if (!notificationChannel.isTextBased()) {
        await interaction.editReply('The selected channel must be a text-based channel.');
        return;
    }

    // Validate branch pattern
    if (!isValidBranchPattern(branchName)) {
      await interaction.editReply(
        'Invalid branch pattern. Valid patterns include:\n' +
        '• `*` - Track all branches\n' +
        '• `main` - Track a specific branch\n' +
        '• `features/*` - Track all branches starting with "features/"\n' +
        '• `hotfix/*` - Track all branches starting with "hotfix/"\n\n' +
        'Branch names can only contain letters, numbers, hyphens, underscores, dots, and slashes.'
      );
      return;
    }

    try {
      // Create alternative URLs to handle .git suffix differences
      const possibleUrls = [repoUrl];
      if (repoUrl.endsWith('.git')) {
        possibleUrls.push(repoUrl.slice(0, -4)); // Remove .git
      } else {
        possibleUrls.push(repoUrl + '.git'); // Add .git
      }
      
      // Standardize URL format for display - we'll use URLs without the .git suffix
      const standardizedUrl = repoUrl.endsWith('.git') ? repoUrl.slice(0, -4) : repoUrl;

      // Update server notification channel
      const server = await prisma.server.upsert({
        where: { guildId: guildId },
        update: { 
          name: guildName,
        },
        create: { 
          guildId: guildId, 
          name: guildName,
        }
      });

      // Find if repository exists
      const repository = await prisma.repository.findFirst({
        where: {
          server: { guildId },
          url: { in: possibleUrls }
        }
      });

      if (!repository) {
        // Check repository limits for new repository
        const repoLimit = await checkRepositoryLimit(prisma, server.id);
        
        if (repoLimit.isAtLimit) {
          await interaction.editReply(
            `You've reached the maximum number of repositories (${repoLimit.maxAllowed}) allowed on this server. ` +
            `Please remove an existing repository with \`/remove-repo\` before setting up a new one.`
          );
          return;
        }
        
        await interaction.editReply(
          `Repository not found. Please run \`/setup ${standardizedUrl}\` first to configure the webhook.`
        );
        return;
      }

      // --- CHANNEL LIMIT LOGIC START ---
      const targetChannelForThisLink = notificationChannel.id;

      // First, check if this channel is already being explicitly used (already in the database)
      const isChannelAlreadyUsed = await prisma.trackedBranch.findFirst({
        where: {
          repository: { serverId: server.id },
          channelId: targetChannelForThisLink
        }
      });
      
      // Get existing channels in use for user-friendly error message
      const trackedBranchesForServer = await prisma.trackedBranch.findMany({
        where: { repository: { serverId: server.id } },
        select: { channelId: true },
        distinct: ['channelId']
      });
      
      const distinctChannelsInUse = new Set(
        trackedBranchesForServer
          .filter(tb => tb.channelId)
          .map(tb => tb.channelId)
      );
      
      // Check if this channel is already being used for branch tracking
      const isChannelAlreadyTracking = distinctChannelsInUse.has(targetChannelForThisLink);
      
      // Only check with the includeNewChannelId parameter if this is a new channel
      // If the channel is already in use for branch tracking, we don't need to include it again
      const channelLimit = await checkChannelLimit(
        prisma, 
        server.id,
        null, // Don't exclude any channels
        isChannelAlreadyTracking ? null : targetChannelForThisLink // Only include if it's a new channel
      );
      
      // If adding this channel would exceed the limit
      if (channelLimit.isAtLimit && !isChannelAlreadyTracking) {
        // Create a better list of available channels for the user to choose from
        const availableChannels = Array.from(distinctChannelsInUse)
          .map(ch => `<#${ch}>`)
          .filter(ch => ch !== `<#${targetChannelForThisLink}>`); // Remove target channel from suggestions
        
        let defaultChannelMention = '';
        
        await interaction.editReply(
          `The server allows branch notifications to be sent to a maximum of ${channelLimit.maxAllowed} distinct channels. ` +
          `This server is already using ${channelLimit.currentCount}/${channelLimit.maxAllowed} channels for branch notifications${availableChannels.length > 0 ? ': ' + availableChannels.join(', ') : ''}. ` +
          `${defaultChannelMention}` +
          `\n\nYou can either use one of these existing channels or contact an administrator to increase the limit.`
        );
        return;
      }
      // --- CHANNEL LIMIT LOGIC END ---

      // If adding the wildcard (*) for all branches, first remove any specific branches for this channel
      if (branchName === '*') {
        // Check if wildcard already exists
        const existingWildcard = await prisma.trackedBranch.findFirst({
          where: {
            repositoryId: repository.id,
            branchName: '*',
            channelId: notificationChannel.id
          }
        });

        if (existingWildcard) {
          await interaction.editReply(
            `All branches are already being tracked for repository <${standardizedUrl}> in channel ${notificationChannel}.`
          );
          return;
        }

        // Remove any specific branches tracked in this channel
        const deletedBranches = await prisma.trackedBranch.deleteMany({
          where: {
            repositoryId: repository.id,
            channelId: notificationChannel.id,
            branchName: { not: '*' }
          }
        });

        if (deletedBranches.count > 0) {
          await interaction.editReply(
            `Removed ${deletedBranches.count} specific branch tracking rules and now tracking all branches for repository <${standardizedUrl}> in channel ${notificationChannel}.`
          );
          return;
        }
      } else {
        // Check if this specific branch is already being tracked in this channel
        const existingBranch = await prisma.trackedBranch.findFirst({
          where: {
            repositoryId: repository.id,
            branchName: branchName,
            channelId: notificationChannel.id
          }
        });

        if (existingBranch) {
          await interaction.editReply(
            `Branch \`${branchName}\` is already being tracked for repository <${standardizedUrl}> in channel ${notificationChannel}.`
          );
          return;
        }

        // Remove wildcard if it exists for this channel
        await prisma.trackedBranch.deleteMany({
          where: {
            repositoryId: repository.id,
            channelId: notificationChannel.id,
            branchName: '*'
          }
        });
      }

      // Create the new tracked branch
      await prisma.trackedBranch.create({
        data: {
          branchName: branchName,
          channelId: notificationChannel.id,
          repositoryId: repository.id
        }
      });

      // Success message
      const branchDisplay = branchName === '*' ? 'all branches' : `branch \`${branchName}\``;
      await interaction.editReply(
        `✅ Successfully linked ${branchDisplay} from repository <${standardizedUrl}> to channel ${notificationChannel}.\n\n` +
        `You will now receive notifications for this branch in the specified channel.`
      );

    } catch (error) {
      console.error('Error in link command:', error);
      await interaction.editReply('An error occurred while linking the repository. Please try again.');
    }
  },

  async autocomplete(interaction, prisma) {
    const focusedOption = interaction.options.getFocused(true);
    
    if (focusedOption.name === 'url') {
      try {
        const guildId = interaction.guildId;
        
        // Get repositories for this server
        const repositories = await prisma.repository.findMany({
          where: { server: { guildId } },
          select: { url: true }
        });

        const choices = repositories.map(repo => ({
          name: repo.url.split('/').slice(-2).join('/'),
          value: repo.url
        }));

        await interaction.respond(choices.slice(0, 25));
      } catch (error) {
        console.error('Autocomplete error for URL:', error);
        await interaction.respond([]);
      }
    } else if (focusedOption.name === 'branch') {
      try {
        const urlOption = interaction.options.getString('url');
        if (!urlOption) {
          await interaction.respond([]);
          return;
        }

        const branches = await fetchBranches(urlOption);
        
        // Add common patterns
        const choices = [
          { name: 'All branches (*)', value: '*' },
          ...branches.map(branch => ({
            name: branch,
            value: branch
          }))
        ];

        await interaction.respond(choices.slice(0, 25));
      } catch (error) {
        console.error('Autocomplete error for branch:', error);
        await interaction.respond([]);
      }
    }
  }
};
