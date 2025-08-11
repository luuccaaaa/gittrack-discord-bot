/**
 * Handles GitHub pull request review events
 * This file contains handlers for pull request review and review comment events
 */

// Helper: resolve routing and config for pull_request event
async function getPullRequestRouting(prisma, repoContext, fallbackChannelId) {
  try {
    const mapping = await prisma.repositoryEventChannel.findFirst({
      where: { repositoryId: repoContext.id, eventType: 'pull_request' }
    });
    return { channelId: mapping?.channelId || fallbackChannelId || 'pending', config: mapping?.config || null };
  } catch (e) {
    return { channelId: fallbackChannelId || 'pending', config: null };
  }
}

/**
 * Handles pull request review events
 * Event for when a PR review is submitted, edited, or dismissed
 */
async function handlePRReviewEvent(req, res, payload, prisma, botClient, repoContext) {
  const repoUrl = payload.repository.html_url;
  const action = payload.action; // submitted, edited, dismissed
  const reviewState = payload.review.state; // approved, commented, changes_requested, dismissed
  const username = payload.sender.login;
  const prNumber = payload.pull_request.number;
  const prTitle = payload.pull_request.title;
  const reviewUrl = payload.review.html_url;
  
  console.log(`PR Review ${action} (${reviewState}) on PR #${prNumber} in ${repoUrl} by ${username}`);

  // We'll focus on the submitted action as it's the most important
  if (action !== 'submitted') {
    return { statusCode: 200, message: `PR review ${action} event acknowledged.`, channelId: null, messageId: null };
  }

  const serverConfig = repoContext.server;
  // Route using pull_request mapping and honor config
  const { channelId, config } = await getPullRequestRouting(prisma, repoContext, repoContext.notificationChannelId);

  // If this is a comment-only review notification and comments are not explicitly enabled, skip
  if (reviewState === 'commented') {
    if (!config || !config.actionsEnabled || !config.actionsEnabled['comments']) {
      return { statusCode: 200, message: `PR review comments disabled by config.`, channelId: null, messageId: null };
    }
  }

  if (channelId === 'pending') {
    console.warn(`Notification channel pending for repository ${repoUrl} on server ${serverConfig.guildId}`);
    return { statusCode: 200, message: 'PR review event acknowledged, notification channel pending.', channelId: null, messageId: null };
  }

  try {
    const channel = await botClient.channels.fetch(channelId);
    if (channel && channel.isTextBased()) {
      // Determine emoji and color based on review state
      let emoji, color;
      switch (reviewState) {
        case 'approved':
          emoji = '✅';
          color = 0x2CBE4E; // Green
          break;
        case 'changes_requested':
          emoji = '❌';
          color = 0xD73A49; // Red
          break;
        case 'commented':
          emoji = '💬';
          color = 0x0366D6; // Blue
          break;
        case 'dismissed':
          emoji = '⏭️';
          color = 0xA0A0A0; // Grey
          break;
        default:
          emoji = '📝';
          color = 0x0366D6; // Blue
      }
      
      // Format the state nicely
      const formattedState = reviewState
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      
      const embed = {
        color: color,
        title: `${emoji} PR #${prNumber} Review: ${formattedState}`,
        url: reviewUrl,
        fields: [
          { name: 'Repository', value: payload.repository.full_name, inline: false },
          { name: 'Pull Request', value: `[#${prNumber}: ${prTitle}](${payload.pull_request.html_url})`, inline: false },
          { name: 'Reviewer', value: username, inline: true },
          { name: 'Review State', value: formattedState, inline: true },
          { name: 'View Review', value: `[Link to Review](${reviewUrl})`, inline: true }
        ],
        timestamp: new Date().toISOString(),
        footer: { text: 'GitHub Pull Request Review' }
      };
      
      // Add review comments if available
      if (payload.review.body) {
        const reviewBody = payload.review.body;
        embed.description = reviewBody.length > 300 
          ? reviewBody.substring(0, 300) + '...' 
          : reviewBody;
      }
      
      const sentMessage = await channel.send({ embeds: [embed] });
      console.log(`Sent PR review notification to channel ${channelId} in guild ${serverConfig.guildId}`);

      // Increment messagesSent counter
      try {
        await prisma.server.update({
          where: { id: serverConfig.id },
          data: { messagesSent: { increment: 1 } },
        });
        console.log(`Incremented messagesSent for server ${serverConfig.id} after PR review event`);
      } catch (dbError) {
        console.error(`Failed to increment messagesSent for server ${serverConfig.id} after PR review event:`, dbError);
      }

      return { statusCode: 200, message: 'PR review event processed successfully.', channelId: channelId, messageId: sentMessage.id };
    }
  } catch (err) {
    console.error(`Error sending PR review message to channel ${channelId}:`, err);
    return { statusCode: 200, message: 'PR review event processed successfully.', channelId: null, messageId: null };
  }

  return { statusCode: 200, message: 'PR review event processed successfully.', channelId: null, messageId: null };
}

