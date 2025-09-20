# GitTrack Discord Bot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Discord.js](https://img.shields.io/badge/Discord.js-14+-blue.svg)](https://discord.js.org/)

GitTrack is an open-source Discord bot that monitors GitHub repository activity and sends real-time notifications to your Discord server. It's designed to help development teams stay informed about code changes, pull requests, issues, and other repository events.

## 🚀 **Try GitTrack for Free!**

**GitTrack is available as a hosted service at [gittrack.me](https://gittrack.me) - completely free!**

<a href="https://discord.com/api/oauth2/authorize?client_id=1373397506909798410&permissions=277025392640&scope=bot%20applications.commands" target="_blank">
  <img src="https://img.shields.io/badge/Discord-Add%20to%20Server-7289DA?style=for-the-badge&logo=discord&logoColor=white" alt="Add to Discord" />
</a>

Also you're free to self-host, customize, contribute, or deploy on your own infrastructure.

## ✨ Features

- **Real-time GitHub notifications** - Push events, pull requests, issues, releases, and more
- **Flexible branch tracking** - Monitor specific branches or whole prefixes with wildcard patterns
- **Channel routing** - Route notifications to different Discord channels (per branch and per event)
- **Event filters** - Toggle issue, pull-request, and other event actions directly from Discord
- **Webhook security** - Secure webhook handling with signature verification
- **Configurable limits** - Customize repository and channel limits via environment variables
- **Operational insights** - Built-in health and delivery metrics endpoints for monitoring
- **Modern tech stack** - Discord.js 14, Prisma, PostgreSQL
- **Docker support** - Easy deployment with Docker and Docker Compose

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- Discord Bot Token & Client ID
- PostgreSQL connection details (the provided Compose stack spins one up automatically)
- A public URL (e.g., via ngrok) if GitHub needs to reach your local machine

### Deploy with Docker

1. Clone and configure the project:
   ```bash
   git clone https://github.com/luuccaaaa/gittrack-discord-bot.git
   cd gittrack-discord-bot
   cp .env.example .env
   # Edit .env with your configuration
   ```
2. Run the deployment script:
   ```bash
   ./scripts/deploy.sh
   ```

The script validates your `.env`, builds the containers, and starts PostgreSQL, Prisma Studio, and the bot. Prefer to manage containers manually? Use `docker-compose -f docker/docker-compose.dev.yml up -d`.



## 📋 Bot Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/setup` | Configure a GitHub repository | `/setup repository:https://github.com/user/repo [channel:#notifications]` |
| `/link` | Link repository to branch/channel | `/link url:https://github.com/user/repo branch:main channel:#notifications` |
| `/unlink` | Remove linked repository | `/unlink url:https://github.com/user/repo branch:main channel:#notifications` |
| `/remove-repo` | Remove repository from tracking | `/remove-repo url:https://github.com/user/repo` |
| `/set-default-channel` | Set default notification channel | `/set-default-channel repository:https://github.com/user/repo channel:#notifications` |
| `/set-event-channel` | Route a non-branch event to a channel | `/set-event-channel repository:<repo> event:issues channel:#notifications` |
| `/remove-event-channel` | Remove an event-to-channel override | `/remove-event-channel repository:<repo> event:issues` |
| `/edit-event` | Configure event filters (issues, PRs, etc.) | `/edit-event repository:<repo> event:issues` |
| `/status` | Check server configuration and limits | `/status` |
| `/reset` | Reset all bot data (Admin only) | `/reset confirm:true` |
| `/ping` | Check if bot is responsive | `/ping` |
| `/help` | Display help information | `/help` |

## 🔧 Configuration

### Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create application → Bot section → Copy token & client ID
3. Enable permissions: Send Messages, Use Slash Commands, Read Message History

### GitHub Webhook Setup

1. **Run setup command**: `/setup repository:https://github.com/user/repo`
2. **Configure webhook on GitHub** with provided URL and secret
3. **Link branches**: `/link url:https://github.com/user/repo branch:main channel:#notifications`

### Webhook URLs

| Environment | URL Format |
|-------------|------------|
| **Docker Development** | `https://your-ngrok-url.ngrok.io/github-webhook` |
| **Production** | `https://yourdomain.com/github-webhook` |

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DISCORD_TOKEN` | Discord bot token | Yes | - |
| `CLIENT_ID` | Discord bot client ID | Yes | - |
| `DATABASE_URL` | PostgreSQL connection string | Yes | - |
| `WEBHOOK_URL` | Fully qualified webhook URL (overrides `PUBLIC_URL`) | No | Derived from `PUBLIC_URL` |
| `PUBLIC_URL` | Public base URL (used when `WEBHOOK_URL` is not set) | No | - (required if `WEBHOOK_URL` is unset) |
| `PORT` | Local port for the Express webhook server | No | 3000 |
| `MAX_REPOS_ALLOWED` | Max repositories per server | No | 10 |
| `MAX_NOTIFICATION_CHANNELS_ALLOWED` | Max distinct branch notification channels | No | Unlimited |
| `GITHUB_TOKEN` | Enables branch autocomplete for private repositories | No | Not set |




## 🏗️ Architecture

```
Bot/
├── src/
│   ├── index.js              # Entry point – boots Prisma, Discord client, and Express server
│   ├── bot.js                # Discord client initialisation and slash-command routing
│   ├── commands/             # Slash command definitions (/setup, /link, /status, ...)
│   ├── handlers/
│   │   ├── webhookHandler.js # GitHub webhook router and validation
│   │   ├── checksHandlers.js
│   │   ├── milestoneAndWorkflowHandlers.js
│   │   └── pullRequestHandlers.js
│   └── functions/
│       ├── branchMatcher.js
│       ├── limitChecker.js
│       └── permissionChecker.js
├── prisma/
│   ├── schema.prisma         # Data model (Server, Repository, TrackedBranch, RepositoryEventChannel, logs)
│   └── init.sql
├── docker/                   # Docker Compose definitions
├── scripts/                  # Utility scripts (deploy.sh, etc.)
├── dashboard-ui/             # Placeholder for dashboard experiments
├── config/                   # Local tooling configuration (nodemon.json)
└── docs/                     # Developer documentation
```

### Key Components

- **Discord Bot** (`src/bot.js`) – Loads slash commands, registers them globally, and executes actions after permission checks.
- **Express Webhook Server** (`src/handlers/webhookHandler.js`) – Validates GitHub signatures, routes events, and records errors/system logs.
- **Event Routing** (`src/commands/set-event-channel.js`, `src/commands/edit-event.js`) – Lets admins configure per-event channels and action filters directly from Discord.
- **Limit Management** (`src/functions/limitChecker.js`) – Enforces repository/channel caps using environment variables and surfaces status via `/status`.
- **Data Persistence** (`prisma/schema.prisma`) – PostgreSQL models for servers, repositories, tracked branches, event channels, and logging.
- **Observability** – `GET /health` for uptime checks and `GET /api/message-counts` for delivery metrics.

## 🤝 Contributing

We welcome contributions! Please read the updated [Contributing Guide](docs/CONTRIBUTING.md) for the full workflow, coding standards, and pull-request checklist. Highlights:

- Use feature branches and Conventional Commits (e.g., `feat:`, `fix:`, `docs:`).
- Keep slash commands and documentation in sync with behavioural changes.
- Verify changes by running the container stack (`./scripts/deploy.sh` or `docker-compose -f docker/docker-compose.dev.yml up`).
- Push Prisma schema changes with `npx prisma db push` and regenerate the client when you modify the data model.

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/luuccaaaa/gittrack-discord-bot/issues)
- **Email**: support@gittrack.me
- **Community Discord**: [Join the GitTrack server](https://discord.gg/4GNcUDNbsC)

## 🙏 Acknowledgments

- [Discord.js](https://discord.js.org/) - Discord API wrapper
- [Prisma](https://www.prisma.io/) - Database toolkit
- [GitHub Webhooks](https://docs.github.com/en/developers/webhooks-and-events) - Event system

---

Made with ❤️ by the GitTrack Team
