// Resolve channel and config for non-branch events with per-event override
async function getEventRouting(prisma, repositoryId, eventType, fallbackChannelId) {
    try {
        let mapping = await prisma.repositoryEventChannel.findFirst({
            where: { repositoryId, eventType }
        });

        const defaultActions = getDefaultActionsForEvent(eventType);

        // Auto-create a default mapping/config if missing to avoid silent skips
        if (!mapping) {
            const defaultConfig = { actionsEnabled: defaultActions, explicitChannel: false };
            mapping = await prisma.repositoryEventChannel.create({
                data: {
                    repositoryId,
                    eventType,
                    channelId: 'default',
                    config: defaultConfig
                }
            });
        }

        // Merge default actions with existing config to ensure new actions have defaults
        // User-configured values take precedence over defaults
        const existingActions = (mapping.config && mapping.config.actionsEnabled) || {};
        const mergedActions = { ...defaultActions, ...existingActions };
        const mergedConfig = {
            ...mapping.config,
            actionsEnabled: mergedActions
        };

        // Resolve effective channel:
        // - If channelId is the 'default' sentinel, use fallback
        // - If channelId matches fallback and not explicitly set, treat as default
        // - Otherwise use the stored channelId
        const explicit = mapping.config && mapping.config.explicitChannel === true;
        const effectiveChannelId = (mapping.channelId === 'default' || (!explicit && mapping.channelId === fallbackChannelId))
            ? (fallbackChannelId || 'pending')
            : (mapping.channelId || fallbackChannelId || 'pending');

        return { channelId: effectiveChannelId, config: mergedConfig };
    } catch (e) {
        console.error('getEventRouting error:', e);
        return { channelId: fallbackChannelId || 'pending', config: null };
    }
}

function getDefaultActionsForEvent(eventType) {
    // Sensible defaults: enable common actions; comments disabled by default
    switch (eventType) {
        case 'issues':
            return { opened: true, closed: true, reopened: true, edited: true, labeled: true, assigned: true, comments: false };
        case 'pull_request':
            return { opened: true, closed: true, reopened: true, comments: false };
        case 'release':
            return { published: true };
        case 'star':
            return { created: true, deleted: true };
        case 'fork':
            return { created: true };
        case 'create':
            return { created: true };
        case 'delete':
            return { deleted: true };
        case 'milestone':
            return { created: true, opened: true, closed: true };
        case 'ping':
            return { ping: true };
        case 'workflow_run':
            return { completed: true, requested: false };
        case 'workflow_job':
            return { queued: false, in_progress: false, completed: true, waiting: false };
        case 'check_run':
            return { created: false, requested: false, rerequested: false, completed: true };
        case 'check_suite':
            return { requested: false, rerequested: false, completed: true };
        default:
            return {}; // Unknown events get empty config
    }
}

module.exports = {
    getEventRouting,
    getDefaultActionsForEvent
};
