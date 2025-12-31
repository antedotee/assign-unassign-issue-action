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

All configuration options are available as inputs. Only `github-token` is required; all others are optional with sensible defaults.

| Input | Description | Required | Default | Example |
|-------|-------------|----------|---------|---------|
| `github-token` | GitHub token for API access. Use `${{ secrets.GITHUB_TOKEN }}` | **Yes** | - | `${{ secrets.GITHUB_TOKEN }}` |
| `max-concurrent-assignees` | Maximum number of concurrent assignees per issue | No | `1` | `"2"` |
| `auto-unassign-days` | Number of days after assignment before auto-unassignment. **Supports float values for testing** (e.g., `0.01` = ~14 min, `0.1` = 2.4 hours) | No | `7` | `"7"` or `"0.1"` for testing |
| `max-assignments-per-user` | Maximum number of issues a user can have assigned at once | No | `3` | `"5"` |
| `prevent-self-assignment` | Prevent users from assigning themselves. Set to `'true'` to enable | No | `false` | `"true"` |
| `enable-reminder-messages` | Enable automated reminder messages about days remaining. Set to `'true'` to enable | No | `false` | `"true"` |
| `reminder-message-template` | Custom message template for reminders. Use `{days}` and `{totalDays}` placeholders | No | `{days}/{totalDays} days remaining` | `"⚠️ {days} days left ({totalDays} total)"` |
| `unassigned-label` | Label to add when issue is unassigned (prevents re-assignment) | No | `unassigned` | `"needs-assignment"` |
| `unlimited-users` | Comma-separated list of usernames with no assignment limits | No | `` | `"maintainer1,maintainer2"` |
| `assignment-success-message` | Message posted when assignment succeeds. Use `{username}` (replaced with @username) and `{days}` placeholders | No | `Assigned to you {username}, make sure to remember the {days} day deadline` | `"🎉 {username} assigned! {days} days to complete"` |
| `max-assignment-reached-message` | Message when user reaches max assignments | No | `Max assignment reached, first solve the earlier issues or unassign the issue` | `"❌ Limit reached. Complete existing issues first."` |
| `unassign-request-message` | Message when trying to assign after unassignment | No | `This issue was previously unassigned. Please ask the maintainer to assign you the issue manually` | `"🔒 Previously unassigned. Contact maintainer."` |

### Input Details

#### `github-token` (Required)
- **Purpose**: Authenticates API requests to GitHub
- **Usage**: Always use `${{ secrets.GITHUB_TOKEN }}` which is automatically provided by GitHub Actions
- **Permissions**: Requires `issues: write` and `contents: read` permissions

#### `max-concurrent-assignees`
- **Purpose**: Limits how many people can be assigned to a single issue simultaneously
- **Use Case**: Prevents too many people from working on the same issue
- **Example**: Set to `"1"` for single-person assignments, `"2"` for pair programming

#### `auto-unassign-days`
- **Purpose**: Automatically unassigns users after the specified number of days
- **Float Support**: Accepts decimal values for testing:
  - `0.01` = ~14.4 minutes
  - `0.1` = 2.4 hours
  - `0.5` = 12 hours
  - `1` = 24 hours
  - `7` = 7 days (default)
- **Behavior**: Counts from the **first assignment date**, regardless of PR activity or temporary unassignments

#### `max-assignments-per-user`
- **Purpose**: Limits how many issues a single user can have assigned at once
- **Use Case**: Prevents users from taking on too many issues simultaneously
- **Bypass**: Users listed in `unlimited-users` are exempt from this limit

#### `prevent-self-assignment`
- **Purpose**: Blocks users from assigning themselves to issues
- **Use Case**: Ensures maintainer oversight for issue assignments
- **Bypass**: Users listed in `unlimited-users` can still self-assign

#### `enable-reminder-messages`
- **Purpose**: Sends automated reminders when deadline approaches
- **Behavior**: Only sends reminders if:
  - No PR exists for the issue
  - Within 2 days of the deadline
  - Maximum once per day

#### `reminder-message-template`
- **Placeholders**:
  - `{days}` - Days remaining until auto-unassignment
  - `{totalDays}` - Total days configured for auto-unassignment
- **Example**: `"⚠️ Only {days} days left! ({totalDays} day deadline)"`

#### `unassigned-label`
- **Purpose**: Label added when an issue is unassigned (manually or automatically)
- **Behavior**: Prevents automatic re-assignment via `/assign` command
- **Removal**: Maintainers must manually remove the label to allow re-assignment

#### `unlimited-users`
- **Purpose**: Comma-separated list of usernames exempt from assignment limits
- **Exemptions**: These users can:
  - Self-assign (even if `prevent-self-assignment` is `true`)
  - Exceed `max-assignments-per-user` limit
- **Format**: `"user1,user2,user3"` (no @ symbols)

#### Message Templates
All message inputs support placeholders:
- `{username}` - Replaced with `@username` format
- `{days}` - Number of days (for assignment-success-message, this is the auto-unassign-days value)

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
    assignment-success-message: '🎉 {username} is now assigned! Deadline: {days} days'
    max-assignment-reached-message: '❌ You have reached your assignment limit. Please complete existing issues first.'
    unassign-request-message: '🔒 This issue was previously unassigned. Contact a maintainer for manual assignment.'
```

### Example 4: Testing Configuration (Fast Auto-unassignment)

```yaml
- uses: your-username/assign-unassign-issue-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    # Use fractional days for quick testing
    auto-unassign-days: '0.01'  # ~14 minutes
    enable-reminder-messages: 'true'
    reminder-message-template: '{days}/{totalDays} days remaining'
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

