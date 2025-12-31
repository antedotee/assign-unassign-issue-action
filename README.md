# Assign/Unassign Issue Action

A GitHub Action that handles issue assignments through simple comment commands. Comment `/assign` to take on an issue, or `/unassign` to drop it. The action enforces limits, sends reminders, and can automatically unassign issues that haven't seen progress.

## What It Does

- **Comment commands**: Use `/assign` and `/unassign` in issue comments
- **Assignment limits**: Control how many people can work on an issue and how many issues each person can handle
- **Auto-unassignment**: Automatically unassign issues after a set number of days if no PR is created
- **Smart reminders**: Get notified when deadlines approach (only if no PR exists)
- **Assignment detection**: Optionally detect when someone wants to work on an issue and suggest they use `/assign`

## Quick Start

### Step 1: Handle Comment Commands

Create `.github/workflows/assign-unassign.yml`:

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

### Step 2: Set Up Auto-Unassignment (Optional)

Create `.github/workflows/auto-unassign.yml` for automatic unassignment:

```yaml
name: Auto-unassign Issues

on:
  schedule:
    - cron: '0 0 * * *'  # Daily at midnight UTC
  workflow_dispatch:  # Allows manual triggering

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

That's it! The action will now handle assignments when people comment `/assign` or `/unassign` on issues.

## Configuration Options

All settings are optional except `github-token`. Here's what you can tweak:

| Input | What It Does | Default |
|-------|--------------|---------|
| `github-token` | GitHub token (always use `${{ secrets.GITHUB_TOKEN }}`) | **Required** |
| `max-concurrent-assignees` | How many people can be assigned to one issue | `1` |
| `auto-unassign-days` | Days before auto-unassignment (supports decimals like `0.01` for testing) | `7` |
| `max-assignments-per-user` | Max issues one person can have assigned | `3` |
| `prevent-self-assignment` | Block people from assigning themselves | `false` |
| `enable-reminder-messages` | Send reminders when deadline approaches | `false` |
| `reminder-message-template` | Custom reminder message (use `{days}` and `{totalDays}`) | `{days}/{totalDays} days remaining` |
| `unlimited-users` | Comma-separated list of users exempt from limits | `""` |
| `assignment-success-message` | Message when assignment succeeds (use `{username}` and `{days}`) | `Assigned to you {username}, make sure to remember the {days} day deadline` |
| `max-assignment-reached-message` | Message when user hits their limit | `Max assignment reached, first solve the earlier issues or unassign the issue` |
| `unassign-request-message` | Message when trying to assign after unassignment | `This issue was previously unassigned. Please ask the maintainer to assign you the issue manually` |
| `suggest-assign-automated-comment` | Detect assignment requests and suggest `/assign` | `false` |

## How It Works

### The `/assign` Command

When someone comments `/assign`:

1. Checks if they're already assigned → tells them if so
2. Checks if the issue is at max assignees → tells them to wait
3. Checks if self-assignment is blocked → tells them to ask a maintainer
4. Checks if they've hit their personal limit → tells them to finish other issues first
5. If everything passes → assigns them and posts a success message

### The `/unassign` Command

When someone comments `/unassign`:

- If they're assigned → removes them and confirms
- If they're not assigned → does nothing (silent)

### Auto-Unassignment

The scheduled workflow runs daily (or however often you configure it) and:

1. Looks at all open issues with assignees
2. Finds when each person was first assigned (uses the original assignment date, not reassignments)
3. If the assignment is older than your deadline:
   - Checks if there's a PR for the issue
   - Unassigns the person
   - Adds an "unassigned" label to prevent re-assignment
   - Posts a message explaining what happened

### Reminders

If reminders are enabled, the action will:

- Check issues where the deadline is approaching (within 2 days for normal deadlines, or at the mid-point for very short deadlines)
- Only send reminders if no PR exists for the issue
- Send at most one reminder per day
- Skip reminders entirely if a PR references the issue

### Assignment Detection

When `suggest-assign-automated-comment` is enabled, the action watches for phrases like:
- "I want to work on this"
- "Please assign me"
- "Can I work on this issue?"
- And similar variations

If it detects an assignment request and assignment is possible, it suggests using `/assign` instead of auto-assigning. This gives people control while making the process smoother.

## Common Use Cases

### Basic Setup
Just want people to be able to assign themselves? Use the quick start above. That's all you need.

### Stricter Control
Want to prevent self-assignment and limit how many issues people take on?

```yaml
- uses: your-username/assign-unassign-issue-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    prevent-self-assignment: 'true'
    max-assignments-per-user: '5'
    max-concurrent-assignees: '1'
```

### With Reminders
Want to remind people before they get auto-unassigned?

```yaml
- uses: your-username/assign-unassign-issue-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    auto-unassign-days: '14'
    enable-reminder-messages: 'true'
    reminder-message-template: '⚠️ Only {days} days left! ({totalDays} day deadline)'
```

### Unlimited Users
Have maintainers who should bypass all limits?

```yaml
- uses: your-username/assign-unassign-issue-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    unlimited-users: 'maintainer1,maintainer2,admin'
    prevent-self-assignment: 'true'
```

## Important Notes

**Assignment dates**: The action tracks from the first time someone was assigned, not from reassignments. So if someone gets unassigned and reassigned, the timer doesn't reset.

**PR detection**: The action looks for PRs that mention the issue number (like `#123` or `closes #123`). If it finds one, it won't send reminders and will note the PR in the unassignment message.

**The unassigned label**: When auto-unassignment happens, an "unassigned" label is added. This prevents people from using `/assign` on that issue until a maintainer removes the label. Manual unassignment doesn't add this label.

**Testing with short deadlines**: You can use fractional days like `0.01` (about 14 minutes) for testing. Just make sure your scheduled workflow runs frequently enough—GitHub Actions requires at least 5 minutes between runs. For production, stick with whole days.

## Permissions

The action needs:
- `issues: write` - To assign/unassign and post comments
- `contents: read` - To read repository info

## License

MIT

## Contributing

Pull requests welcome! If you find a bug or have an idea, feel free to open an issue or submit a PR.
