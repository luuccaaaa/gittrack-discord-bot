const {Events, Client, GatewayIntentBits, Partials, Collection, Routes, REST } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

async function initializeBot(prisma) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages
      // Keep minimal intents to avoid permissions issues
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember],
  });

  client.commands = new Collection();
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
    } else {
      console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
  }

  // Listen for the bot joining a new guild and register it in the database
  client.on('guildCreate', async (guild) => {
    console.log(`Joined new guild: ${guild.name} (${guild.id})`);
    try {
      // Create or update the server entry in the database
      await prisma.server.upsert({
        where: { guildId: guild.id },
        update: { 
          name: guild.name,
          status: 'ACTIVE' // Mark as active when bot joins
        },
        create: { 
          guildId: guild.id,
          name: guild.name,
          status: 'ACTIVE' // Mark as active when creating new server
        },
      });
      
      // Try to send a welcome message with role setup instructions to the system channel
      const { EmbedBuilder } = require('discord.js');
      try {
        const systemChannel = guild.systemChannel;
        if (systemChannel && systemChannel.permissionsFor(guild.members.me).has(['SendMessages', 'EmbedLinks'])) {
          const welcomeEmbed = new EmbedBuilder()
            .setTitle('🙌 Thanks for adding GitTrack!')
            .setColor(0x0099ff)
            .setDescription('GitTrack helps you monitor GitHub repositories by sending notifications about new commits, issues, pull requests and more to your Discord channels.')
            .addFields(
              {
                name: '🔐 Setting Up Permissions',
                value: 'To control who can configure GitTrack:\n\n' +
                  '• Users need the **Manage Webhooks** permission to configure GitTrack\n' +
                  '  - This permission can be assigned through server roles\n' +
                  '  - It naturally aligns with GitTrack\'s webhook management functionality\n\n' 
              },
              {
                name: '🚀 Getting Started',
                value: 'Use `/help` to see available commands and setup instructions.'
              }
            )
            .setFooter({ text: 'Type /setup to begin tracking your first repository!' });
          
          await systemChannel.send({ embeds: [welcomeEmbed] });
        }
      } catch (error) {
        console.error('Error sending welcome message:', error);
        // Continue even if welcome message fails
      }
      
      console.log(`Registered new guild in database: ${guild.name} (${guild.id})`);
    } catch (error) {
      console.error(`Error registering new guild ${guild.name} (${guild.id}):`, error);
    }
  });

  // Listen for the bot leaving a guild and mark it as inactive
  client.on('guildDelete', async (guild) => {
    console.log(`Left guild: ${guild.name} (${guild.id})`);
    try {
      // Mark the server as inactive in the database
      await prisma.server.update({
        where: { guildId: guild.id },
        data: { status: 'INACTIVE' }
      });
      
      console.log(`Marked server as inactive: ${guild.name} (${guild.id})`);
    } catch (error) {
      console.error(`Error marking server as inactive ${guild.name} (${guild.id}):`, error);
    }
  });

  client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log(`Bot is in ${client.guilds.cache.size} servers.`);

    // Register all current guilds in the database
    await registerGuildsInDatabase(client.guilds.cache, prisma);

    // Update server status based on bot presence
    await updateServerStatus(client.guilds.cache, prisma);

    // Sum approximate member counts across all guilds
    try {
      const fetchedGuilds = await Promise.all(
        client.guilds.cache.map(async (g) => {
          try {
            return await g.fetch({ withCounts: true });
          } catch (e) {
            console.warn(`Could not fetch counts for guild ${g.id}:`, e.message);
            return g;
          }
        })
      );
      const totalApproxMembers = fetchedGuilds.reduce((sum, g) => {
        const count = typeof g.approximateMemberCount === 'number' ? g.approximateMemberCount : 0;
        return sum + count;
      }, 0);
      console.log(`Approximate total members across guilds: ${totalApproxMembers}`);
    } catch (e) {
      console.error('Failed to sum approximate member counts:', e);
    }

    const clientId = process.env.CLIENT_ID;
    
    if (!clientId) {
      console.error('CLIENT_ID is missing in .env. Slash commands will not be registered.');
      return;
    }

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
      console.log('Started refreshing application (/) commands.');

      // Construct an array of command data for registration
      const commandsToRegister = client.commands.map(cmd => cmd.data.toJSON());

      // Register commands globally
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commandsToRegister },
      );

      console.log('Successfully reloaded application (/) commands globally.');
    } catch (error) {
      console.error('Error reloading application (/) commands:', error);
    }
  });

  const { checkPermissions } = require('./functions/permissionChecker');
  
  client.on('interactionCreate', async interaction => {
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (!command || !command.autocomplete) {return;}

      try {
        await command.autocomplete(interaction, prisma);
      } catch (error) {
        console.error(`Error handling autocomplete for command ${interaction.commandName}:`, error);
      }
      return;
    }
    
    if (!interaction.isCommand()) {return;}

    const command = client.commands.get(interaction.commandName);
    if (!command) {return;}

    // Define commands that don't require permission checks
    const publicCommands = ['help', 'status', 'ping'];
    
    // Special case for reset which requires Administrator permission
    if (interaction.commandName === 'reset') {
      // Let the reset command handle its own permission check
      try {
        await command.execute(interaction, prisma);
      } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
      }
      return;
    }
    
    // Skip permission check for public commands
    if (publicCommands.includes(interaction.commandName)) {
      try {
        await command.execute(interaction, prisma);
      } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
      }
      return;
    }
    
    // For all other commands, check for Manage Webhooks permission
    if (!checkPermissions(interaction)) {
      await interaction.reply({ 
        content: "❌ You need the 'Manage Webhooks' permission to use this command.", 
        ephemeral: true 
      });
      return;
    }

    try {
      await command.execute(interaction, prisma);
    } catch (error) {
      console.error(error);
      await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
  });

  // Log in to Discord with your client's token
  try {
    await client.login(process.env.DISCORD_TOKEN);
    return client;
  } catch (error) {
    console.error('Failed to log in to Discord:', error);
    process.exit(1);
  }
}

