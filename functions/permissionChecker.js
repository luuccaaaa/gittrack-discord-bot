
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

module.exports = { checkPermissions };
