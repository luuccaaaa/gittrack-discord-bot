const MAX_DESC = 4096;

// Split text into <= MAX_DESC chunks, preferring newline boundaries.
function splitText(text) {
  const chunks = [];
  let rest = text;
  while (rest.length > MAX_DESC) {
    let cut = rest.lastIndexOf('\n', MAX_DESC);
    if (cut < MAX_DESC / 2) { cut = MAX_DESC; }
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  chunks.push(rest);
  return chunks;
}

/**
 * Send an embed, adding the event's configured role pings (config.pingRoleIds; pass no config to skip the ping)
 * and continuing over extra messages if the description exceeds Discord's limit.
 * Returns the first message sent.
 */
async function sendNotification(channel, embed, config) {
  const guildRoles = channel.guild && channel.guild.roles && channel.guild.roles.cache;
  const roleIds = ((config && Array.isArray(config.pingRoleIds)) ? config.pingRoleIds : [])
    .filter(id => !guildRoles || guildRoles.has(id)); // skip roles deleted since they were set
  const opts = roleIds.length
    ? { content: roleIds.map(id => `<@&${id}>`).join(' '), allowedMentions: { roles: roleIds } }
    : {};
  const chunks = embed.description ? splitText(embed.description) : [];
  if (chunks.length <= 1) { return channel.send({ ...opts, embeds: [embed] }); }

  const first = await channel.send({ ...opts, embeds: [{ ...embed, description: chunks[0] }] });
  for (const chunk of chunks.slice(1)) {
    await channel.send({ embeds: [{ color: embed.color, description: chunk }] });
  }
  return first;
}

module.exports = { sendNotification, splitText };
