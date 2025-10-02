const { findMatchingBranches } = require('../functions/branchMatcher');

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
    // Use repoContext directly as it's the validated one for this webhook
    const serverConfig = repoContext.server;
    // Prefer event-specific channel for milestone events and fetch config
    let mapping = await prisma.repositoryEventChannel.findFirst({
      where: { repositoryId: repoContext.id, eventType: 'milestone' }
    });

    // Auto-create a default mapping/config if missing to avoid silent skips
    if (!mapping) {
      const defaultConfig = { actionsEnabled: { created: true, opened: true, closed: true }, explicitChannel: false };
      mapping = await prisma.repositoryEventChannel.create({
        data: {
          repositoryId: repoContext.id,
          eventType: 'milestone',
          channelId: 'default',
          config: defaultConfig
        }
      });
    }

    // Resolve effective channel:
    // - If channelId is the 'default' sentinel, use fallback
    // - If channelId matches fallback and not explicitly set, treat as default
    // - Otherwise use the stored channelId
    const explicit = mapping.config && mapping.config.explicitChannel === true;
    const effectiveChannelId = (mapping.channelId === 'default' || (!explicit && mapping.channelId === repoContext.notificationChannelId))
      ? (repoContext.notificationChannelId || 'pending')
      : (mapping.channelId || repoContext.notificationChannelId || 'pending');
    
    const channelId = effectiveChannelId;
    const config = mapping.config || null;

    // Honor per-event action filter if configured, otherwise default important actions
    if (config && config.actionsEnabled && Object.prototype.hasOwnProperty.call(config.actionsEnabled, action)) {
      if (!config.actionsEnabled[action]) {
        return { statusCode: 200, message: `Milestone action '${action}' disabled by config.`, channelId: null, messageId: null };
      }
    } else if (!['created', 'closed', 'opened'].includes(action)) {
      return { statusCode: 200, message: `Milestone ${action} event acknowledged.`, channelId: null, messageId: null };
    }

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
  const jobsUrl = payload.workflow_run.jobs_url;
  const conclusion = workflow.conclusion; // success, failure, cancelled, etc.
  const branch = workflow.head_branch;
  
  // Only send notifications for completed workflow runs
  if (action !== 'completed') {
    return { statusCode: 200, message: 'Workflow run event acknowledged.', channelId: null, messageId: null };
  }

  console.log(`Workflow run "${workflowName}" ${action} with conclusion "${conclusion}" in ${repoUrl} on branch ${branch}`);

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
            footer: { text: "GitHub Workflow Run" }
          };

          let jobField = null;
          try {
            const jobsResponse = await fetch(jobsUrl);
            console.log("jobsResponse: " + JSON.stringify(jobsResponse));
            if (jobsResponse.ok) {
              console.log("jobsResponse.jobs exists");
              const jobsData = await jobsResponse.json();
              if(jobsData?.jobs && jobsData.jobs.length > 0) {
                jobField = analyzeJobs(jobsData?.jobs);
              }
            } else {
              console.warn(`Failed to fetch jobs for workflow run: ${jobsResponse.jobs}`);
            }
          } catch (jobsError) {
            console.error('Error fetching workflow jobs:', jobsError);
          }

          if (jobField) {
            embed.fields.push(jobField);
          }

          
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

