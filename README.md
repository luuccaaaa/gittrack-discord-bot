<div align="center">
  <h1>GitTrack Discord Bot</h1>
  <p>
    Open-source Discord bot for GitHub notifications with branch-aware routing and event-level controls.
  </p>
  <p>
    <a href="https://github.com/luuccaaaa/gittrack-discord-bot/actions/workflows/ci.yml">
      <img src="https://github.com/luuccaaaa/gittrack-discord-bot/actions/workflows/ci.yml/badge.svg" alt="CI Status" />
    </a>
    <img src="https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white" alt="Node.js 22+" />
    <img src="https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white" alt="discord.js v14" />
    <img src="https://img.shields.io/badge/Docker-Compose%20v2-2496ED?logo=docker&logoColor=white" alt="Docker Compose v2" />
    <a href="./LICENSE">
      <img src="https://img.shields.io/badge/License-MIT-F4B400.svg" alt="MIT License" />
    </a>
  </p>

  <p>
    <a href="https://discord.com/oauth2/authorize?client_id=1373397506909798410&permissions=277025410048&scope=bot%20applications.commands">
      <img src="https://img.shields.io/badge/Add%20Public%20Bot-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Add Public Bot" />
    </a>
    <a href="https://gittrack.me">
      <img src="https://img.shields.io/badge/Website-gittrack.me-0EA5E9?style=for-the-badge&logo=googlechrome&logoColor=white" alt="GitTrack Website" />
    </a>
    <a href="https://discord.com/invite/DdnmX8p7JC">
      <img src="https://img.shields.io/badge/Community%20Discord-Join-57F287?style=for-the-badge&logo=discord&logoColor=white" alt="Community Discord" />
    </a>
  </p>
</div>

GitTrack sends real-time updates for push, pull request, issues, releases, checks, workflow events, and more.


## Requirements

- Node.js 22+
- Docker Engine + Docker Compose v2
- Discord bot token and client ID
- GitHub CLI (`gh`) for local webhook forwarding (recommended)

## Quick start (Docker-first)

1. Copy the environment template:

```bash
cp .env.example .env
```

2. Fill required values in `.env` (`DISCORD_TOKEN`, `CLIENT_ID`, `DATABASE_URL`, `WEBHOOK_URL` or `PUBLIC_URL`).

3. Start local development stack:

```bash
./scripts/deploy.sh up
```

4. Optional tooling service (Prisma Studio):

```bash
./scripts/deploy.sh studio
```

5. Useful commands:

```bash
./scripts/deploy.sh logs
./scripts/deploy.sh ps
./scripts/deploy.sh down
```

## Local webhook forwarding

Use GitHub CLI webhook forwarding for local development:

```bash
gh webhook forward --repo <owner>/<repo> --events '*' --url http://localhost:3000/github-webhook --secret <webhook_secret>
```

`ngrok` can still be used as an optional fallback, but `gh webhook forward` is the default documented workflow.


## Bot invite links

Hosted public bot invite:

- <https://discord.com/oauth2/authorize?client_id=1373397506909798410&permissions=277025410048&scope=bot%20applications.commands>

Development bot invite template:

- `https://discord.com/oauth2/authorize?client_id=<DEV_CLIENT_ID>&permissions=277025410048&scope=bot%20applications.commands`

For development, replace only `client_id` unless you intentionally need different scopes or permissions.

Helper command to build invite URL from local `.env` (`CLIENT_ID`):

```bash
printf 'https://discord.com/oauth2/authorize?client_id=%s&permissions=277025410048&scope=bot%%20applications.commands\n' "$CLIENT_ID"
```

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | Discord bot token |
| `CLIENT_ID` | Yes | Discord application client ID |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `WEBHOOK_URL` | No | Full webhook endpoint URL; takes precedence over `PUBLIC_URL` |
| `PUBLIC_URL` | No | Base URL used to derive webhook endpoint when `WEBHOOK_URL` is unset |
| `PORT` | No | Express webhook server port (default `3000`) |
| `MAX_REPOS_ALLOWED` | No | Max repos per Discord server (default `10`) |
| `MAX_NOTIFICATION_CHANNELS_ALLOWED` | No | Max distinct notification channels (default `unlimited`) |
| `GITHUB_TOKEN` | No | Enables private-repo branch autocomplete |

## Slash commands

| Command | Description |
| --- | --- |
| `/setup` | Configure repository webhook and default channel |
| `/link` | Link branch pattern to channel |
| `/unlink` | Remove branch-pattern channel route |
| `/remove-repo` | Remove repository from tracking |
| `/set-default-channel` | Set repository default channel |
| `/set-event-channel` | Route non-branch event to channel |
| `/remove-event-channel` | Remove non-branch event route |
| `/edit-event` | Configure per-event action filters |
| `/status` | Show server configuration and limits |
| `/reset` | Reset server data (admin only) |
| `/ping` | Health command |
| `/help` | Command help |


## Contributing

See `CONTRIBUTING.md` for workflow, quality gates, and pull request requirements.

## License

MIT. See `LICENSE`.
