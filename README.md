# Assign/Unassign Issue Action

A GitHub Action that automates issue assignment and unassignment based on comments (`/assign` and `/unassign` commands) with configurable limits, auto-unassignment, and reminder messages.

## Features

- ✅ **Comment-based assignment**: Use `/assign` and `/unassign` commands in issue comments
- ✅ **Concurrent assignee limit**: Limit how many people can be assigned to an issue (default: 1)
- ✅ **Per-user assignment limit**: Limit how many issues a user can have assigned (default: 3)
- ✅ **Auto-unassignment**: Automatically unassign issues after a configurable number of days (default: 7)
- ✅ **Unassigned label protection**: Prevents re-assignment after unassignment (manual or automatic)
- ✅ **Self-assignment prevention**: Optional toggle to prevent self-assignment
- ✅ **Unlimited users**: Configure users who don't have assignment limits
- ✅ **Reminder messages**: Optional automated reminders about days remaining (only sent if no PR exists for the issue)
- ✅ **Custom messages**: Fully customizable success, error, and reminder messages

## Usage

### Basic Setup

Create a workflow file (e.g., `.github/workflows/assign-unassign.yml`):

```yaml
name: Handle Issue Assignment

on:
  issue_comment:
    types: [created]

jobs:
  assign-unassign:
    runs-on: ubuntu-latest
    permissions:
      issues: write
      contents: read
    steps:
      - name: Handle /assign and /unassign commands
        uses: your-username/assign-unassign-issue-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Scheduled Auto-unassignment

Create a separate workflow for scheduled auto-unassignment (e.g., `.github/workflows/auto-unassign.yml`):

```yaml
name: Auto-unassign Issues

on:
  schedule:
    - cron: '0 0 * * *'  # Daily at midnight UTC
  workflow_dispatch:  # Allow manual triggering

jobs:
  auto-unassign:
    runs-on: ubuntu-latest
    permissions:
      issues: write
      contents: read
    steps:
      - name: Auto-unassign expired issues
        uses: your-username/assign-unassign-issue-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          auto-unassign-days: '7'
          enable-reminder-messages: 'true'
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `github-token` | GitHub token for API access | Yes | - |
| `max-concurrent-assignees` | Maximum concurrent assignees per issue | No | `1` |
| `auto-unassign-days` | Days before auto-unassignment | No | `7` |
| `max-assignments-per-user` | Max issues a user can have assigned | No | `3` |
| `prevent-self-assignment` | Prevent self-assignment (`true`/`false`) | No | `false` |
| `enable-reminder-messages` | Enable reminder messages (`true`/`false`) | No | `false` |
| `reminder-message-template` | Reminder message template (use `{days}` and `{totalDays}`) | No | `{days}/{totalDays} days remaining` |
| `unassigned-label` | Label added when issue is unassigned | No | `unassigned` |
| `unlimited-users` | Comma-separated usernames with no limits | No | `` |
| `assignment-success-message` | Message on successful assignment (use `{username}` and `{days}`) | No | `Assigned to you @{username}, make sure to remember the {days} day deadline` |
| `max-assignment-reached-message` | Message when user reaches max assignments | No | `Max assignment reached, first solve the earlier issues or unassign the issue` |
| `unassign-request-message` | Message when trying to assign after unassignment | No | `This issue was previously unassigned. Please ask the maintainer to assign you the issue manually` |

## Examples

### Example 1: Basic Configuration

```yaml
- uses: your-username/assign-unassign-issue-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    max-concurrent-assignees: '1'
    auto-unassign-days: '7'
    max-assignments-per-user: '3'
```

### Example 2: With Reminders and Self-Assignment Prevention

```yaml
- uses: your-username/assign-unassign-issue-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    max-concurrent-assignees: '2'
    auto-unassign-days: '14'
    max-assignments-per-user: '5'
    prevent-self-assignment: 'true'
    enable-reminder-messages: 'true'
    reminder-message-template: '⚠️ Only {days} days left! ({totalDays} day deadline)'
    unlimited-users: 'maintainer1,maintainer2,admin'
```

### Example 3: Custom Messages

```yaml
- uses: your-username/assign-unassign-issue-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    assignment-success-message: '🎉 @{username} is now assigned! Deadline: {days} days'
    max-assignment-reached-message: '❌ You have reached your assignment limit. Please complete existing issues first.'
    unassign-request-message: '🔒 This issue was previously unassigned. Contact a maintainer for manual assignment.'
```

## How It Works

### Assignment Flow (`/assign`)

1. User comments `/assign` on an issue
2. Action checks:
   - Is the issue already unassigned (has unassigned label)? → Show message
   - Is user already assigned? → Inform user
   - Is self-assignment prevented? → Reject if applicable
   - Has issue reached concurrent assignee limit? → Reject
   - Has user reached their assignment limit? → Reject (unless unlimited)
3. If all checks pass, assign the user and post success message

### Unassignment Flow (`/unassign`)

1. User comments `/unassign` on an issue
2. Action checks:
   - Is user assigned to this issue? → If not, do nothing
3. If assigned, remove assignment and add unassigned label

### Auto-unassignment Flow (Scheduled)

1. Runs on schedule (e.g., daily)
2. Checks all open issues with assignees
3. For each assignee, checks assignment date
4. If assignment is older than `auto-unassign-days`:
   - Unassigns the user
   - Adds unassigned label
   - Posts notification comment
5. If reminders enabled and within 2 days of deadline:
   - Checks if a PR exists for the issue
   - If no PR exists, posts reminder message (once per day)

## Labels

The action uses a label (default: `unassigned`) to track issues that have been unassigned. This prevents automatic re-assignment until a maintainer manually removes the label.

## Permissions

The action requires the following permissions:
- `issues: write` - To assign/unassign and add comments
- `contents: read` - To read repository information

## Development

### Building

```bash
npm install
npm run build
```

### Testing

```bash
npm test
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

