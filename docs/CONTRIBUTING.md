# Contributing to GitTrack Discord Bot

Thank you for helping improve GitTrack! This guide walks you through the container-based development process, coding expectations, and how to submit changes.

## Prerequisites

- Node.js 18 (or newer) and npm
- PostgreSQL 13+ (local installation or container)
- Discord bot token and client ID
- GitHub personal access token (optional – used only for private branch autocomplete)

## Getting Started

1. Fork the repository and clone your fork.
2. Copy `.env.example` to `.env` and fill in the required Discord, database, and webhook values.
3. Launch the stack with `./scripts/deploy.sh` (or `docker-compose -f docker/docker-compose.dev.yml up -d` if you prefer manual control). This starts PostgreSQL, Prisma Studio, and the bot container.
4. Exec into the bot container when you need to run project scripts:
   ```bash
   docker-compose -f docker/docker-compose.dev.yml exec bot bash
   ```
5. Apply schema updates from inside the container with `npx prisma db push` (and run `npx prisma generate` if you need an updated client).

### Need manual control?

Use standard Docker Compose commands (e.g., `docker-compose -f docker/docker-compose.dev.yml up -d`, `down`, `logs`) if you prefer not to use the helper script.

## Project Layout

- `src/index.js` boots the Prisma client, the Discord bot, and the Express webhook server.
- `src/bot.js` loads slash commands, registers them globally, and enforces permission checks before executing commands.
- `src/handlers/` contains the GitHub webhook router and specialised event handlers (pull requests, checks, workflow jobs, etc.).
- `src/functions/` provides shared helpers such as branch pattern matching, limit enforcement, and permission checks.
- `prisma/` stores the schema (`Server`, `Repository`, `TrackedBranch`, `RepositoryEventChannel`, logging tables) and migrations.

Refer to `docs/BRANCH_PATTERNS.md` for details on branch wildcards and how they are evaluated inside `findMatchingBranches`.

## Coding Guidelines

- Match the existing code style (Standard JS with async/await). Prefer descriptive variable names and handle errors with meaningful messages.
- Slash commands should reply ephemerally when returning configuration data to avoid leaking server details.
- Keep business logic in helpers/handlers so commands stay focused on validation and presentation.
- When touching the data model, push changes with `npx prisma db push` and run `npx prisma generate` if the generated client needs to be refreshed.
- Update or create documentation alongside functional changes. The `/docs` folder is the canonical place for developer notes.

## Running and Verifying Changes

- `./scripts/deploy.sh`: builds and starts the Docker stack (bot, PostgreSQL, Prisma Studio).
- `docker-compose -f docker/docker-compose.dev.yml logs -f bot`: tails bot logs.
- `docker-compose -f docker/docker-compose.dev.yml exec bot npm test`: placeholder test command—extend or replace as you add automated checks.
- Use `/status` inside Discord to validate that repository, branch, and event routes look correct after your changes.

## Git Workflow

- Create feature branches using descriptive names such as `feature/branch-filtering` or `fix/event-routing`.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (e.g., `feat:`, `fix:`, `docs:`) so changelog automation stays consistent.
- Keep pull requests focused. Split large changes into smaller reviews when possible.

## Pull Request Checklist

- [ ] The Docker stack starts successfully (`./scripts/deploy.sh` or `docker-compose -f docker/docker-compose.dev.yml up`).
- [ ] Database migrations (if any) are included and the Prisma client is regenerated.
- [ ] Documentation and slash command help text are updated when behaviour changes.
- [ ] Tests or manual verification steps are documented in the PR description.
- [ ] The change adheres to permission requirements (commands needing Manage Webhooks continue to enforce it).

## Reporting Issues or Asking Questions

- Open issues and feature requests at [GitHub Issues](https://github.com/luuccaaaa/gittrack-discord-bot/issues).
- Join the [GitTrack Community Discord](https://discord.gg/4GNcUDNbsC) for realtime chat and announcements.
- For private matters, email support@gittrack.me.

We appreciate your contributions—thank you for making GitTrack better!
