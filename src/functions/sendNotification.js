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
 * Send an embed, adding the event's configured role ping (config.pingRoleId)
 * and continuing over extra messages if the description exceeds Discord's limit.
 * Returns the first message sent.
 */
async function sendNotification(channel, embed, config) {
  const roleId = config && config.pingRoleId;
  const opts = roleId ? { content: `<@&${roleId}>`, allowedMentions: { roles: [roleId] } } : {};
  const chunks = embed.description ? splitText(embed.description) : [];
  if (chunks.length <= 1) { return channel.send({ ...opts, embeds: [embed] }); }

  const first = await channel.send({ ...opts, embeds: [{ ...embed, description: chunks[0] }] });
  for (const chunk of chunks.slice(1)) {
    await channel.send({ embeds: [{ color: embed.color, description: chunk }] });
  }
  return first;
}

module.exports = { sendNotification, splitText };
