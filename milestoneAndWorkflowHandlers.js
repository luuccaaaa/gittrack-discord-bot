const { findMatchingBranches } = require('./functions/branchMatcher');

async function handleMilestoneEvent(req, res, payload, prisma, botClient, repoContext) {
  const repoUrl = payload.repository.html_url;
  const action = payload.action; // created, closed, opened, edited, deleted
  const milestoneTitle = payload.milestone.title;
  const milestoneUrl = payload.milestone.html_url;
  const username = payload.sender.login;
  const description = payload.milestone.description || '';
  const dueDate = payload.milestone.due_on ? new Date(payload.milestone.due_on).toLocaleDateString() : 'No due date';
  
  console.log(`Milestone "${milestoneTitle}" ${action} in ${repoUrl} by ${username}`);

  try {
    // Only notify for important milestone actions
    if (!['created', 'closed', 'opened'].includes(action)) {
      return { statusCode: 200, message: `Milestone ${action} event acknowledged.`, channelId: null, messageId: null };
    }

    // Use repoContext directly as it's the validated one for this webhook
    const serverConfig = repoContext.server;
    // Use the repository-specific notification channel
    const channelId = repoContext.notificationChannelId || 'pending';

    if (channelId === 'pending') {
        console.warn(`Notification channel pending for repository ${repoUrl} on server ${serverConfig.guildId}`);
        return { statusCode: 200, message: 'Milestone event acknowledged, notification channel pending.', channelId: null, messageId: null };
    }

    try {
      const channel = await botClient.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        // Determine emoji based on action
        let emoji;
        switch (action) {
          case 'created':
          case 'opened':
            emoji = '🏁';
            break;
          case 'closed':
            emoji = '✅';
            break;
          default:
            emoji = '📝';
        }
        
        const embed = {
          color: action === 'closed' ? 0x2CBE4E : 0x0366D6, // Green for closed, blue for others
          title: `${emoji} Milestone ${action.charAt(0).toUpperCase() + action.slice(1)}: ${milestoneTitle}`,
          url: milestoneUrl,
          fields: [
            { name: 'Repository', value: payload.repository.full_name, inline: false },
            { name: action.charAt(0).toUpperCase() + action.slice(1) + ' By', value: username, inline: true },
            { name: 'Due Date', value: dueDate, inline: true }
          ],
          timestamp: new Date().toISOString(),
          footer: { text: 'GitHub Milestone Event' }
        };
        
        // Add description if available
        if (description) {
          embed.description = description.length > 200 
            ? description.substring(0, 200) + '...' 
            : description;
        }
        
        // Add progress for closed/open milestones
        if (['opened', 'closed'].includes(action)) {
          const openIssues = payload.milestone.open_issues;
          const closedIssues = payload.milestone.closed_issues;
          const total = openIssues + closedIssues;
          const percentComplete = total > 0 ? Math.round((closedIssues / total) * 100) : 0;
          
          embed.fields.push({ 
            name: 'Progress', 
            value: `${closedIssues}/${total} issues completed (${percentComplete}%)`, 
            inline: false 
          });
        }
        
        const sentMessage = await channel.send({ embeds: [embed] });
        console.log(`Sent milestone notification to channel ${channelId} in guild ${serverConfig.guildId}`);

        // Increment messagesSent counter
        try {
          await prisma.server.update({
            where: { id: serverConfig.id },
            data: { messagesSent: { increment: 1 } },
          });
          console.log(`Incremented messagesSent for server ${serverConfig.id} after milestone event`);
        } catch (dbError) {
          console.error(`Failed to increment messagesSent for server ${serverConfig.id} after milestone event:`, dbError);
        }

        return { statusCode: 200, message: 'Milestone event processed successfully.', channelId: channelId, messageId: sentMessage.id };
      }
    } catch (err) {
      console.error(`Error sending milestone message to channel ${channelId}:`, err);
      return { statusCode: 200, message: 'Milestone event processed successfully.', channelId: null, messageId: null };
    }

    return { statusCode: 200, message: 'Milestone event processed successfully.', channelId: null, messageId: null };
  } catch (error) {
    console.error('Error processing milestone event:', error);
    throw error; // Let handleEventWithLogging handle the error and response
  }
}