function analyzeJobs(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return null;
  }

  const statusMeta = {
    success: { indicator: '✓', label: 'Passed', color: 'green' },
    failure: { indicator: '✗', label: 'Failed', color: 'red' },
    cancelled: { indicator: '⬣', label: 'Cancelled', color: 'yellow' },
    skipped: { indicator: '➤', label: 'Skipped', color: 'blue' },
    timed_out: { indicator: '🕒', label: 'Timed out', color: 'orange' }
  };

  let passed = 0;
  let failed = 0;

  // Go through each job and prepare entries
  const entries = jobs.map((job) => {
    const conclusion = (job.conclusion || job.status || '').toLowerCase();
    // map conclusion to known meta
    const meta = statusMeta[conclusion];

    // Update counts
    if (conclusion === 'success') passed += 1;
    else if (conclusion === 'failure') failed += 1;

    // Format duration if available
    const duration = formatDuration(job.started_at, job.completed_at);
    // Prepare right side with colored label and optional duration
    const right = duration
      ? `${wrapAnsi(meta.indicator, meta.color)} ${wrapAnsi(meta.label, meta.color)} · ${duration}`
      : `${wrapAnsi(meta.indicator, meta.color)} ${wrapAnsi(meta.label, meta.color)}`;

    return {
      indicator: meta.indicator,
      name: job.name || 'Unnamed job',
      right
    };
  });

  // stop if no entries
  if (entries.length === 0) {
    return null;
  }

  // Determine padding for alignment
  const maxNameLength = Math.max(0, ...entries.map(({ name }) => name.length));

  // Format each entry with padding and ANSI codes
  const formatted = entries.map(({ indicator, name, right }) => {
    const paddedName = name.padEnd(maxNameLength, '    ');
    const left = `\u001b[1;2m${paddedName}\u001b[0m`;
    return {
      left,
      right,
    };
  });

  // Determine box width for alignment
  const boxWidth =
    Math.max(...formatted.map(({ left, right }) => left.length + right.length)) + 2;

  // Create lines with proper spacing
  const lines = formatted.map(({ left, right }) => {
    const spacing = Math.max(1, boxWidth - left.length - right.length);
    return `${left}${' '.repeat(spacing)}${right}`;
  });

  // Prepare header with summary
  const passedString = wrapAnsi(`${passed} passed`, 'green');
  const failedString = failed > 0 ? wrapAnsi(`${failed} failed`, 'red') : `${failed} failed`;
  const header = `${passedString} · ${failedString}`;

  // Wrap lines in ANSI code block
  
  const wrapLines = (lineArray) =>
    `\`\`\`ansi\n\n${header}\n${lineArray.join('\n')}\n\`\`\``;

  let value = wrapLines(lines);
  let truncated = false;

  // Ensure total length does not exceed 1024 characters
  // If too long, truncate lines from the end and add ellipsis line
  while (value.length > 1024 && lines.length > 0) {
    lines.pop();
    truncated = true;
    value = wrapLines(lines);
  }

  // If still too long, add ellipsis line
  if (truncated) {
    const ellipsisLeft = `! ${''.padEnd(maxNameLength, ' ')}`;
    const ellipsisRight = wrapAnsi('…', 'yellow');
    const leftLength = ellipsisLeft.length;
    const rightLength = ellipsisRight.length;
    const spacing = Math.max(1, boxWidth - leftLength - rightLength);
    const ellipsisLine = `${ellipsisLeft}${' '.repeat(spacing)}${ellipsisRight}`;
    const candidate = wrapLines([...lines, ellipsisLine]);
    value = candidate.length <= 1024 ? candidate : wrapLines(lines);
  }

  return { name: 'Jobs', value, inline: false };
}

// Format duration between two ISO date strings into "Xm Ys" format
function formatDuration(start, end) {
  if (!start || !end) {
    return '';
  }

  const durationMs = new Date(end) - new Date(start);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return '';
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

// Wrap text in ANSI color codes
function wrapAnsi(text, color) {
  if (!text) return '';
  const code = /^\d+$/.test(color) ? color : ansiColorCode(color);
  return `\u001b[2;${code}m${text}\u001b[0m`;
}

// Map color names to ANSI codes
function ansiColorCode(colorName) {
  switch ((colorName || '').toLowerCase()) {
    case 'green':
      return '32';
    case 'red':
      return '31';
    case 'yellow':
      return '33';
    case 'blue':
      return '34';
    case 'magenta':
      return '35';
    case 'cyan':
      return '36';
    case 'gray':
    case 'grey':
      return '90';
    default:
      return '37';
  }
}

module.exports = {
  handleMilestoneEvent,
  handleWorkflowRunEvent
};