// Function to register all guilds in the database
async function registerGuildsInDatabase(guilds, prisma) {
  console.log(`Registering ${guilds.size} guilds in the database...`);
  
  try {
    // Process all guilds in parallel for faster initialization
    await Promise.all(guilds.map(async (guild) => {
      try {
        // Create or update the server entry in the database
        await prisma.server.upsert({
          where: { guildId: guild.id },
          update: { 
            name: guild.name,
            status: 'ACTIVE' // Mark as active since bot is present
          },
          create: { 
            guildId: guild.id,
            name: guild.name,
            status: 'ACTIVE' // Mark as active when creating
          }
        });
        

        
        console.log(`Registered guild: ${guild.name} (${guild.id})`);
      } catch (error) {
        console.error(`Error registering guild ${guild.name} (${guild.id}):`, error);
      }
    }));
    
    console.log('All guilds registered successfully.');
  } catch (error) {
    console.error('Error during guild registration:', error);
  }
}

// Function to update server status based on bot presence
async function updateServerStatus(guilds, prisma) {
  console.log('Updating server status based on bot presence...');
  
  try {
    // Get all servers from database
    const allServers = await prisma.server.findMany({
      select: { id: true, guildId: true, name: true, status: true }
    });
    
    console.log(`Found ${allServers.length} servers in database, bot is active in ${guilds.size} servers.`);
    
    // Create a Set of guild IDs where the bot is currently present
    const activeGuildIds = new Set(guilds.map(guild => guild.id));
    
    // Update server status for all servers
    const updatePromises = allServers.map(async (server) => {
      const isActive = activeGuildIds.has(server.guildId);
      const newStatus = isActive ? 'ACTIVE' : 'INACTIVE';
      
      // Only update if status has changed
      if (server.status !== newStatus) {
        await prisma.server.update({
          where: { id: server.id },
          data: { status: newStatus }
        });
        
        console.log(`Updated server status: ${server.name} (${server.guildId}) -> ${newStatus}`);
      }
    });
    
    await Promise.all(updatePromises);
    
    const activeServers = allServers.filter(server => activeGuildIds.has(server.guildId));
    const inactiveServers = allServers.filter(server => !activeGuildIds.has(server.guildId));
    
    console.log(`Server status update complete:`);
    console.log(`  - Active servers: ${activeServers.length}`);
    console.log(`  - Inactive servers: ${inactiveServers.length}`);
    
    if (inactiveServers.length > 0) {
      console.log('Inactive servers:');
      inactiveServers.forEach(server => {
        console.log(`  - ${server.name} (${server.guildId})`);
      });
    }
    
  } catch (error) {
    console.error('Error updating server status:', error);
  }
}

module.exports = { initializeBot };
