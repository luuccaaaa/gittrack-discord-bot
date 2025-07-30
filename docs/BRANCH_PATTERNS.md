# Branch Pattern Matching

GitTrack now supports wildcard patterns for branch tracking, making it easier to monitor groups of related branches.

## Supported Patterns

### 1. All Branches (`*`)
- **Pattern**: `*`
- **Description**: Tracks all branches in the repository
- **Example**: `*` matches `main`, `develop`, `feature/api`, `hotfix/bug-123`, etc.

### 2. Exact Branch Name
- **Pattern**: `branch-name`
- **Description**: Tracks only the specified branch
- **Example**: `main` matches only the `main` branch

### 3. Prefix Matching (`prefix/*`)
- **Pattern**: `prefix/*`
- **Description**: Tracks all branches that start with the specified prefix
- **Examples**:
  - `features/*` matches `features/api`, `features/frontend`, `features/user-auth`, etc.
  - `hotfix/*` matches `hotfix/bug-123`, `hotfix/critical-fix`, etc.
  - `release/*` matches `release/v1.0`, `release/v2.0`, etc.

## Usage Examples

### Linking Patterns
```
/link repository:my-repo branch:*
/link repository:my-repo branch:main
/link repository:my-repo branch:features/*
/link repository:my-repo branch:hotfix/*
```

### Common Use Cases
1. **Track all feature branches**: `features/*`
2. **Track all hotfix branches**: `hotfix/*`
3. **Track all release branches**: `release/*`
4. **Track all branches**: `*`
5. **Track specific branch**: `main` or `develop`

## Pattern Validation
- Patterns must contain only alphanumeric characters, hyphens, underscores, forward slashes, and asterisks
- Only one wildcard (`*`) is allowed per pattern
- Wildcards can only appear at the end of a pattern after a forward slash (`/`)
- Invalid examples: `*/branch`, `prefix/*/suffix`, `branch@name`

## How It Works
When webhook events are received, GitTrack checks all configured branch patterns against the event's branch name:
- If the branch matches any pattern, notifications are sent to the linked Discord channels
- Multiple patterns can match the same branch (e.g., both `*` and `features/*` would match `features/api`)
