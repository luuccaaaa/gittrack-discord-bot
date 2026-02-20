# Contributing to GitTrack Discord Bot

## Scope

This repository is focused on bot development and contributor workflow. In the combined GitTrack stack, production orchestration is managed from the root repository.

## Prerequisites

- Node.js 22+
- Docker Engine + Docker Compose v2
- Discord bot token and client ID

## Local setup

1. Fork and clone the repository.
2. Create `.env` from `.env.example`.
3. Start services:

```bash
./scripts/deploy.sh up
```

4. Optional Prisma Studio:

```bash
./scripts/deploy.sh studio
```

5. Optional webhook forwarding during integration work:

```bash
gh webhook forward --repo <owner>/<repo> --events '*' --url http://localhost:3000/github-webhook --secret <webhook_secret>
```

## Development commands

```bash
npm run dev
npm run lint
npm test
./scripts/deploy.sh logs
./scripts/deploy.sh ps
```

## Code quality expectations

- Keep command behavior and setup docs synchronized.
- Keep business logic in `src/functions`/`src/handlers`; keep command files focused on validation and response formatting.
- Preserve permission checks for administrative commands.
- Keep changes small and reviewable; prefer explicit error handling paths.

## Testing and validation

Before opening a pull request:

1. `docker compose -f docker/docker-compose.dev.yml config`
2. `npm run lint`
3. `npm test`

If behavior changes, include manual verification steps (e.g., `/setup`, `/link`, webhook forwarding path).

## Pull request checklist

- [ ] Local stack starts (`./scripts/deploy.sh up`).
- [ ] Lint and tests pass.
- [ ] Docs are updated when workflow or behavior changes.
- [ ] Environment variable additions/changes are reflected in `.env.example`.
- [ ] Prisma schema changes include appropriate migration/data-sync instructions.

## Git and commit conventions

- Use short-lived feature/fix branches.
- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).

## Support

- Issues: <https://github.com/luuccaaaa/gittrack-discord-bot/issues>
- Community Discord: <https://discord.com/invite/DdnmX8p7JC>