/**
 * Handles pull request review comment events
 * Event for when a comment is made on a specific line of code in a PR
 */
async function handlePRReviewCommentEvent(req, res, payload, prisma, botClient, repoContext) {
  const repoUrl = payload.repository.html_url;
  const action = payload.action; // created, edited, deleted
  const username = payload.sender.login;
  const prNumber = payload.pull_request.number;
  const prTitle = payload.pull_request.title;
  const commentUrl = payload.comment.html_url;
  const commentBody = payload.comment.body || '';
  const path = payload.comment.path; // File being commented on
  
  console.log(`PR Review Comment ${action} on PR #${prNumber} in ${repoUrl} by ${username}`);

  // Only notify for new comments
  if (action !== 'created') {
    return { statusCode: 200, message: `PR review comment ${action} event acknowledged.`, channelId: null, messageId: null };
  }

  const serverConfig = repoContext.server;
  // Route using pull_request mapping and honor config
  const { channelId, config } = await getPullRequestRouting(prisma, repoContext, repoContext.notificationChannelId);

  // Require explicit enablement of PR comments
  if (!config || !config.actionsEnabled || !config.actionsEnabled['comments']) {
    return { statusCode: 200, message: `PR comments disabled by config.`, channelId: null, messageId: null };
  }

  if (channelId === 'pending') {
    console.warn(`Notification channel pending for repository ${repoUrl} on server ${serverConfig.guildId}`);
    return { statusCode: 200, message: 'PR review comment event acknowledged, notification channel pending.', channelId: null, messageId: null };
  }

  try {
    const channel = await botClient.channels.fetch(channelId);
    if (channel && channel.isTextBased()) {
      const emoji = '💬';
      const color = 0x0366D6; // Blue
      
      const embed = {
        color: color,
        title: `${emoji} New PR #${prNumber} Line Comment`,
        url: commentUrl,
        fields: [
          { name: 'Repository', value: payload.repository.full_name, inline: false },
          { name: 'Pull Request', value: `[#${prNumber}: ${prTitle}](${payload.pull_request.html_url})`, inline: false },
          { name: 'Commented By', value: username, inline: true },
          { name: 'File', value: `\`${path}\``, inline: true },
          { name: 'View Comment', value: `[Link to Comment](${commentUrl})`, inline: true }
        ],
        timestamp: new Date().toISOString(),
        footer: { text: 'GitHub PR Code Comment' }
      };
      
      // Extract line number information if available
      if (payload.comment.line) {
        let lineInfo = `Line ${payload.comment.line}`;
        if (payload.comment.start_line && payload.comment.start_line !== payload.comment.line) {
          lineInfo = `Lines ${payload.comment.start_line}-${payload.comment.line}`;
        }
        embed.fields.push({ name: 'Location', value: lineInfo, inline: true });
      }
      
      // Add comment snippet if available
      if (commentBody) {
        // Only take first paragraph of comment for brevity
        const firstParagraph = commentBody.split('\n')[0];
        embed.description = firstParagraph.length > 300 
          ? firstParagraph.substring(0, 300) + '...' 
          : firstParagraph;
          
        // If there's more content, indicate it
        if (commentBody.split('\n').length > 1 || commentBody.length > 300) {
          embed.description += '\n\n*[See full comment on GitHub]*';
        }
      }
      
      // Add code sample if available
      if (payload.comment.diff_hunk) {
        // Extract just a small part of the diff to show context
        const diffLines = payload.comment.diff_hunk.split('\n');
        // Take up to 3 lines of context
        const contextLines = diffLines.slice(Math.max(0, diffLines.length - 3));
        const codePreview = '```diff\n' + contextLines.join('\n') + '\n```';
        
        embed.fields.push({ 
          name: 'Code Context', 
          value: codePreview.length > 1024 
            ? codePreview.substring(0, 1020) + '...\n```' 
            : codePreview, 
          inline: false 
        });
      }
      
      const sentMessage = await channel.send({ embeds: [embed] });
      console.log(`Sent PR review comment notification to channel ${channelId} in guild ${serverConfig.guildId}`);

      // Increment messagesSent counter
      try {
        await prisma.server.update({
          where: { id: serverConfig.id },
          data: { messagesSent: { increment: 1 } },
        });
        console.log(`Incremented messagesSent for server ${serverConfig.id} after PR review comment event`);
      } catch (dbError) {
        console.error(`Failed to increment messagesSent for server ${serverConfig.id} after PR review comment event:`, dbError);
      }

      return { statusCode: 200, message: 'PR review comment event processed successfully.', channelId: channelId, messageId: sentMessage.id };
    }
  } catch (err) {
    console.error(`Error sending PR review comment message to channel ${channelId}:`, err);
    return { statusCode: 200, message: 'PR review comment event processed successfully.', channelId: null, messageId: null };
  }

  return { statusCode: 200, message: 'PR review comment event processed successfully.', channelId: null, messageId: null };
}

module.exports = {
  handlePRReviewEvent,
  handlePRReviewCommentEvent
};
