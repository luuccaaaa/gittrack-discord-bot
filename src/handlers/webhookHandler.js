const express = require('express');
const crypto = require('crypto');
const querystring = require('querystring');
const { handleMilestoneEvent, handleWorkflowRunEvent } = require('./milestoneAndWorkflowHandlers');
const { handlePRReviewEvent, handlePRReviewCommentEvent } = require('./pullRequestHandlers');
const { checkChannelLimit } = require('../functions/limitChecker');
const { findMatchingBranches } = require('../functions/branchMatcher');

function initializeWebServer(prisma, botClient) {
  const app = express();

  // Middleware to capture raw body AND parse it appropriately
  // Increase the limit to handle large GitHub webhook payloads (up to 10MB, instead of 100kb)
  app.use('/github-webhook', express.raw({ type: '*/*', limit: '10mb' }), (req, res, next) => {
    // Store raw body for signature validation
    req.rawBody = req.body.toString('utf8');
    
    // Parse based on content type
    const contentType = req.headers['content-type'];
    if (contentType && contentType.includes('application/json')) {
      try {
        req.body = JSON.parse(req.rawBody);
      } catch (e) {
        console.error('Failed to parse JSON:', e.message);
        req.body = {};
      }
    } else if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
      try {
        const parsed = querystring.parse(req.rawBody);
        req.body = parsed;
      } catch (e) {
        console.error('Failed to parse form data:', e.message);
        req.body = {};
      }
    }
    
    next();
  });

  // For other routes, use normal parsing with increased limits
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.get('/', (req, res) => {
    res.send('GitTrack Webhook Handler is alive!');
  });

  app.post('/github-webhook', async (req, res) => {
    // Check content type first
    const contentType = req.headers['content-type'];
    if (contentType && !contentType.includes('application/json')) {
      console.error(`Wrong content type: ${contentType}. GitHub webhooks must use application/json.`);
      
      // Try to extract repository info from form data if possible and notify Discord
      await tryNotifyContentTypeError(req, prisma, botClient);
      
      // Try to send a helpful error message
      const errorResponse = {
        error: 'Invalid Content Type',
        message: 'GitHub webhook content type must be "application/json", not "application/x-www-form-urlencoded"',
        fix: 'Go to your GitHub repository → Settings → Webhooks → Edit your webhook → Change "Content type" to "application/json"'
      };
      
      return res.status(400).json(errorResponse);
    }
    
    // Get important information from GitHub's payload
    const payload = req.body;
    
    // Ensure we have a valid payload with repository information
    if (!payload || !payload.repository || !payload.repository.html_url) {
      console.error('Webhook received with invalid payload structure');
      
      // More detailed error for debugging
      const errorResponse = {
        error: 'Invalid Payload Structure',
        message: 'Webhook payload is missing required repository information',
        received: typeof payload,
        fix: 'Ensure your GitHub webhook is properly configured and sending JSON data'
      };
      
      return res.status(400).json(errorResponse);
    }
    
    const repoUrl = payload.repository.html_url;
    const signature = req.headers['x-hub-signature-256'];
    const event = req.headers['x-github-event'];
    const requestBody = req.rawBody; // Use raw body for signature validation

    try {
      const possibleUrls = [repoUrl];
      if (repoUrl.endsWith('.git')) {
        possibleUrls.push(repoUrl.slice(0, -4));
      } else {
        possibleUrls.push(repoUrl + '.git');
      }

      const candidateRepositories = await prisma.repository.findMany({
        where: { url: { in: possibleUrls } },
        include: { server: true }
      });

      if (!candidateRepositories || candidateRepositories.length === 0) {
        console.warn(`Repository not found or no configurations for: ${repoUrl}`);
        // Optional: Notify owner about unknown repo (current logic can be kept or adapted)
        return res.status(404).send('Repository not configured or no matching secret found.');
      }

      if (!signature) {
        console.warn(`No signature found in GitHub webhook request for ${repoUrl}`);
        // Optional: Notify relevant server(s) about missing signature (current logic can be kept or adapted)
        return res.status(401).send('No signature provided');
      }

      let validatedRepositoryContext = null;

      for (const repoEntry of candidateRepositories) {
        const secretToUse = repoEntry.webhookSecret || process.env.GITHUB_WEBHOOK_SECRET;
        if (!secretToUse) {
          console.error(`No secret for repo ID ${repoEntry.id}, skipping.`);
          continue;
        }

        const signaturePrefix = 'sha256=';
        if (!signature.startsWith(signaturePrefix)) {
          console.error('Invalid signature format.');
          continue; // Or break, as it won't match any
        }
              const providedSignature = signature.substring(signaturePrefix.length);
      const hmac = crypto.createHmac('sha256', secretToUse);
      hmac.update(req.rawBody); // Use the raw request body for signature validation
      const expectedSignature = hmac.digest('hex');

        if (
          Buffer.from(providedSignature, 'hex').length === Buffer.from(expectedSignature, 'hex').length &&
          crypto.timingSafeEqual(Buffer.from(providedSignature, 'hex'), Buffer.from(expectedSignature, 'hex'))
        ) {
          validatedRepositoryContext = repoEntry;
          break;
        }
      }

      if (!validatedRepositoryContext) {
        console.error(`Invalid signature for ${repoUrl}. No matching secret found.`);
        // Optional: Notify relevant server(s) about invalid signature (current logic can be kept or adapted)
        return res.status(401).send('Invalid signature');
      }

      if (!event) {
        console.error('No event type specified in GitHub webhook');
        return res.status(400).send('No event type specified');
      }

              // Event verified successfully - no need to log every webhook

      // Track processing time for error logging
      const startTime = Date.now();

      // Pass validatedRepositoryContext to handlers
      const loggingContext = { startTime, event, action: payload.action };
      
      switch (event) {
        case 'push':
          return await handleEventWithLogging(handlePushEvent, req, res, payload, prisma, botClient, validatedRepositoryContext, loggingContext);
        case 'pull_request':
          return await handleEventWithLogging(handlePullRequestEvent, req, res, payload, prisma, botClient, validatedRepositoryContext, loggingContext);
        case 'issues':
          return await handleEventWithLogging(handleIssuesEvent, req, res, payload, prisma, botClient, validatedRepositoryContext, loggingContext);
        case 'star':
          return await handleEventWithLogging(handleStarEvent, req, res, payload, prisma, botClient, validatedRepositoryContext, loggingContext);
        case 'release':
          return await handleEventWithLogging(handleReleaseEvent, req, res, payload, prisma, botClient, validatedRepositoryContext, loggingContext);
        case 'delete':
          return await handleEventWithLogging(handleDeleteEvent, req, res, payload, prisma, botClient, validatedRepositoryContext, loggingContext);
        case 'create':
          return await handleEventWithLogging(handleCreateEvent, req, res, payload, prisma, botClient, validatedRepositoryContext, loggingContext);
        case 'fork':
          return await handleEventWithLogging(handleForkEvent, req, res, payload, prisma, botClient, validatedRepositoryContext, loggingContext);
        case 'issue_comment':
          return await handleEventWithLogging(handleIssueCommentEvent, req, res, payload, prisma, botClient, validatedRepositoryContext, loggingContext);
        case 'pull_request_review':
          return await handleEventWithLogging(handlePRReviewEvent, req, res, payload, prisma, botClient, validatedRepositoryContext, loggingContext);
        case 'pull_request_review_comment':
          return await handleEventWithLogging(handlePRReviewCommentEvent, req, res, payload, prisma, botClient, validatedRepositoryContext, loggingContext);
        case 'milestone':
          return await handleEventWithLogging(handleMilestoneEvent, req, res, payload, prisma, botClient, validatedRepositoryContext, loggingContext);
        case 'workflow_run':
          return await handleEventWithLogging(handleWorkflowRunEvent, req, res, payload, prisma, botClient, validatedRepositoryContext, loggingContext);
        case 'ping':
          return await handleEventWithLogging(handlePingEvent, req, res, payload, prisma, botClient, validatedRepositoryContext, loggingContext);
        default:
          console.log(`Event type ${event} is not currently handled.`);
          // Log unhandled event to SystemLog for monitoring
          try {
            await prisma.systemLog.create({
              data: {
                level: 'INFO',
                category: 'webhook',
                message: `Unhandled webhook event: ${event}`,
                details: {
                  serverId: validatedRepositoryContext.server.id,
                  repositoryId: validatedRepositoryContext.id,
                  action: payload.action || null,
                  processingTime: Date.now() - startTime,
                  userAgent: req.headers['user-agent'],
                  sourceIp: req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
                },
                ipAddress: req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
              }
            });
          } catch (logError) {
            console.error('Failed to log unhandled event:', logError);
          }
          return res.status(200).send(`Event ${event} received, but not currently handled.`);
      }
    } catch (error) {
      console.error('Error processing webhook:', error);
      
      // Log error to ErrorLog for debugging
      try {
        await prisma.errorLog.create({
          data: {
            serverId: validatedRepositoryContext?.server?.id || null,
            level: 'ERROR',
            message: `Webhook processing error: ${error.message}`,
            stack: error.stack,
            context: {
              eventType: event || 'unknown',
              action: payload?.action || null,
              processingTime: Date.now() - startTime,
              userAgent: req.headers['user-agent'],
              sourceIp: req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
            },
            source: 'webhook',
          }
        });
      } catch (logError) {
        console.error('Failed to log webhook error:', logError);
      }
      
      return res.status(500).send('Internal server error');
    }
  });

  app.get('/api/message-counts', async (req, res) => {
    try {
      const servers = await prisma.server.findMany({
        select: {
          guildId: true,
          messagesSent: true,
        },
      });
      res.status(200).json(servers);
    } catch (error) {
      console.error('Error fetching message counts:', error);
      res.status(500).send('Internal server error');
    }
  });

  // Define event handlers to accept validatedRepositoryContext
  // Example for one handler (others would follow a similar pattern):
  async function handleIssueCommentEvent(req, res, payload, prisma, botClient, repoContext) {
    const repoUrl = payload.repository.html_url;
    const action = payload.action;
    const username = payload.sender.login;
    const issueNumber = payload.issue.number;
    const issueTitle = payload.issue.title;
    const commentUrl = payload.comment.html_url;
    const isPR = Boolean(payload.issue.pull_request);
    const issueType = isPR ? 'Pull Request' : 'Issue';

    if (action !== 'created') {
      return { statusCode: 200, message: `${issueType} comment ${action} event acknowledged.`, channelId: null, messageId: null };
    }

    // Use repoContext directly as it's the validated one for this webhook
    const serverConfig = repoContext.server;
    // Use the repository-specific notification channel instead of the server-wide one
    const channelId = repoContext.notificationChannelId || 'pending';

    if (channelId === 'pending') {
        console.warn(`Notification channel pending for repository ${repoUrl} on server ${serverConfig.guildId}`);
        return { statusCode: 200, message: 'Comment event acknowledged, notification channel pending.', channelId: null, messageId: null };
    }

    try {
      // Check channel limits before sending notification
      const canSendNotification = await checkChannelLimitAndWarn(prisma, botClient, repoContext, channelId);
      
      if (!canSendNotification) {
                  console.warn(`Skipping notification delivery to channel ${channelId} due to channel limit`);
        return { statusCode: 200, message: `${issueType} comment event acknowledged, but notification skipped due to channel limits.`, channelId: null, messageId: null };
      }
      
      const channel = await botClient.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        const emoji = isPR ? '💬' : '🗣️';
        const color = isPR ? 0x2DA44E : 0x0969DA;

        const embed = {
          color: color,
          author: {
            name: username,
            icon_url: payload.sender.avatar_url,
            url: payload.sender.html_url,
          },
          title: `${emoji} New Comment on ${issueType} #${issueNumber}: ${issueTitle}`,
          url: commentUrl,
          fields: [
            { name: 'Repository', value: `[${payload.repository.full_name}](${repoUrl})`, inline: true },
            { name: `${issueType} Link`, value: `[#${issueNumber}](${payload.issue.html_url})`, inline: true },
          ],
          timestamp: payload.comment.created_at || new Date().toISOString(),
          footer: { text: `GitHub ${issueType} Comment` },
        };

        if (payload.comment.body) {
          let commentBody = payload.comment.body;
          if (commentBody.length > 1000) {
            commentBody = commentBody.substring(0, 997) + '...';
          }
          embed.description = commentBody;
        }

        const sentMessage = await channel.send({ embeds: [embed] });
        // Comment notification sent successfully

        // Increment messagesSent counter
        try {
          await prisma.server.update({
            where: { id: serverConfig.id },
            data: { messagesSent: { increment: 1 } },
          });
          // Messages sent counter incremented
        } catch (dbError) {
          console.error(`Failed to increment messagesSent for server ${serverConfig.id}:`, dbError);
        }
        
        return { statusCode: 200, message: `${issueType} comment event processed successfully.`, channelId: channelId, messageId: sentMessage.id };

              }
    } catch (err) {
      console.error(`Error sending comment message to channel ${channelId}:`, err);
      return { statusCode: 200, message: `${issueType} comment event processed successfully.`, channelId: null, messageId: null };
    }
    
    return { statusCode: 200, message: `${issueType} comment event processed successfully.`, channelId: null, messageId: null };
  }

  async function handlePushEvent(req, res, payload, prisma, botClient, repoContext) {
    const repoUrl = payload.repository.html_url;
    const branchRef = payload.ref;
    const branchName = branchRef.startsWith('refs/heads/') ? branchRef.substring(11) : null;
  
    if (!branchName) {
      return { statusCode: 200, message: 'Could not determine branch name.', channelId: null, messageId: null };
    }
  
    const serverConfig = repoContext.server;
    let lastMessageInfo = { channelId: null, messageId: null };
    
    // Get all tracked branches for this repository
    const allTrackedBranches = await prisma.trackedBranch.findMany({
        where: {
            repositoryId: repoContext.id
        }
    });

    // Find branches that match the current branch using pattern matching
    const trackedBranchConfigs = findMatchingBranches(allTrackedBranches, branchName);

    if (trackedBranchConfigs.length === 0) {
              // No tracking configurations match this branch
      return { statusCode: 200, message: 'No configurations for this push on the authenticated server.', channelId: null, messageId: null };
    }

    for (const tbConfig of trackedBranchConfigs) {
        // Use the repository-specific notification channel, fall back to branch-specific channel if set
        const channelId = tbConfig.channelId || repoContext.notificationChannelId || 'pending';
        if (channelId === 'pending') continue;

        try {
            // Check channel limits before sending notification
            const canSendNotification = await checkChannelLimitAndWarn(prisma, botClient, repoContext, channelId);
            
            if (!canSendNotification) {
                console.warn(`Skipping branch notification delivery to channel ${channelId} due to exceeding channel limit`);
                continue; // Skip this channel, try others
            }
            
            const channel = await botClient.channels.fetch(channelId);
            if (channel && channel.isTextBased()) {
                const color = 0x4F46E5;
                const embed = {
                    color: color,
                    author: {
                        name: payload.sender.login, // Use sender's login for author name
                        icon_url: payload.sender.avatar_url, // Sender's avatar
                        url: payload.sender.html_url // Link to sender's GitHub profile
                    },
                    timestamp: new Date().toISOString(),
                    footer: { text: `GitHub Push Event` }
                };
                // ... (rest of embed construction logic from original handlePushEvent)
                if (payload.created && (!payload.commits || payload.commits.length === 0)) {
                    embed.title = `🌱 New Branch Created: ${branchName}`;
                    embed.url = `${repoUrl}/tree/${branchName}`;
                    embed.fields = [
                        { name: 'Repository', value: `[${payload.repository.full_name}](${repoUrl})`, inline: false },
                        { name: 'Created by', value: payload.pusher.name || 'Unknown', inline: false },
                    ];
                } else if (payload.forced) {
                    embed.title = `⚠️ Force Push to ${branchName}`;
                    embed.url = payload.compare;
                    embed.fields = [
                        { name: 'Repository', value: `[${payload.repository.full_name}](${repoUrl})`, inline: true },
                        { name: 'Branch', value: `\`${branchName}\``, inline: true },
                        { name: 'Forced by', value: payload.pusher.name || 'Unknown', inline: false },
                    ];
                } else if (payload.commits && payload.commits.length > 0) {
                    embed.title = `🚀 New Push to ${branchName}`;
                    embed.url = payload.compare;
                    embed.description = payload.commits.slice(0, 5).map(commit => {
                        const commitMessage = commit.message.split('\n')[0];
                        return `[\`${commit.id.substring(0, 7)}\`](${commit.url}) ${commitMessage}`;
                    }).join('\n');
                    if (payload.commits.length > 5) {
                        embed.description += `\n...and ${payload.commits.length - 5} more commit(s).`;
                    }
                    embed.fields = [
                        { name: 'Repository', value: `[${payload.repository.full_name}](${repoUrl})`, inline: true },
                        { name: 'Branch', value: `\`${branchName}\``, inline: true },
                        { name: 'Pusher', value: payload.pusher.name || 'Unknown', inline: false },
                    ];
                } else {
                    embed.title = `⚙️ Push Event on ${branchName}`;
                    embed.url = payload.compare || repoUrl;
                    embed.fields = [
                        { name: 'Repository', value: `[${payload.repository.full_name}](${repoUrl})`, inline: true },
                        { name: 'Branch', value: `\`${branchName}\``, inline: true },
                        { name: 'Details', value: 'Push event with no commits.', inline: false },
                    ];
                }
                const sentMessage = await channel.send({ embeds: [embed] });
                
                // Store message info for logging (track the latest message sent)
                lastMessageInfo = {
                    channelId: channelId,
                    messageId: sentMessage.id
                };
                
                // Increment messagesSent counter
                try {
                  await prisma.server.update({
                    where: { id: serverConfig.id },
                    data: { messagesSent: { increment: 1 } },
                  });
                  // Messages sent counter incremented for push event
                } catch (dbError) {
                  console.error(`Failed to increment messagesSent for server ${serverConfig.id} after push event:`, dbError);
                }
            }
        } catch (err) {
            console.error(`Error sending push message to channel ${channelId}:`, err);
        }
    }
    // Return response with the last message info sent
    return { statusCode: 200, message: 'Push event processed for authenticated server.', ...lastMessageInfo };
  }

  async function handlePullRequestEvent(req, res, payload, prisma, botClient, repoContext) {
    const repoUrl = payload.repository.html_url;
    const action = payload.action;
    const pr = payload.pull_request;
    const serverConfig = repoContext.server;
    // Use the repository-specific notification channel
    const channelId = repoContext.notificationChannelId || 'pending';

    if (channelId === 'pending') return { statusCode: 200, message: 'PR event ack, channel pending.', channelId: null, messageId: null };

    try {
        // Check channel limits before sending notification
        const canSendNotification = await checkChannelLimitAndWarn(prisma, botClient, repoContext, channelId);
        
        if (!canSendNotification) {
            console.warn(`Skipping PR notification delivery to channel ${channelId} due to channel limit`);
            return { statusCode: 200, message: 'Pull request event acknowledged, but notification skipped due to channel limits.', channelId: null, messageId: null };
        }
        
        const channel = await botClient.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
            let emoji = '📋'; let color = 0x768390; let titleAction = action.charAt(0).toUpperCase() + action.slice(1);
            // ... (switch logic for emoji, color, titleAction from original)
            switch (action) {
                case 'opened': case 'reopened': emoji = '🔍'; color = 0x2DA44E; break;
                case 'closed': if (pr.merged) { emoji = '🟣'; color = 0x8957E5; titleAction = 'Merged'; } else { emoji = '❌'; color = 0xCF222E; } break;
                case 'synchronize': emoji = '📝'; color = 0x0969DA; titleAction = 'Updated'; break;
                case 'assigned': case 'unassigned': case 'review_requested': case 'review_request_removed': case 'labeled': case 'unlabeled': emoji = '🔔'; color = 0x0969DA; break;
            }

            const embed = {
                color: color,
                author: { name: pr.user.login, icon_url: pr.user.avatar_url, url: pr.user.html_url },
                title: `${emoji} Pull Request #${payload.number} ${titleAction}: ${pr.title}`,
                url: pr.html_url,
                fields: [
                    { name: 'Repository', value: `[${payload.repository.full_name}](${repoUrl})`, inline: false },
                    { name: 'Branches', value: `\`${pr.head.ref}\` → \`${pr.base.ref}\``, inline: true },
                    { name: 'State', value: pr.state.charAt(0).toUpperCase() + pr.state.slice(1), inline: true },
                ],
                timestamp: pr.updated_at || new Date().toISOString(),
                footer: { text: `GitHub Pull Request` }
            };
            // ... (rest of embed construction from original)
            if (pr.body) { let prBody = pr.body; if (prBody.length > 300) { prBody = prBody.substring(0, 297) + '...'; } embed.description = prBody; }
            if (action === 'closed' && pr.merged) { embed.fields.push({ name: 'Merged by', value: pr.merged_by.login, inline: true }); }
            if (action === 'assigned' && payload.assignee) { embed.description = `${pr.user.login} assigned ${payload.assignee.login}.`; }
            // ... (other action specific descriptions)

            const sentMessage = await channel.send({ embeds: [embed] });
            // Increment messagesSent counter
            try {
              await prisma.server.update({
                where: { id: serverConfig.id },
                data: { messagesSent: { increment: 1 } },
              });
              console.log(`Incremented messagesSent for server ${serverConfig.id} after PR event`);
            } catch (dbError) {
              console.error(`Failed to increment messagesSent for server ${serverConfig.id} after PR event:`, dbError);
            }
            
            return { statusCode: 200, message: 'Pull request event processed for authenticated server.', channelId: channelId, messageId: sentMessage.id };
        }
    } catch (err) { console.error(`Error sending PR message to channel ${channelId}:`, err); }
    return { statusCode: 200, message: 'Pull request event processed for authenticated server.', channelId: channelId, messageId: null };
  }

  async function handleIssuesEvent(req, res, payload, prisma, botClient, repoContext) {
    const repoUrl = payload.repository.html_url;
    const action = payload.action;
    const issue = payload.issue;
    const serverConfig = repoContext.server;
    // Use the repository-specific notification channel
    const channelId = repoContext.notificationChannelId || 'pending';

    if (channelId === 'pending') return { statusCode: 200, message: 'Issue event ack, channel pending.', channelId: null, messageId: null };

    try {
        // Check channel limits before sending notification
        const canSendNotification = await checkChannelLimitAndWarn(prisma, botClient, repoContext, channelId);
        
        if (!canSendNotification) {
            console.warn(`Skipping issue notification delivery to channel ${channelId} due to channel limit`);
            return { statusCode: 200, message: 'Issue event acknowledged, but notification skipped due to channel limits.', channelId: null, messageId: null };
        }
        
        const channel = await botClient.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
            let emoji = '📝'; let color = 0x0969DA; let titleAction = action.charAt(0).toUpperCase() + action.slice(1);
            // ... (switch logic for emoji, color from original)
            switch (action) { case 'opened': emoji = '🐛'; break; case 'closed': emoji = '✅'; color = 0x1A7F37; break; case 'reopened': emoji = '🔄'; break; }

            const embed = {
                color: color,
                author: { name: issue.user.login, icon_url: issue.user.avatar_url, url: issue.user.html_url },
                title: `${emoji} Issue #${issue.number} ${titleAction}: ${issue.title}`,
                url: issue.html_url,
                fields: [
                    { name: 'Repository', value: `[${payload.repository.full_name}](${repoUrl})`, inline: false },
                    { name: 'State', value: issue.state.charAt(0).toUpperCase() + issue.state.slice(1), inline: true },
                ],
                timestamp: issue.updated_at || new Date().toISOString(),
                footer: { text: `GitHub Issue` }
            };
            // ... (rest of embed construction from original)
            if (issue.body) { let issueBody = issue.body; if (issueBody.length > 300) { issueBody = issueBody.substring(0, 297) + '...'; } embed.description = issueBody; }
            if (issue.labels && issue.labels.length > 0) { embed.fields.push({ name: 'Labels', value: issue.labels.map(l => `\`${l.name}\``).join(', '), inline: true }); }
            // ... (other action specific descriptions)

            const sentMessage = await channel.send({ embeds: [embed] });
            // Increment messagesSent counter
            try {
              await prisma.server.update({
                where: { id: serverConfig.id },
                data: { messagesSent: { increment: 1 } },
              });
              console.log(`Incremented messagesSent for server ${serverConfig.id} after issue event`);
            } catch (dbError) {
              console.error(`Failed to increment messagesSent for server ${serverConfig.id} after issue event:`, dbError);
            }
            
            return { statusCode: 200, message: 'Issue event processed for authenticated server.', channelId: channelId, messageId: sentMessage.id };
        }
    } catch (err) { console.error(`Error sending issue message to channel ${channelId}:`, err); }
    return { statusCode: 200, message: 'Issue event processed for authenticated server.', channelId: channelId, messageId: null };
  }

  async function handleStarEvent(req, res, payload, prisma, botClient, repoContext) {
    if (payload.action !== 'created') return { statusCode: 200, message: 'Star event (unstarred) ack.', channelId: null, messageId: null };
    const repoUrl = payload.repository.html_url;
    const serverConfig = repoContext.server;
    // Use the repository-specific notification channel
    const channelId = repoContext.notificationChannelId || 'pending';

    if (channelId === 'pending') return { statusCode: 200, message: 'Star event ack, channel pending.', channelId: null, messageId: null };

    try {
        // Check channel limits before sending notification
        const canSendNotification = await checkChannelLimitAndWarn(prisma, botClient, repoContext, channelId);
        
        if (!canSendNotification) {
            console.warn(`Skipping star notification delivery to channel ${channelId} due to channel limit`);
            return { statusCode: 200, message: 'Star event acknowledged, but notification skipped due to channel limits.', channelId: null, messageId: null };
        }
        
        const channel = await botClient.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
            const embed = {
                color: 0xFFAC33,
                author: { name: payload.sender.login, icon_url: payload.sender.avatar_url, url: payload.sender.html_url },
                title: `⭐ New Star for ${payload.repository.name}!`,
                url: repoUrl,
                fields: [
                    { name: 'Repository', value: `[${payload.repository.full_name}](${repoUrl})`, inline: true },
                    { name: 'Total Stars', value: payload.repository.stargazers_count.toString(), inline: true },
                ],
                description: `${payload.sender.login} starred [${payload.repository.full_name}](${repoUrl}).`,
                timestamp: new Date().toISOString(),
                footer: { text: `GitHub Star Event` }
            };
                      const sentMessage = await channel.send({ embeds: [embed] });
          console.log(`Sent star notification to channel ${channelId} in guild ${serverConfig.guildId}`);

          // Increment messagesSent counter
          try {
            await prisma.server.update({
              where: { id: serverConfig.id },
              data: { messagesSent: { increment: 1 } },
            });
            console.log(`Incremented messagesSent for server ${serverConfig.id} after star event`);
          } catch (dbError) {
            console.error(`Failed to increment messagesSent for server ${serverConfig.id} after star event:`, dbError);
          }
          
          // Return message info for logging
          return { statusCode: 200, message: 'Star event processed for authenticated server.', channelId: channelId, messageId: sentMessage.id };
        }
    } catch (err) { console.error(`Error sending star message to channel ${channelId}:`, err); }
    return { statusCode: 200, message: 'Star event processed for authenticated server.', channelId: null, messageId: null };
  }

  async function handleReleaseEvent(req, res, payload, prisma, botClient, repoContext) {
    if (payload.action !== 'published' && payload.action !== 'released') return { statusCode: 200, message: 'Release event not handled.', channelId: null, messageId: null };
    const repoUrl = payload.repository.html_url;
    const release = payload.release;
    const serverConfig = repoContext.server;
    // Use the repository-specific notification channel
    const channelId = repoContext.notificationChannelId || 'pending';

    if (channelId === 'pending') return { statusCode: 200, message: 'Release event ack, channel pending.', channelId: null, messageId: null };

    try {
        // Check channel limits before sending notification
        const canSendNotification = await checkChannelLimitAndWarn(prisma, botClient, repoContext, channelId);
        
        if (!canSendNotification) {
            console.warn(`Skipping release notification delivery to channel ${channelId} due to channel limit`);
            return { statusCode: 200, message: 'Release event acknowledged, but notification skipped due to channel limits.', channelId: null, messageId: null };
        }
        
        const channel = await botClient.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
            const emoji = release.prerelease ? '🚧' : '🚀';
            const embed = {
                color: 0xA371F7,
                author: { name: release.author.login, icon_url: release.author.avatar_url, url: release.author.html_url },
                title: `${emoji} New ${release.prerelease ? 'Pre-release' : 'Release'}: ${release.name || release.tag_name}`,
                url: release.html_url,
                fields: [
                    { name: 'Repository', value: `[${payload.repository.full_name}](${repoUrl})`, inline: false },
                    { name: 'Tag', value: `\`${release.tag_name}\``, inline: true },
                ],
                timestamp: release.published_at || new Date().toISOString(),
                footer: { text: `GitHub Release` }
            };
            if (release.body) { let body = release.body; if (body.length > 1500) body = body.substring(0, 1497) + '...'; embed.description = body; }
            const sentMessage = await channel.send({ embeds: [embed] });
            console.log(`Sent release notification to channel ${channelId} in guild ${serverConfig.guildId}`);

            // Increment messagesSent counter
            try {
              await prisma.server.update({
                where: { id: serverConfig.id },
                data: { messagesSent: { increment: 1 } },
              });
              console.log(`Incremented messagesSent for server ${serverConfig.id} after release event`);
            } catch (dbError) {
              console.error(`Failed to increment messagesSent for server ${serverConfig.id} after release event:`, dbError);
            }
            
            return { statusCode: 200, message: 'Release event processed for authenticated server.', channelId: channelId, messageId: sentMessage.id };
        }
    } catch (err) { console.error(`Error sending release message to channel ${channelId}:`, err); }
    return { statusCode: 200, message: 'Release event processed for authenticated server.', channelId: channelId, messageId: null };
  }

  async function handleForkEvent(req, res, payload, prisma, botClient, repoContext) {
    const repoUrl = payload.repository.html_url;
    const forkeeRepo = payload.forkee;
    const serverConfig = repoContext.server;
    // Use the repository-specific notification channel
    const channelId = repoContext.notificationChannelId || 'pending';

    if (channelId === 'pending') return { statusCode: 200, message: 'Fork event ack, channel pending.', channelId: null, messageId: null };

    try {
        // Check channel limits before sending notification
        const canSendNotification = await checkChannelLimitAndWarn(prisma, botClient, repoContext, channelId);
        
        if (!canSendNotification) {
            console.warn(`Skipping fork notification delivery to channel ${channelId} due to channel limit`);
            return { statusCode: 200, message: 'Fork event acknowledged, but notification skipped due to channel limits.', channelId: null, messageId: null };
        }
        
        const channel = await botClient.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
            const embed = {
                color: 0x6F42C1,
                author: { name: payload.sender.login, icon_url: payload.sender.avatar_url, url: payload.sender.html_url },
                title: '🍴 Repository Forked',
                description: `[${payload.repository.full_name}](${repoUrl}) was forked by ${payload.sender.login} to [${forkeeRepo.full_name}](${forkeeRepo.html_url}).`,
                fields: [
                    { name: 'Source Repository', value: `[${payload.repository.full_name}](${repoUrl})`, inline: true },
                    { name: 'New Fork', value: `[${forkeeRepo.full_name}](${forkeeRepo.html_url})`, inline: true },
                ],
                timestamp: forkeeRepo.created_at || new Date().toISOString(),
                footer: { text: 'GitHub Fork Event' }
            };
            const sentMessage = await channel.send({ embeds: [embed] });
            console.log(`Sent fork notification to channel ${channelId} in guild ${serverConfig.guildId}`);

            // Increment messagesSent counter
            try {
              await prisma.server.update({
                where: { id: serverConfig.id },
                data: { messagesSent: { increment: 1 } },
              });
              console.log(`Incremented messagesSent for server ${serverConfig.id} after fork event`);
            } catch (dbError) {
              console.error(`Failed to increment messagesSent for server ${serverConfig.id} after fork event:`, dbError);
            }
            
            return { statusCode: 200, message: 'Fork event processed for authenticated server.', channelId: channelId, messageId: sentMessage.id };
        }
    } catch (err) { console.error(`Error sending fork message to channel ${channelId}:`, err); }
    return { statusCode: 200, message: 'Fork event processed for authenticated server.', channelId: channelId, messageId: null };
  }

  async function handleCreateEvent(req, res, payload, prisma, botClient, repoContext) {
    const repoUrl = payload.repository.html_url;
    const refType = payload.ref_type;
    const refName = payload.ref;
    const serverConfig = repoContext.server;
    // For create events (new branch/tag), use the repository-specific notification channel
    // The validatedRepositoryContext ensures we are in the right server and repository context.
    const channelId = repoContext.notificationChannelId || 'pending';

    if (channelId === 'pending') return { statusCode: 200, message: 'Create event ack, channel pending.', channelId: null, messageId: null };

    // Additional check: if it's a branch, only send if a wildcard ('*') is tracked for this repo on this server,
    // or if the specific branch being created was pre-emptively tracked (less common for 'create').
    // For simplicity here, we'll rely on the server default channel for create events, assuming admins want to know about new branches/tags.
    // More complex filtering could be added if needed (e.g., checking TrackedBranch for '*').

    try {
        // Check channel limits before sending notification
        const canSendNotification = await checkChannelLimitAndWarn(prisma, botClient, repoContext, channelId);
        
        if (!canSendNotification) {
            console.warn(`Skipping create event notification delivery to channel ${channelId} due to channel limit`);
            return { statusCode: 200, message: 'Create event acknowledged, but notification skipped due to channel limits.', channelId: null, messageId: null };
        }
        
        const channel = await botClient.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
            const emoji = refType === 'branch' ? '🌱' : '🏷️';
            const color = refType === 'branch' ? 0x4F46E5 : 0x6A737D;
            const embed = {
                color: color,
                author: { name: payload.sender.login, icon_url: payload.sender.avatar_url, url: payload.sender.html_url },
                title: `${emoji} New ${refType} Created: ${refName}`,
                url: `${repoUrl}/tree/${encodeURIComponent(refName)}`,
                fields: [
                    { name: 'Repository', value: `[${payload.repository.full_name}](${repoUrl})`, inline: false },
                    { name: (refType.charAt(0).toUpperCase() + refType.slice(1)), value: `\`${refName}\``, inline: true },
                    { name: 'Created by', value: payload.sender.login, inline: true },
                ],
                timestamp: new Date().toISOString(),
                footer: { text: `GitHub ${refType.charAt(0).toUpperCase() + refType.slice(1)} Creation` }
            };
            if (refType === 'branch') {
              embed.description = `To track this branch specifically, use:\n\`/link ${repoUrl} ${refName} #channel\``;
            }
            const sentMessage = await channel.send({ embeds: [embed] });
            console.log(`Sent create notification to channel ${channelId} in guild ${serverConfig.guildId}`);

            // Increment messagesSent counter
            try {
              await prisma.server.update({
                where: { id: serverConfig.id },
                data: { messagesSent: { increment: 1 } },
              });
              console.log(`Incremented messagesSent for server ${serverConfig.id} after create event`);
            } catch (dbError) {
              console.error(`Failed to increment messagesSent for server ${serverConfig.id} after create event:`, dbError);
            }
            
            return { statusCode: 200, message: 'Create event processed for authenticated server.', channelId: channelId, messageId: sentMessage.id };
        }
    } catch (err) { console.error(`Error sending create message to channel ${channelId}:`, err); }
    return { statusCode: 200, message: 'Create event processed for authenticated server.', channelId: channelId, messageId: null };
  }

  async function handleDeleteEvent(req, res, payload, prisma, botClient, repoContext) {
    const repoUrl = payload.repository.html_url;
    const refType = payload.ref_type;
    const refName = payload.ref;
    const serverConfig = repoContext.server;
    // Use the repository-specific notification channel
    const channelId = repoContext.notificationChannelId || 'pending';

    if (channelId === 'pending') return { statusCode: 200, message: 'Delete event ack, channel pending.', channelId: null, messageId: null };

    try {
        // Check channel limits before sending notification
        const canSendNotification = await checkChannelLimitAndWarn(prisma, botClient, repoContext, channelId);
        
        if (!canSendNotification) {
            console.warn(`Skipping delete event notification delivery to channel ${channelId} due to channel limit`);
            return { statusCode: 200, message: 'Delete event acknowledged, but notification skipped due to channel limits.', channelId: null, messageId: null };
        }
        
        const channel = await botClient.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
            const emoji = '🗑️'; 
            const color = 0xCF222E;
            const embed = {
                color: color,
                author: { name: payload.sender.login, icon_url: payload.sender.avatar_url, url: payload.sender.html_url },
                title: `${emoji} ${refType.charAt(0).toUpperCase() + refType.slice(1)} Deleted: ${refName}`,
                url: repoUrl,
                fields: [
                    { name: 'Repository', value: `[${payload.repository.full_name}](${repoUrl})`, inline: false },
                    { name: (refType.charAt(0).toUpperCase() + refType.slice(1)), value: `\`${refName}\``, inline: true },
                    { name: 'Deleted by', value: payload.sender.login, inline: true },
                ],
                timestamp: new Date().toISOString(),
                footer: { text: `GitHub ${refType.charAt(0).toUpperCase() + refType.slice(1)} Deletion` }
            };
            const sentMessage = await channel.send({ embeds: [embed] });
            console.log(`Sent delete notification to channel ${channelId} in guild ${serverConfig.guildId}`);

            // Increment messagesSent counter
            try {
              await prisma.server.update({
                where: { id: serverConfig.id },
                data: { messagesSent: { increment: 1 } },
              });
              console.log(`Incremented messagesSent for server ${serverConfig.id} after delete event`);
            } catch (dbError) {
              console.error(`Failed to increment messagesSent for server ${serverConfig.id} after delete event:`, dbError);
            }
            
            return { statusCode: 200, message: 'Delete event processed for authenticated server.', channelId: channelId, messageId: sentMessage.id };
        }
    } catch (err) { console.error(`Error sending delete message to channel ${channelId}:`, err); }
    return { statusCode: 200, message: 'Delete event processed for authenticated server.', channelId: channelId, messageId: null };
  }

  async function handlePingEvent(req, res, payload, prisma, botClient, repoContext) {
    const repoUrl = payload.repository.html_url;
    const serverConfig = repoContext.server;
    // Use the repository-specific notification channel
    const channelId = repoContext.notificationChannelId || 'pending';

    if (channelId === 'pending') {
        console.warn(`Ping event for ${repoUrl}, but repository notification channel is pending.`);
        return { statusCode: 200, message: 'Ping event ack, channel pending.', channelId: null, messageId: null };
    }

    try {
      // Check channel limits before sending notification
      // For ping events, we'll always send the notification with a warning if needed, but won't block
      const canSendNotification = await checkChannelLimitAndWarn(prisma, botClient, repoContext, channelId);
      
      // Always continue with ping events to ensure webhook setup works
      
      const channel = await botClient.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        const embed = {
          color: 0x36A64F,
          author: {
            name: payload.sender.login, // User who triggered/owns the webhook
            icon_url: payload.sender.avatar_url,
            url: payload.sender.html_url
          },
          title: '🔗 Webhook Ping Received',
          description: `Successfully received a ping event from GitHub for repository [${payload.repository.full_name}](${repoUrl}).\nYour webhooks are set up correctly for this server! 🎉`,
          fields: [
            { name: 'Repository', value: `[${payload.repository.full_name}](${repoUrl})`, inline: true },
            { name: 'Zen', value: payload.zen || 'Connection successful!', inline: true },
          ],
          timestamp: new Date().toISOString(),
          footer: { text: 'GitHub Ping Event' },
        };
        await channel.send({ embeds: [embed] });
        console.log(`Sent ping confirmation to channel ${channelId} for repository ${repoUrl} on server ${serverConfig.guildId}`);


        const instructionsEmbed = {
          color: 0x36A64F,
          title: '📋 How to Track your Branches',
          description: 'Now that your webhook is set up, you can link specific branches to receive notifications:',
          fields: [
            { 
              name: '🌿 Link a specific branch', 
              value: `\`/link repo-url branch #channel\`\nReplace \`branch\` with your branch name and \`#channel\` with your desired channel.`, 
              inline: false 
            },
            { 
              name: '🌟 Link all branches (wildcard)', 
              value: `\`/link repo-url * #channel\`\nUse \`*\` to track all branches in the repository.`, 
              inline: false 
            },
            { 
              name: '📖 Need help?', 
              value: 'Use `/help` to see all available commands and their usage.', 
              inline: false 
            }
          ],
          footer: { text: 'GitTrack - Branch Linking Guide' },
        };
        await channel.send({ embeds: [instructionsEmbed] });
        console.log(`Sent branch linking instructions to channel ${channelId} for repository ${repoUrl} on server ${serverConfig.guildId}`);


        // Increment messagesSent counter for both events
        try {
          await prisma.server.update({
            where: { id: serverConfig.id },
            data: { messagesSent: { increment: 2 } },
          });
          console.log(`Incremented messagesSent by 2 for server ${serverConfig.id} after ping event`);
        } catch (dbError) {
          console.error(`Failed to increment messagesSent for server ${serverConfig.id} after ping event:`, dbError);
        }
      }
    } catch (err) {
      console.error(`Error sending ping confirmation to channel ${channelId}:`, err);
    }
    return { statusCode: 200, message: 'Ping event processed for authenticated server.', channelId: channelId, messageId: null };
  }

  return app;
}

