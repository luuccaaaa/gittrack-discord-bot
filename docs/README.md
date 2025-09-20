# GitTrack Bot Documentation Hub

This directory gathers the developer-facing documentation for the GitTrack Discord bot. Use it as the first stop when you need to understand how the project is wired together or how to contribute changes.

## Document Index

- **[Project Overview](../README.md)** – High-level introduction, feature tour, and end-user setup.
- **[Contributing Guide](CONTRIBUTING.md)** – Contribution workflow, coding standards, and pull request expectations.
- **[Branch Patterns Reference](BRANCH_PATTERNS.md)** – Detailed guidance on configuring branch wildcards with `/link`.

## Architecture Overview

GitTrack runs as a single Node.js process that authenticates with Discord, exposes an Express webhook endpoint, and persists state via Prisma/PostgreSQL.

- `src/index.js` boots the Prisma client, logs the bot in, and starts the webhook server.
- `src/bot.js` loads slash commands, registers them with Discord, and routes interactions after performing permission checks.
- `src/handlers/` contains the GitHub webhook router (`webhookHandler.js`) plus specialised modules for checks, workflow, and pull-request events.
- `src/functions/` hosts reusable helpers such as branch matching, permission checks, and configurable limits.
- `prisma/` defines the data model (`Server`, `Repository`, `TrackedBranch`, `RepositoryEventChannel`, logging tables) and migrations.
- `docker/` and `scripts/` provide Docker Compose definitions and the deployment helper script.

```
Bot/
├── src/
│   ├── index.js              # Entry point – boots Discord bot and webhook server
│   ├── bot.js                # Discord client initialisation and command routing
│   ├── commands/             # Slash command implementations
│   ├── handlers/             # GitHub webhook handlers
│   └── functions/            # Shared helpers (limits, permissions, branch matching)
├── prisma/                   # Prisma schema and generated client
├── docker/                   # Docker and Docker Compose manifests
├── scripts/                  # Utility scripts (deploy.sh, etc.)
└── docs/                     # Developer documentation (this directory)
```

## Development Workflow

1. Copy `.env.example` to `.env` and populate the Discord, database, and webhook values.
2. Run `./scripts/deploy.sh` to build the containers and launch PostgreSQL, Prisma Studio, and the bot.
3. Alternatively, manage the stack manually with `docker-compose -f docker/docker-compose.dev.yml up -d`.
4. If you update the Prisma schema, run `npx prisma db push` (and optionally `npx prisma generate`) inside the bot container to sync the database before restarting services.

## Additional Resources

- Health check endpoint: `GET /health` for uptime monitoring.
- Message metrics endpoint: `GET /api/message-counts` for per-server delivery stats.
- For questions or support, see the channels listed at the bottom of the main README (or drop by the [GitTrack Community Discord](https://discord.gg/4GNcUDNbsC)).
