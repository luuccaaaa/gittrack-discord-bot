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

**Why self-host?** This codebase is completely open source. You're free to self-host, customize, contribute, or deploy on your own infrastructure.

## ✨ Features

- **Real-time GitHub notifications** - Push events, pull requests, issues, releases, and more
- **Flexible branch tracking** - Monitor specific branches or all branches per repository
- **Channel routing** - Route notifications to different Discord channels
- **Webhook security** - Secure webhook handling with signature verification
- **Configurable limits** - Customize repository and channel limits via environment variables
- **Modern tech stack** - Discord.js 14, Prisma, PostgreSQL
- **Docker support** - Easy deployment with Docker and Docker Compose

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ (or Docker)
- PostgreSQL database
- Discord Bot Token & Client ID
- **For local development**: ngrok (recommended for webhook testing)

### Docker Deployment

1. **Clone and configure**
   ```bash
   git clone https://github.com/gittrack/gittrack-discord-bot.git
   cd gittrack-discord-bot
   cp .env.example .env
   # Edit .env with your configuration
   ```

2. **Deploy**
   ```bash
   ./deploy.sh
   ```



## 📋 Bot Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/setup` | Configure a GitHub repository | `/setup repository:https://github.com/user/repo [channel:#notifications]` |
| `/link` | Link repository to branch/channel | `/link url:https://github.com/user/repo branch:main channel:#notifications` |
| `/unlink` | Remove linked repository | `/unlink url:https://github.com/user/repo branch:main channel:#notifications` |
| `/remove-repo` | Remove repository from tracking | `/remove-repo url:https://github.com/user/repo` |
| `/set-default-channel` | Set default notification channel | `/set-default-channel repository:https://github.com/user/repo channel:#notifications` |
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
| `GUILD_ID` | Discord server ID | Yes | - |
| `DATABASE_URL` | PostgreSQL connection string | Yes | - |
| `WEBHOOK_URL` | Public webhook URL for GitHub | Yes | - |
| `PUBLIC_URL` | Public base URL of your bot | Yes | - |
| `MAX_REPOS_ALLOWED` | Max repositories per server | No | 10 |
| `MAX_NOTIFICATION_CHANNELS_ALLOWED` | Max channels per server | No | unlimited |




## 🏗️ Architecture

```
src/
├── commands/          # Discord slash commands
├── functions/         # Utility functions (limits, permissions, branch matching)
├── prisma/           # Database schema and migrations
├── webhookHandler.js # GitHub webhook processing
├── bot.js           # Discord bot setup
└── index.js         # Application entry point
```

### Key Components

- **Discord Bot** (`bot.js`) - Handles Discord interactions and slash commands
- **Webhook Handler** (`webhookHandler.js`) - Processes GitHub webhook events
- **Limit Checker** (`functions/limitChecker.js`) - Manages configurable limits
- **Database Layer** (`prisma/`) - Manages data persistence with Prisma ORM

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Setup

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Commit your changes: `git commit -m 'Add amazing feature'`
5. Push to the branch: `git push origin feature/amazing-feature`
6. Open a Pull Request

### Code Style

- Follow the existing code style
- Use meaningful variable and function names
- Add comments for complex logic
- Include error handling

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/gittrack/gittrack-discord-bot/issues)
- **Discussions**: [GitHub Discussions](https://github.com/gittrack/gittrack-discord-bot/discussions)
- **Email**: support@gittrack.me

## 🙏 Acknowledgments

- [Discord.js](https://discord.js.org/) - Discord API wrapper
- [Prisma](https://www.prisma.io/) - Database toolkit
- [GitHub Webhooks](https://docs.github.com/en/developers/webhooks-and-events) - Event system

---

Made with ❤️ by the GitTrack Team
