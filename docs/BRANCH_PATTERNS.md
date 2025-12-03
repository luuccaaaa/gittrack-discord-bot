# Branch Pattern Reference

GitTrack uses branch patterns to decide which push events are delivered to Discord. Patterns are matched in `src/functions/branchMatcher.js` and support wildcard prefixes so you can monitor groups of related branches with a single configuration.

## Supported Patterns

| Pattern | Description | Matches |
|---------|-------------|---------|
| `*` | Track every branch pushed to the repository. | `main`, `develop`, `feature/api`, `release/v1.0`, ... |
| `main` | Track a single, exact branch name. | Only `main` |
| `prefix/*` | Track every branch whose name starts with `prefix/`. | `features/ui`, `features/api`, `features/new-auth` |
| `!main` | Track all branches **except** the specified one. | `develop`, `feature/api`, `release/v1.0`, ... (not `main`) |
| `!prefix/*` | Track all branches **except** those starting with `prefix/`. | `main`, `develop`, `hotfix/bug` (not `release/v1.0`, `release/v2.0`) |

> Tip: Prefix patterns are great for grouping feature, release, or hotfix branches without linking each one manually.

> Tip: Negation patterns (`!pattern`) are useful when you want notifications for most branches but need to exclude specific ones like `main` or `release/*`.

## Using Patterns with `/link`

Run `/link url:<repository> branch:<pattern> channel:<#channel>` to associate a pattern with a Discord channel. Call the command multiple times to:

- Monitor different branches or patterns in the same channel.
- Route specific prefixes to their own channels while keeping `*` mapped to a default channel.
- Provide branch-specific overrides for repositories that already have a default notification channel.
- Exclude specific branches using negation patterns.

Example configurations:

```
/link url:https://github.com/org/repo branch:* channel:#deployments
/link url:https://github.com/org/repo branch:main channel:#deployments
/link url:https://github.com/org/repo branch:release/* channel:#release-notes
/link url:https://github.com/org/repo branch:!main channel:#dev-activity
```

The `/status` command lists every tracked pattern grouped by channel so you can confirm the current routing.

## Pattern Rules

- Patterns may include letters, numbers, slashes, hyphens, underscores, and dots. Wildcards are limited to `*` at the end of the pattern (e.g., `hotfix/*`) or the standalone `*` case.
- Patterns that place `*` in the middle or multiple times (e.g., `*fix*`, `feature/*/docs`) are stored but will not match any branches.
- Negation patterns start with `!` and match all branches **except** those matching the inner pattern. For example, `!main` matches everything except `main`, and `!release/*` matches everything except branches starting with `release/`.
- `!*` is not valid (it would match nothing).
- Exact branch names are case-sensitive and must match the branch name GitHub sends in the webhook payload.
- Multiple patterns can match the same branch. GitTrack sends a notification for each match, which allows you to mirror a push into multiple channels when needed.

## Troubleshooting

- No notification for a branch? Double-check the pattern using `/status` and verify the branch name reported under the GitHub webhook delivery payload. Remember that prefix patterns require the slash (`features/*`).
- Receiving events in the wrong channel? Look for overlapping patterns (for example, both `*` and `features/*`). Remove or adjust the redundant mapping with `/unlink` or add explicit channel overrides.
- Need to pause notifications temporarily? Use `/unlink` to remove the pattern or `/remove-repo` to clear the repository from the server.