// Helper function to try notifying Discord about content type errors
async function tryNotifyContentTypeError(req, prisma, botClient) {
  try {
    // When GitHub sends form-urlencoded, we need to parse the payload from the raw body
    let repoUrl = null;
    

    
    // Parse the form-urlencoded data manually from raw body
    if (req.rawBody && req.rawBody.includes('payload=')) {
      try {
        // Parse the form-urlencoded data properly
        const parsed = querystring.parse(req.rawBody);
        

        
        if (parsed.payload) {
          // Parse the JSON payload to get repository info
          const parsedPayload = JSON.parse(parsed.payload);
          if (parsedPayload.repository && parsedPayload.repository.html_url) {
            repoUrl = parsedPayload.repository.html_url;
          }

        }
      } catch (e) {

      }
    }
    
    if (!repoUrl || !req.rawBody) {
      console.log('Could not extract repository URL or raw body from malformed webhook for Discord notification');

      return;
    }
    
    // Get signature for validation (same as main webhook handler)
    const signature = req.headers['x-hub-signature-256'];
    if (!signature) {
      console.log('No signature found in malformed webhook request');
      return;
    }
    
    // Find all candidate repositories (same logic as main webhook handler)
    const possibleUrls = [repoUrl];
    if (repoUrl.endsWith('.git')) {
      possibleUrls.push(repoUrl.slice(0, -4));
    } else {
      possibleUrls.push(repoUrl + '.git');
    }
    
    const candidateRepositories = await prisma.repository.findMany({
      where: { url: { in: possibleUrls } },
      include: { server: true }
    });
    
    if (!candidateRepositories || candidateRepositories.length === 0) {
      console.log(`No repositories found for ${repoUrl} in content type error notification`);
      return;
    }
    
    // Validate signature to find the correct repository/server (same logic as main webhook handler)
    let validatedRepository = null;
    

    
    for (const repoEntry of candidateRepositories) {
      const secretToUse = repoEntry.webhookSecret || process.env.GITHUB_WEBHOOK_SECRET;
      if (!secretToUse) {

        continue;
      }
      
      
      
      const signaturePrefix = 'sha256=';
              if (!signature.startsWith(signaturePrefix)) {
          continue;
        }
      
      const providedSignature = signature.substring(signaturePrefix.length);
      const hmac = crypto.createHmac('sha256', secretToUse);
      hmac.update(req.rawBody); // Use the raw request body for signature validation
      const expectedSignature = hmac.digest('hex');
      
      
      
              if (
          Buffer.from(providedSignature, 'hex').length === Buffer.from(expectedSignature, 'hex').length &&
          crypto.timingSafeEqual(Buffer.from(providedSignature, 'hex'), Buffer.from(expectedSignature, 'hex'))
        ) {
          validatedRepository = repoEntry;
          break;
        }
    }
    
    if (!validatedRepository) {
      console.log(`No validated repository found for ${repoUrl} in content type error notification`);
      return;
    }
    
    // Send notification to the validated repository's channel
    if (validatedRepository.notificationChannelId && validatedRepository.notificationChannelId !== 'pending') {
      const channel = await botClient.channels.fetch(validatedRepository.notificationChannelId);
      if (channel && channel.isTextBased()) {
        const embed = {
          color: 0xFF4444,
          title: '⚠️ Webhook Configuration Error',
          description: `There's an issue with your GitHub webhook configuration for repository [${repoUrl.split('/').slice(-2).join('/')}](${repoUrl}).`,
          fields: [
            {
              name: '❌ Problem',
              value: 'Your webhook is set to send **application/x-www-form-urlencoded** data instead of **application/json**.',
              inline: false
            },
            {
              name: '🔧 How to Fix',
              value: `1. Go to your [repository webhook settings](${repoUrl}/settings/hooks)\n2. Click "Edit" on your GitTrack webhook\n3. Change "Content type" from "application/x-www-form-urlencoded" to **"application/json"**\n4. Click "Update webhook"`,
              inline: false
            },
            {
              name: '📝 Note',
              value: 'Your webhook notifications won\'t work until this is fixed.',
              inline: false
            }
          ],
          footer: { text: 'GitTrack Configuration Error' },
          timestamp: new Date().toISOString()
        };
        
        await channel.send({ embeds: [embed] });
        console.log(`Sent content type error notification for ${repoUrl} to channel ${validatedRepository.notificationChannelId} on server ${validatedRepository.server.guildId}`);
      }
    }
  } catch (error) {
    console.error('Error trying to notify about content type error:', error);
  }
}

