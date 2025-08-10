const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { describeBranchPattern } = require('../functions/branchMatcher');
const { checkRepositoryLimit, checkChannelLimit, getMaxReposAllowed, getMaxChannelsAllowed } = require('../functions/limitChecker');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Shows repo status, configurations, and server limits.'), // Shortened description
  async execute(interaction, prisma) {
    await interaction.deferReply({ ephemeral: true }); // Changed to ephemeral for privacy

    const guildId = interaction.guildId;

    try {
      const server = await prisma.server.findUnique({
        where: { guildId: guildId },
        include: {
          repositories: {
            include: {
              trackedBranches: true,
              eventChannels: true
            }
          }
        }
      });

      if (!server) { // Simplified check, as repo check is done later
        await interaction.editReply('This server has not been set up with GitTrack yet. Use `/setup` to begin.');
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`GitTrack Status for ${interaction.guild.name}`)
        .setColor(0x0099ff)
        .setTimestamp();

      const repoCount = server.repositories.length;
      const maxReposAllowed = getMaxReposAllowed();
      const maxChannelsAllowed = getMaxChannelsAllowed();

      // Get repository and channel limits
      const repoLimit = await checkRepositoryLimit(prisma, server.id);
      const channelLimit = await checkChannelLimit(prisma, server.id);

      // Get all tracked branches for server
      const allTrackedBranchesForServer = await prisma.trackedBranch.findMany({
        where: { repository: { serverId: server.id } },
        select: { channelId: true },
      });
      
      // Create a map of all channels used for branch notifications
      const allUsedChannels = new Map(); // Maps channelId -> { count: number, isRepoDefault: boolean, isUsedExplicitly: boolean }
      
      // First, mark repository default channels
      const repoNotificationChannels = new Set();
      for (const repo of server.repositories) {
        if (repo.notificationChannelId) {
          repoNotificationChannels.add(repo.notificationChannelId);
          // Initialize the channel in our map as a repo default, but not explicitly used yet
          allUsedChannels.set(repo.notificationChannelId, {
            count: 0,
            isRepoDefault: true,
            isUsedExplicitly: false
          });
        }
      }
      
      // Then count all channels used across all tracked branches
      for (const repo of server.repositories) {
        for (const branch of repo.trackedBranches) {
          if (branch.channelId) {
            if (!allUsedChannels.has(branch.channelId)) {
              // This is a new channel, not a repo default
              allUsedChannels.set(branch.channelId, {
                count: 1,
                isRepoDefault: repoNotificationChannels.has(branch.channelId),
                isUsedExplicitly: true
              });
            } else {
              // This channel already exists in our map
              const info = allUsedChannels.get(branch.channelId);
              info.count++;
              info.isUsedExplicitly = true; // Mark as explicitly used for a branch
              allUsedChannels.set(branch.channelId, info);
            }
          }
        }
      }
      
      // Count channels that are explicitly used for branch notifications
      // We'll now count repo defaults if they are ALSO used explicitly for branch tracking
      const distinctChannelsInUse = new Set();
      
      // Debug logging
      console.log("All channel usage:");
      for (const [channelId, info] of allUsedChannels.entries()) {
        console.log(`Channel ${channelId}: count=${info.count}, isRepoDefault=${info.isRepoDefault}, isUsedExplicitly=${info.isUsedExplicitly}`);
        
        // Count all channels that are explicitly used for branch notifications
        // Even if they're also repository defaults
        if (info.isUsedExplicitly) {
          distinctChannelsInUse.add(channelId);
        }
      }
      
      console.log(`Repo default channels: ${Array.from(repoNotificationChannels).join(', ')}`);
      console.log(`Distinct branch-specific channels: ${Array.from(distinctChannelsInUse).join(', ')}`);
      console.log(`Total distinct channels used for branch tracking: ${distinctChannelsInUse.size}`);

      // Format channel limit text
      let maxChannelsAllowedText = "Unlimited distinct branch notification channels";
      if (maxChannelsAllowed !== Infinity) {
        maxChannelsAllowedText = `Up to ${maxChannelsAllowed} distinct branch notification channels`;
      }

      embed.addFields(
        { name: 'Linked Repositories', value: `${repoCount} / ${maxReposAllowed}`, inline: true },
        { name: 'Notification Channel Limit', value: maxChannelsAllowedText, inline: true},
        { name: 'Branch Notification Channels Used', value: `${distinctChannelsInUse.size}`, inline: true }
      );

      // Add repository usage info
      if (repoLimit.isAtLimit) {
        embed.addFields({ 
          name: 'Repository Limit Reached', 
          value: `You have reached the maximum of ${maxReposAllowed} repositories. Consider self-hosting GitTrack for unlimited repositories.`, 
          inline: false 
        });
      } else {
        embed.addFields({ 
          name: 'Repository Usage', 
          value: `You can add ${repoLimit.remaining} more repositories to this server.`, 
          inline: false 
        });
      }

      // Add channel usage info if there's a limit
      if (maxChannelsAllowed !== Infinity) {
        if (channelLimit.isAtLimit) {
          embed.addFields({ 
            name: 'Channel Limit Reached', 
            value: `You have reached the maximum of ${maxChannelsAllowed} notification channels.`, 
            inline: false 
          });
        } else {
          embed.addFields({ 
            name: 'Channel Usage', 
            value: `You can add ${channelLimit.remaining} more notification channels.`, 
            inline: false 
          });
        }
      }
      
      embed.addFields({ name: '\u200B', value: '**Repository Details**' }); // Separator

      // Original repository status logic starts here
      if (server.repositories.length === 0) {
        embed.addFields({ name: 'Repositories', value: 'No repositories have been linked to this server yet. Use `/setup` to configure a repository first, then `/link` to track branches.'});
      } else {
        for (const repo of server.repositories) {
          // Group branches by channel for cleaner display
          const branchesByChannel = {};
          // Use repository's notification channel as default
          const defaultChannel = repo.notificationChannelId;
          
          // Initialize with default channel if it exists
          if (defaultChannel) {
            branchesByChannel[defaultChannel] = new Set();
          }
          
          for (const branch of repo.trackedBranches) {
            const channelId = branch.channelId || defaultChannel;
            if (!branchesByChannel[channelId]) {
              branchesByChannel[channelId] = new Set();
            }
            branchesByChannel[channelId].add(branch.branchName);
          }

          // Create branch list per channel
          let branchDisplay = '';
          for (const [channelId, branchSet] of Object.entries(branchesByChannel)) {
            if (branchSet.size > 0) {
              // Convert set to array, sort with "*" always first
              const branches = Array.from(branchSet).sort((a, b) => {
                if (a === '*') return -1;
                if (b === '*') return 1;
                return a.localeCompare(b);
              });
              
              const branchList = branches.map(b => `\`${b}\``).join(', ');
              branchDisplay += `**<#${channelId}>**: ${branchList}\n`;
            }
          }
          
          if (branchDisplay === '') {
            branchDisplay = 'No branches configured';
          }

          // Build event routing details (only show explicitly mapped events)
          let eventRoutingDisplay = 'No event-specific routing configured';
          if (repo.eventChannels && repo.eventChannels.length > 0) {
            const byChannel = new Map(); // channelId -> [eventType]
            for (const ec of repo.eventChannels) {
              if (!byChannel.has(ec.channelId)) byChannel.set(ec.channelId, []);
              byChannel.get(ec.channelId).push(ec.eventType);
            }
            const lines = [];
            for (const [channelId, events] of byChannel.entries()) {
              const sorted = events.sort();
              lines.push(`**<#${channelId}>**: ${sorted.map(e => `\`${e}\``).join(', ')}`);
            }
            eventRoutingDisplay = lines.join('\n');
          }

          // Check webhook status
          const webhookStatus = repo.webhookSecret 
            ? '✅ Webhook configured' 
            : '❌ Webhook not configured (use `/setup` command)';
            
          // Format the URL for display - remove .git suffix for consistency
          const displayUrl = repo.url.endsWith('.git') 
            ? repo.url.slice(0, -4) 
            : repo.url;

          embed.addFields({
            name: displayUrl,
            value: `**Webhook Status**: ${webhookStatus}\n**Tracked Branches by Channel**:\n${branchDisplay}\n**Event Routing**:\n${eventRoutingDisplay}`,
            inline: false
          });
        }
      }

      // Add tips footer
      embed.setFooter({ 
        text: 'To configure repositories, use the /link and /setup commands. Use "*" to track all branches.' 
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error getting repository status:', error);
      await interaction.editReply('Failed to retrieve repository status. An error occurred.');
    }
  },
};
