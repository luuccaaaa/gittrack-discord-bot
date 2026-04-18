/**
 * Strip HTML comments (<!-- ... -->) from a string.
 *
 * GitHub issue/PR templates commonly include HTML comments as hints to the
 * author. GitHub hides them when rendering, but they remain in the raw
 * `body` field we get from webhooks — so we remove them before forwarding
 * text into Discord embeds.
 */
function stripHtmlComments(text) {
  if (typeof text !== 'string') {
    return '';
  }
  return text.replace(/<!--[\s\S]*?-->/g, '').trim();
}

module.exports = { stripHtmlComments };