// Helper function to check channel limits and send warnings if needed
async function checkChannelLimitAndWarn(prisma, botClient, repoContext, channelId) {
  try {
    // Get repo default channel for reference
    const repoDefaultChannel = repoContext.notificationChannelId;
    
    // Don't skip default channels - they should be counted if used explicitly for branch tracking
    // (that logic is handled in the checkChannelLimit function)
    
    const serverConfig = repoContext.server;
    const { isAtLimit, currentCount, maxAllowed } = await checkChannelLimit(
      prisma,
      serverConfig.id,
      null, // Don't exclude any channels
      null  // Don't include any new channels
    );

    // Only warn if at or exceeding limit
    if (isAtLimit) {
      // Try to send warning to the channel that's being used
      try {
        const channel = await botClient.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
          // Send warning message
          await channel.send({
            embeds: [{
              color: 0xFF9800, // Warning orange
              title: '⚠️ Channel Limit Warning',
              description: `This server is using ${currentCount} distinct channels for branch notifications, which exceeds the configured limit of ${maxAllowed} channels.\n\nA channel is counted when it's used explicitly for branch notifications, even if it's also a repository default channel.\n\nTo ensure all webhook notifications are delivered properly, please:\n• Consolidate branch notifications to fewer channels\n• Use \`/unlink\` to remove unneeded branch-channel links\n• Or contact an administrator to increase the limit`,
              footer: { text: 'GitTrack Notification Limit' }
            }]
          });
          
          console.log(`Sent channel limit warning to channel ${channelId} in guild ${serverConfig.guildId}`);

          // Return true to still attempt delivery despite warning
          return true;
        }
      } catch (err) {
        console.error(`Error sending channel limit warning to ${channelId}:`, err);
      }

      // Log that we're exceeding the limit
      console.warn(`Server ${serverConfig.guildId} is exceeding the channel limit (${currentCount}/${maxAllowed}). Some notifications may not be delivered.`);
      return false; // Don't deliver the notification as we're at the limit
    }

    return true; // Not at limit, allow delivery
  } catch (error) {
    console.error('Error checking channel limits:', error);
    return true; // In case of error, default to allowing notifications
  }
}



