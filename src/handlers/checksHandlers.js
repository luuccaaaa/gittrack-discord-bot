const { findMatchingBranches } = require('../functions/branchMatcher');
const { getEventRouting } = require('../functions/eventRouting');

async function handleWorkflowJobEvent(req, res, payload, prisma, botClient, repoContext) {
  const repoUrl = payload.repository.html_url;
  const action = payload.action; // queued, in_progress, completed, waiting
  const job = payload.workflow_job;

  // Only notify for completed jobs to reduce noise
  if (action !== 'completed') {
    return { statusCode: 200, message: 'Workflow job event acknowledged.', channelId: null, messageId: null };
  }

  const serverConfig = repoContext.server;

  // Check configuration
  const { channelId: routedChannelId, config } = await getEventRouting(prisma, repoContext.id, 'workflow_job', repoContext.notificationChannelId);

  // Require explicit enablement
  if (config && config.actionsEnabled) {
    if (!config.actionsEnabled[action]) {
      return { statusCode: 200, message: `Workflow job action '${action}' disabled by config.`, channelId: null, messageId: null };
    }
  } else {
    // Default behavior if no config: allow 'completed'
    if (action !== 'completed') {
      return { statusCode: 200, message: 'Workflow job event not configured; skipping.', channelId: null, messageId: null };
    }
  }

  const channelId = routedChannelId || 'pending';

  if (channelId === 'pending') {
    console.warn(`Notification channel pending for repository ${repoUrl} on server ${serverConfig.guildId}`);
    return { statusCode: 200, message: 'Workflow job event acknowledged, notification channel pending.', channelId: null, messageId: null };
  }

  try {
    const channel = await botClient.channels.fetch(channelId);
    if (channel && channel.isTextBased()) {
      const conclusion = job.conclusion || 'unknown';
      let emoji; let color;
      switch (conclusion) {
        case 'success': emoji = '✅'; color = 0x2CBE4E; break;
        case 'failure': emoji = '❌'; color = 0xD73A49; break;
        case 'cancelled': emoji = '⚪'; color = 0xA0A0A0; break;
        case 'timed_out': emoji = '⏱️'; color = 0xFFB347; break;
        case 'skipped': emoji = '⏭️'; color = 0xA0A0A0; break;
        default: emoji = '🔄'; color = 0x0366D6;
      }

      const title = `${emoji} Job "${job.name}" ${conclusion}`;
      const url = job.html_url || repoUrl;

      const embed = {
        color,
        title,
        url,
        fields: [
          { name: 'Repository', value: `[${payload.repository.full_name}](${repoUrl})`, inline: true },
          { name: 'Status', value: job.status || 'unknown', inline: true },
        ],
        timestamp: job.completed_at || new Date().toISOString(),
        footer: { text: 'GitHub Workflow Job' }
      };

      if (job.started_at && job.completed_at) {
        const startTime = new Date(job.started_at);
        const endTime = new Date(job.completed_at);
        const durationSec = Math.max(0, Math.round((endTime - startTime) / 1000));
        const minutes = Math.floor(durationSec / 60);
        const seconds = durationSec % 60;
        embed.fields.push({ name: 'Duration', value: minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`, inline: true });
      }

      const sentMessage = await channel.send({ embeds: [embed] });

      // Increment messagesSent counter
      try {
        await prisma.server.update({ where: { id: serverConfig.id }, data: { messagesSent: { increment: 1 } } });
      } catch (dbError) {
        console.error(`Failed to increment messagesSent for server ${serverConfig.id} after workflow_job event:`, dbError);
      }

      return { statusCode: 200, message: 'Workflow job event processed successfully.', channelId, messageId: sentMessage.id };
    }
  } catch (err) {
    console.error(`Error sending workflow_job message to channel ${channelId}:`, err);
  }
  return { statusCode: 200, message: 'Workflow job event processed successfully.', channelId: null, messageId: null };
}

async function handleCheckRunEvent(req, res, payload, prisma, botClient, repoContext) {
  const repoUrl = payload.repository.html_url;
  const action = payload.action; // created, queued, in_progress, completed, etc.
  const checkRun = payload.check_run;

  // Only notify for completed checks to reduce noise
  if (action !== 'completed') {
    return { statusCode: 200, message: 'Check run event acknowledged.', channelId: null, messageId: null };
  }

  const serverConfig = repoContext.server;

  // Check configuration
  const { channelId: routedChannelId, config } = await getEventRouting(prisma, repoContext.id, 'check_run', repoContext.notificationChannelId);

  // Require explicit enablement
  if (config && config.actionsEnabled) {
    if (!config.actionsEnabled[action]) {
      return { statusCode: 200, message: `Check run action '${action}' disabled by config.`, channelId: null, messageId: null };
    }
  } else {
    // Default behavior if no config: allow 'completed'
    if (action !== 'completed') {
      return { statusCode: 200, message: 'Check run event not configured; skipping.', channelId: null, messageId: null };
    }
  }

  // Try to resolve branch from check_suite; fall back to repo default channel
  const branch = (checkRun && checkRun.check_suite && checkRun.check_suite.head_branch) ? checkRun.check_suite.head_branch : null;

  // If we have a branch, attempt to match tracked branches; otherwise, default channel
  if (branch) {
    try {
      const allTrackedBranches = await prisma.trackedBranch.findMany({ where: { repositoryId: repoContext.id } });
      const matchingBranches = findMatchingBranches(allTrackedBranches, branch);

      if (matchingBranches.length > 0) {
        let lastMessageInfo = { channelId: null, messageId: null };
        for (const trackedBranch of matchingBranches) {
          // Use tracked branch channel if set, otherwise use the routed channel for this event type
          const channelId = trackedBranch.channelId || routedChannelId || 'pending';
          if (channelId === 'pending') { continue; }

          try {
            const channel = await botClient.channels.fetch(channelId);
            if (channel && channel.isTextBased()) {
              const conclusion = checkRun.conclusion || 'unknown';
              let emoji; let color;
              switch (conclusion) {
                case 'success': emoji = '✅'; color = 0x2CBE4E; break;
                case 'failure': emoji = '❌'; color = 0xD73A49; break;
                case 'cancelled': emoji = '⚪'; color = 0xA0A0A0; break;
                case 'timed_out': emoji = '⏱️'; color = 0xFFB347; break;
                case 'neutral': emoji = '⚪'; color = 0xA0A0A0; break;
                case 'skipped': emoji = '⏭️'; color = 0xA0A0A0; break;
                case 'action_required': emoji = '⚠️'; color = 0xFF9800; break;
                default: emoji = '🔄'; color = 0x0366D6;
              }

              const title = `${emoji} Check "${checkRun.name}" ${conclusion} on ${branch}`;
              const url = checkRun.html_url || repoUrl;

              const embed = {
                color,
                title,
                url,
                fields: [
                  { name: 'Repository', value: `[${payload.repository.full_name}](${repoUrl})`, inline: true },
                  { name: 'SHA', value: `\`${(checkRun.head_sha || '').substring(0, 7)}\``, inline: true },
                ],
                timestamp: checkRun.completed_at || new Date().toISOString(),
                footer: { text: 'GitHub Check Run' }
              };

              const sentMessage = await channel.send({ embeds: [embed] });
              lastMessageInfo = { channelId, messageId: sentMessage.id };

              try {
                await prisma.server.update({ where: { id: serverConfig.id }, data: { messagesSent: { increment: 1 } } });
              } catch (dbError) {
                console.error(`Failed to increment messagesSent for server ${serverConfig.id} after check_run event:`, dbError);
              }
            }
          } catch (err) {
            console.error(`Error sending check_run message to channel ${channelId}:`, err);
          }
        }
        return { statusCode: 200, message: 'Check run event processed successfully.', channelId: lastMessageInfo.channelId, messageId: lastMessageInfo.messageId };
      }
    } catch (error) {
      console.error('Error processing check_run branch matching:', error);
    }
  }

  // Fallback: send to repository default channel
  // Fallback: send to repository default channel (or routed channel)
  const channelId = routedChannelId || 'pending';
  if (channelId === 'pending') {
    console.warn(`Notification channel pending for repository ${repoUrl} on server ${serverConfig.guildId}`);
    return { statusCode: 200, message: 'Check run event acknowledged, notification channel pending.', channelId: null, messageId: null };
  }

  try {
    const channel = await botClient.channels.fetch(channelId);
    if (channel && channel.isTextBased()) {
      const conclusion = checkRun.conclusion || 'unknown';
      let emoji; let color;
      switch (conclusion) {
        case 'success': emoji = '✅'; color = 0x2CBE4E; break;
        case 'failure': emoji = '❌'; color = 0xD73A49; break;
        case 'cancelled': emoji = '⚪'; color = 0xA0A0A0; break;
        case 'timed_out': emoji = '⏱️'; color = 0xFFB347; break;
        case 'neutral': emoji = '⚪'; color = 0xA0A0A0; break;
        case 'skipped': emoji = '⏭️'; color = 0xA0A0A0; break;
        case 'action_required': emoji = '⚠️'; color = 0xFF9800; break;
        default: emoji = '🔄'; color = 0x0366D6;
      }

      const title = `${emoji} Check "${checkRun.name}" ${conclusion}`;
      const url = checkRun.html_url || repoUrl;
      const embed = {
        color,
        title,
        url,
        fields: [
          { name: 'Repository', value: `[${payload.repository.full_name}](${repoUrl})`, inline: true },
          { name: 'SHA', value: `\`${(checkRun.head_sha || '').substring(0, 7)}\``, inline: true },
        ],
        timestamp: checkRun.completed_at || new Date().toISOString(),
        footer: { text: 'GitHub Check Run' }
      };
      const sentMessage = await channel.send({ embeds: [embed] });

      try {
        await prisma.server.update({ where: { id: serverConfig.id }, data: { messagesSent: { increment: 1 } } });
      } catch (dbError) {
        console.error(`Failed to increment messagesSent for server ${serverConfig.id} after check_run event:`, dbError);
      }

      return { statusCode: 200, message: 'Check run event processed successfully.', channelId, messageId: sentMessage.id };
    }
  } catch (err) {
    console.error(`Error sending check_run message to channel ${channelId}:`, err);
  }

  return { statusCode: 200, message: 'Check run event processed successfully.', channelId: null, messageId: null };
}

module.exports = {
  handleWorkflowJobEvent,
  handleCheckRunEvent,
};