async function handleWorkflowRunEvent(req, res, payload, prisma, botClient, repoContext) {
  const repoUrl = payload.repository.html_url;
  const action = payload.action; // completed, requested, etc.
  const workflow = payload.workflow_run;
  const workflowName = workflow.name;
  const workflowUrl = workflow.html_url;
  const conclusion = workflow.conclusion; // success, failure, cancelled, etc.
  const branch = workflow.head_branch;
  
  console.log(`Workflow run "${workflowName}" ${action} with conclusion "${conclusion}" in ${repoUrl} on branch ${branch}`);

  // Only send notifications for completed workflow runs
  if (action !== 'completed') {
    return { statusCode: 200, message: 'Workflow run event acknowledged.', channelId: null, messageId: null };
  }

  try {
    // Use repoContext directly as it's the validated one for this webhook
    const serverConfig = repoContext.server;
    
    // Get all tracked branches for this repository
    const allTrackedBranches = await prisma.trackedBranch.findMany({
        where: {
            repositoryId: repoContext.id
        }
    });

    // Find branches that match the current branch using pattern matching
    const matchingBranches = findMatchingBranches(allTrackedBranches, branch);
    
    if (matchingBranches.length === 0) {
      return { statusCode: 200, message: 'No matching branch configurations for this workflow run.', channelId: null, messageId: null };
    }

    let lastMessageInfo = { channelId: null, messageId: null };
    
    // For each matching tracked branch, send a notification
    for (const trackedBranch of matchingBranches) {
      // Use the repository-specific notification channel, fall back to branch-specific channel if set
      const channelId = trackedBranch.channelId || repoContext.notificationChannelId || 'pending';
      
      if (channelId === 'pending') {
        console.warn(`Notification channel pending for repository ${repoUrl} on server ${serverConfig.guildId}`);
        continue;
      }
      
      try {
        const channel = await botClient.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
          // Determine emoji and color based on conclusion
          let emoji, color;
          switch (conclusion) {
            case 'success':
              emoji = '✅';
              color = 0x2CBE4E; // Green
              break;
            case 'failure':
              emoji = '❌';
              color = 0xD73A49; // Red
              break;
            case 'cancelled':
              emoji = '⚪';
              color = 0xA0A0A0; // Grey
              break;
            case 'skipped':
              emoji = '⏭️';
              color = 0xA0A0A0; // Grey
              break;
            case 'timed_out':
              emoji = '⏱️';
              color = 0xFFB347; // Orange
              break;
            default:
              emoji = '🔄';
              color = 0x0366D6; // Blue
          }
          
          const embed = {
            color: color,
            title: `${emoji} Workflow "${workflowName}" ${conclusion} on ${branch}`,
            url: workflowUrl,
            fields: [
              { name: 'Repository', value: `[${payload.repository.full_name}](${repoUrl})`, inline: true },
              { name: 'Branch', value: branch, inline: true },
              { name: 'Conclusion', value: conclusion.charAt(0).toUpperCase() + conclusion.slice(1), inline: true }
            ],
            timestamp: workflow.updated_at || new Date().toISOString(),
            footer: { text: 'GitHub Workflow Run' }
          };
          
          // Add run duration if available
          if (workflow.created_at && workflow.updated_at) {
            const startTime = new Date(workflow.created_at);
            const endTime = new Date(workflow.updated_at);
            const duration = Math.round((endTime - startTime) / 1000); // Duration in seconds
            const minutes = Math.floor(duration / 60);
            const seconds = duration % 60;
            embed.fields.push({ 
              name: 'Duration', 
              value: minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`, 
              inline: true 
            });
          }
          
          const sentMessage = await channel.send({ embeds: [embed] });
          console.log(`Sent workflow notification to channel ${channelId} in guild ${serverConfig.guildId}`);
          
          // Store the last message info for return
          lastMessageInfo = { channelId: channelId, messageId: sentMessage.id };

          // Increment messagesSent counter
          try {
            await prisma.server.update({
              where: { id: serverConfig.id },
              data: { messagesSent: { increment: 1 } },
            });
            console.log(`Incremented messagesSent for server ${serverConfig.id} after workflow event`);
          } catch (dbError) {
            console.error(`Failed to increment messagesSent for server ${serverConfig.id} after workflow event:`, dbError);
          }
        }
      } catch (err) {
        console.error(`Error sending workflow message to channel ${channelId}:`, err);
      }
    }

    return { statusCode: 200, message: 'Workflow run event processed successfully.', channelId: lastMessageInfo.channelId, messageId: lastMessageInfo.messageId };
  } catch (error) {
    console.error('Error processing workflow run event:', error);
    throw error; // Let handleEventWithLogging handle the error and response
  }
}

module.exports = {
  handleMilestoneEvent,
  handleWorkflowRunEvent
};