// Helper function to handle events with error logging
async function handleEventWithLogging(handler, req, res, payload, prisma, botClient, repoContext, loggingContext) {
  const { startTime, event, action } = loggingContext;
  let result;
  let channelId = null;
  let messageId = null;
  let errorMessage = null;
  let responseSent = false;
  
  // Helper function to send response only once
  const sendResponse = (statusCode, message) => {
    if (responseSent) {
      console.warn(`Attempted to send response twice for ${event} event. Response already sent.`);
      return;
    }
    responseSent = true;
    return res.status(statusCode).send(message);
  };
  
  try {
    result = await handler(req, res, payload, prisma, botClient, repoContext);
    
    // Extract channelId and messageId from result if handler returns them
    if (result && typeof result === 'object') {
      channelId = result.channelId || null;
      messageId = result.messageId || null;
    }
    
    // Send the HTTP response based on the handler result
    let responseMessage = 'Event processed successfully';
    let responseCode = 200;
    
    if (result && result.statusCode && result.message) {
      responseCode = result.statusCode;
      responseMessage = result.message;
    }
    
    // Send response immediately to avoid any race conditions
    const responsePromise = sendResponse(responseCode, responseMessage);
    
    // No need to log successful webhook events to reduce database load
    
    return responsePromise;
  } catch (error) {
    console.error(`Error in ${event} handler:`, error);
    errorMessage = error.message;
    
    // Send error response immediately
    const responsePromise = sendResponse(500, 'Webhook processing failed');
    
    // Log error to ErrorLog for debugging
    try {
      await prisma.errorLog.create({
        data: {
          serverId: repoContext.server.id,
          level: 'ERROR',
          message: `Webhook processing failed for ${event} event`,
          stack: error.stack,
          context: {
            eventType: event,
            action: action,
            processingTime: Date.now() - startTime,
            userAgent: req.headers['user-agent'],
            sourceIp: req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
          },
          source: 'webhook',
        }
      });
    } catch (logError) {
      console.error('Failed to log webhook error:', logError);
    }
    
    // Also log the error to ErrorLog table (async, non-blocking)
    prisma.errorLog.create({
      data: {
        serverId: repoContext.server.id,
        level: 'ERROR',
        message: `Webhook ${event} handler failed: ${error.message}`,
        stack: error.stack,
        source: 'webhook',
        context: {
          event: event,
          action: action,
          repository: repoContext.url,
          processingTime: Date.now() - startTime,
        }
      }
    }).catch(logError => {
      console.error('Failed to log error:', logError);
    });
    
    return responsePromise;
  }
}

module.exports = { initializeWebServer };
