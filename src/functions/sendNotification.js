const MAX_DESC = 4096;

const isHighSurrogate = (code) => code >= 0xD800 && code <= 0xDBFF;

// Split text into <= MAX_DESC chunks, preferring newline boundaries and never
// cutting a character (e.g. an emoji) in half.
function splitText(text) {
  const chunks = [];
  let rest = text;
  while (rest.length > MAX_DESC) {
    let cut = rest.lastIndexOf('\n', MAX_DESC);
    if (cut < MAX_DESC / 2) {
      cut = MAX_DESC;
      if (isHighSurrogate(rest.charCodeAt(cut - 1))) { cut -= 1; }
    }
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  chunks.push(rest);
  return chunks;
}

/**
 * Send an embed, adding the event's configured role pings (config.pingRoleIds; pass no config to skip the ping)
 * and continuing over extra messages if the description exceeds Discord's limit.
 * Returns { message, sentCount }: the first message, and how many messages were actually posted.
 * Throws only if the first message fails; a failed continuation is logged and stops the rest.
 */
async function sendNotification(channel, embed, config) {
  const guildRoles = channel.guild && channel.guild.roles && channel.guild.roles.cache;
  const roleIds = ((config && Array.isArray(config.pingRoleIds)) ? config.pingRoleIds : [])
    .filter(id => !guildRoles || guildRoles.has(id)); // skip roles deleted since they were set
  const opts = roleIds.length
    ? { content: roleIds.map(id => `<@&${id}>`).join(' '), allowedMentions: { roles: roleIds } }
    : {};
  const chunks = embed.description ? splitText(embed.description) : [];
  if (chunks.length <= 1) {
    return { message: await channel.send({ ...opts, embeds: [embed] }), sentCount: 1 };
  }

  const message = await channel.send({ ...opts, embeds: [{ ...embed, description: chunks[0] }] });
  let sentCount = 1;
  for (const chunk of chunks.slice(1)) {
    try {
      await channel.send({ embeds: [{ color: embed.color, description: chunk }] });
      sentCount += 1;
    } catch (error) {
      console.error(`Failed to send continuation ${sentCount + 1}/${chunks.length}:`, error);
      break;
    }
  }
  return { message, sentCount };
}

module.exports = { sendNotification, splitText };
