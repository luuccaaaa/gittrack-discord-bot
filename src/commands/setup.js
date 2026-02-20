const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { checkRepositoryLimit } = require('../functions/limitChecker');
const crypto = require('crypto');

// Helper function to generate a random webhook secret
function generateWebhookSecret(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure a GitHub repository for webhook integration')
    .addStringOption(option =>
      option.setName('repository')
        .setDescription('The URL of the GitHub repository to set up')
        .setRequired(true))
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The default channel for repository notifications (optional - defaults to current channel)')
        .addChannelTypes(0) // GuildText only
        .setRequired(false)),
  
  async execute(interaction, prisma) {
    await interaction.deferReply({ ephemeral: true });

    const repoUrl = interaction.options.getString('repository');
    const setupChannel = interaction.options.getChannel('channel');
    const guildId = interaction.guildId;
    const guildName = interaction.guild.name;
    
    // Use the channel where the command was called from if no channel is specified
    const notificationChannel = setupChannel || interaction.channel;

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
      
      // Extract path parts for validation
      const pathParts = parsedUrl.pathname.split('/').filter(part => part.length > 0);
      if (pathParts.length < 2) {
        await interaction.editReply('Invalid GitHub URL. Please provide a complete repository URL (e.g., https://github.com/username/repository)');
        return;
      }
      
      // Check for .git suffix
      if (parsedUrl.pathname.endsWith('.git')) {
        await interaction.editReply('Please provide the repository URL without the .git suffix (e.g., https://github.com/username/repository)');
        return;
      }

      // Check for common invalid patterns
      if (pathParts[0].toLowerCase() === 'organizations' || 
          pathParts[0].toLowerCase() === 'orgs' ||
          pathParts[0].toLowerCase() === 'users' ||
          pathParts[0].toLowerCase() === 'settings' ||
          pathParts[0].toLowerCase() === 'explore' ||
          pathParts[0].toLowerCase() === 'trending') {
        await interaction.editReply('Invalid GitHub URL. Please provide a direct repository URL (e.g., https://github.com/username/repository)');
        return;
      }

    } catch (error) {
      await interaction.editReply('Invalid repository URL format. Please provide a valid URL.');
      return;
    }

    try {
      // Create alternative URLs to handle .git suffix differences
      let tempUrl = repoUrl;
      if (tempUrl.endsWith('.git')) {
        tempUrl = tempUrl.slice(0, -4);
      }
      if (tempUrl.endsWith('/')) {
        tempUrl = tempUrl.slice(0, -1);
      }
      const standardizedUrl = tempUrl;

      const possibleUrls = [standardizedUrl, `${standardizedUrl}.git`];
      // Add variants with and without trailing slash for matching existing entries if any
      if (!possibleUrls.includes(`${standardizedUrl}/`)) possibleUrls.push(`${standardizedUrl}/`);
      if (!possibleUrls.includes(`${standardizedUrl}.git/`)) possibleUrls.push(`${standardizedUrl}.git/`);
      

      // Ensure the server (guild) exists in the database
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

      // Check repository limits
      const repoLimit = await checkRepositoryLimit(prisma, server.id);

      // Check if repository already exists for this server
      let existingRepository = await prisma.repository.findFirst({
        where: {
          server: { guildId },
          url: { in: possibleUrls }
        }
      });

      // Generate a new webhook secret
      const webhookSecret = generateWebhookSecret();

      if (existingRepository) {
        // Update existing repository with new webhook secret and notification channel
        const updateData = { 
          webhookSecret
        };
        
        // Always update notificationChannelId to the channel where command was called or specified
        updateData.notificationChannelId = notificationChannel.id;
        
        await prisma.repository.update({
          where: { id: existingRepository.id },
          data: updateData
        });
      } else {
        // Check limit before creating a new repository
        if (repoLimit.isAtLimit) {
          await interaction.editReply({
            content: `You have reached the maximum of ${repoLimit.maxAllowed} repositories allowed on this server.`,
            ephemeral: true
          });
          return;
        }

        // Create new repository
        const repositoryData = {
          url: standardizedUrl,
          webhookSecret,
          server: {
            connect: { id: server.id }
          }
        };
        
        // Always set notificationChannelId to the channel where command was called or specified
        repositoryData.notificationChannelId = notificationChannel.id;
        
        await prisma.repository.create({
          data: repositoryData
        });
      }

      // Get the webhook URL from environment variable
      const webhookBaseUrl = process.env.WEBHOOK_URL || `${process.env.PUBLIC_URL}/github-webhook`;
      
      // Create an embed with setup instructions
      const embed = new EmbedBuilder()
        .setColor(0x28a745) // GitHub green
        .setTitle('🔗 GitHub Webhook Setup')
        .setDescription(`**Repository configured successfully!**\n\`${standardizedUrl}\`\n\nNow complete the webhook setup on GitHub:`)
        .addFields(
          { 
            name: '📋 **Quick Setup Steps**', 
            value: 
              '**1.** Go to your repository settings\n' +
              `**2.** Navigate to [**Webhooks**](${standardizedUrl}/settings/hooks) → **Add webhook**\n` +
              '**3.** Configure the webhook with details below\n' +
              '**4.** Test and save your configuration',
            inline: false 
          },
          { 
            name: '🌐 **Payload URL**', 
            value: `\`\`\`\n${webhookBaseUrl}\n\`\`\``, 
            inline: false 
          },
          { 
            name: '🔐 **Secret**', 
            value: `\`\`\`\n${webhookSecret}\n\`\`\``, 
            inline: false 
          },
          { 
            name: '⚙️ **Configuration**', 
            value: 
              '• **Content type:** `application/json` ⚠️ **IMPORTANT**\n' +
              '• **Events:** "Send me everything" (recommended)\n' +
              '• **Active:** ✅ Checked',
            inline: false 
          },
          { 
            name: '📢 **Default Channel**', 
            value: setupChannel ? 
              `General notifications will be sent to ${setupChannel} (specified)` : 
              `General notifications will be sent to ${notificationChannel} (current channel)`, 
            inline: true 
          },
          { 
            name: '🎯 **Next Steps**', 
            value: 'Use `/link` to track specific branches!', 
            inline: true 
          },
          {
            name: '📊 **Repository Usage**',
            value: `${repoLimit.currentCount}/${repoLimit.maxAllowed} repositories`,
            inline: true
          }
        )
        .setFooter({ 
          text: 'GitTrack • GitHub Integration', 
          iconURL: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png' 
        })
        .setTimestamp();

      await interaction.editReply({ 
        embeds: [embed] 
      });

    } catch (error) {
      console.error('Setup command error:', error);
      await interaction.editReply(`Failed to configure repository. Error: ${error.message}`);
    }
  },
};
