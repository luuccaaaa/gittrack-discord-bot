const { ChannelType, PermissionFlagsBits } = require('discord.js');

/**
 * Checks if a user has any of the following:
 * - Administrator permission (always grants access)
 * - Manage Webhooks permission
 * 
 * @param {import('discord.js').CommandInteraction} interaction The Discord interaction
 * @returns {Boolean} True if the user has the required permissions
 */
function checkPermissions(interaction) {
  // Check if the user is an administrator (always gets access)
  if (interaction.member.permissions.has('Administrator')) {
    return true;
  }
  
  // Check if the user has Manage Webhooks permission
  if (interaction.member.permissions.has('ManageWebhooks')) {
    return true;
  }
  
  return false;
}

// Permissions the bot needs in a channel to deliver notification embeds
const REQUIRED_CHANNEL_PERMISSIONS = [
  { flag: PermissionFlagsBits.ViewChannel, name: 'View Channel' },
  { flag: PermissionFlagsBits.SendMessages, name: 'Send Messages' },
  { flag: PermissionFlagsBits.EmbedLinks, name: 'Embed Links' },
];

/**
 * Checks whether the bot itself can deliver notifications to the given channel.
 *
 * @param {import('discord.js').GuildBasedChannel} channel The target notification channel
 * @param {import('discord.js').Guild} guild The guild the channel belongs to
 * @returns {String|null} A user-facing warning listing the missing permissions, or null if none are missing
 */
function getChannelPermissionWarning(channel, guild) {
  const me = guild?.members?.me;
  if (!me || typeof channel?.permissionsFor !== 'function') {
    return null;
  }

  const perms = channel.permissionsFor(me);
  const missing = REQUIRED_CHANNEL_PERMISSIONS.filter(p => !perms || !perms.has(p.flag));
  if (missing.length === 0) {
    return null;
  }

  const missingNames = missing.map(p => `**${p.name}**`).join(', ');
  const announcementNote = channel.type === ChannelType.GuildAnnouncement
    ? ' Note: announcement channels deny posting to everyone by default.'
    : '';
  return (
    `⚠️ I'm missing ${missingNames} in ${channel}, so notifications cannot be delivered there. ` +
    `Grant these permissions to my role in that channel's settings (Edit Channel → Permissions).` +
    announcementNote
  );
}

module.exports = { checkPermissions, getChannelPermissionWarning };
