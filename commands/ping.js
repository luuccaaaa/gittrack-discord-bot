const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if GitTrack is online and responsive'),
  async execute(interaction) {
    const sent = await interaction.reply({ 
      content: '🏓 Pinging...', 
      fetchReply: true 
    });
    
    const ping = sent.createdTimestamp - interaction.createdTimestamp;
    const apiLatency = Math.round(interaction.client.ws.ping);

    const embed = new EmbedBuilder()
      .setTitle('🏓 Pong!')
      .setColor(ping < 100 ? 0x00ff00 : ping < 200 ? 0xffff00 : 0xff0000)
      .setDescription('GitTrack is online and ready to serve!')
      .addFields(
        { name: '📡 Bot Latency', value: `${ping}ms`, inline: true },
        { name: '🌐 API Latency', value: `${apiLatency}ms`, inline: true },
        { name: '⚡ Status', value: ping < 200 ? '🟢 Excellent' : ping < 500 ? '🟡 Good' : '🔴 Slow', inline: true }
      )
      .setFooter({ text: 'GitTrack • System Status' })
      .setTimestamp();

    await interaction.editReply({ content: '', embeds: [embed] });
  },
};
