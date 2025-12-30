const core = require('@actions/core');
const github = require('@actions/github');

async function run() {
  try {
    const token = core.getInput('github-token', { required: true });
    const octokit = github.getOctokit(token);
    const context = github.context;

    // Handle scheduled auto-unassignment
    if (context.eventName === 'schedule' || context.eventName === 'workflow_dispatch') {
      await handleScheduledUnassign({ octokit, context });
      return;
    }

    // Only process issue comments (not PR comments)
    if (context.eventName !== 'issue_comment' || context.payload.issue.pull_request) {
      core.info('Not an issue comment, skipping...');
      return;
    }

    // Only process created comments
    if (context.payload.action !== 'created') {
      core.info('Comment was not created, skipping...');
      return;
    }

    const commentBody = context.payload.comment.body.trim();
    const commenter = context.payload.comment.user.login;
    const issueNumber = context.payload.issue.number;
    const issueLabels = context.payload.issue.labels.map(label => label.name);
    const assignees = context.payload.issue.assignees.map(assignee => assignee.login);
    const repo = context.repo;

    // Get configuration
    const maxConcurrentAssignees = parseInt(core.getInput('max-concurrent-assignees') || '1');
    const autoUnassignDays = parseInt(core.getInput('auto-unassign-days') || '7');
    const maxAssignmentsPerUser = parseInt(core.getInput('max-assignments-per-user') || '3');
    const preventSelfAssignment = core.getInput('prevent-self-assignment') === 'true';
    const unassignedLabel = core.getInput('unassigned-label') || 'unassigned';
    const unlimitedUsers = (core.getInput('unlimited-users') || '')
      .split(',')
      .map(u => u.trim())
      .filter(u => u.length > 0);
    const assignmentSuccessMessage = core.getInput('assignment-success-message') || 
      'Assigned to you @{username}, make sure to remember the {days} day deadline';
    const maxAssignmentReachedMessage = core.getInput('max-assignment-reached-message') || 
      'Max assignment reached, first solve the earlier issues or unassign the issue';
    const unassignRequestMessage = core.getInput('unassign-request-message') || 
      'This issue was previously unassigned. Please ask the maintainer to assign you the issue manually';

    // Handle /assign command
    if (commentBody === '/assign') {
      await handleAssign({
        octokit,
        repo,
        issueNumber,
        commenter,
        assignees,
        issueLabels,
        maxConcurrentAssignees,
        maxAssignmentsPerUser,
        preventSelfAssignment,
        unassignedLabel,
        unlimitedUsers,
        assignmentSuccessMessage,
        maxAssignmentReachedMessage,
        unassignRequestMessage,
        autoUnassignDays
      });
    }
    // Handle /unassign command
    else if (commentBody === '/unassign') {
      await handleUnassign({
        octokit,
        repo,
        issueNumber,
        commenter,
        assignees,
        unassignedLabel
      });
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

async function handleAssign({
  octokit,
  repo,
  issueNumber,
  commenter,
  assignees,
  issueLabels,
  maxConcurrentAssignees,
  maxAssignmentsPerUser,
  preventSelfAssignment,
  unassignedLabel,
  unlimitedUsers,
  assignmentSuccessMessage,
  maxAssignmentReachedMessage,
  unassignRequestMessage,
  autoUnassignDays
}) {
  // Check if issue has unassigned label
  if (issueLabels.includes(unassignedLabel)) {
    // Ensure the message tags the user if it doesn't already
    const message = unassignRequestMessage.includes(`@${commenter}`) 
      ? unassignRequestMessage 
      : `@${commenter} ${unassignRequestMessage}`;
    await octokit.rest.issues.createComment({
      ...repo,
      issue_number: issueNumber,
      body: message
    });
    return;
  }

  // Check if already assigned
  if (assignees.includes(commenter)) {
    await octokit.rest.issues.createComment({
      ...repo,
      issue_number: issueNumber,
      body: `@${commenter} You are already assigned to this issue.`
    });
    return;
  }

  // Check self-assignment prevention
  if (preventSelfAssignment && !unlimitedUsers.includes(commenter)) {
    await octokit.rest.issues.createComment({
      ...repo,
      issue_number: issueNumber,
      body: `@${commenter} Self-assignment is not allowed. Please ask a maintainer to assign you.`
    });
    return;
  }

  // Check concurrent assignee limit
  if (assignees.length >= maxConcurrentAssignees) {
    await octokit.rest.issues.createComment({
      ...repo,
      issue_number: issueNumber,
      body: `@${commenter} Maximum concurrent assignees (${maxConcurrentAssignees}) reached for this issue.`
    });
    return;
  }

  // Check user's assignment limit (unless unlimited)
  if (!unlimitedUsers.includes(commenter)) {
    const userAssignments = await getUserAssignments(octokit, repo, commenter);
    if (userAssignments >= maxAssignmentsPerUser) {
      // Ensure the message tags the user if it doesn't already
      const message = maxAssignmentReachedMessage.includes(`@${commenter}`) 
        ? maxAssignmentReachedMessage 
        : `@${commenter} ${maxAssignmentReachedMessage}`;
      await octokit.rest.issues.createComment({
        ...repo,
        issue_number: issueNumber,
        body: message
      });
      return;
    }
  }

  // Assign the user
  const newAssignees = [...assignees, commenter];
  await octokit.rest.issues.addAssignees({
    ...repo,
    issue_number: issueNumber,
    assignees: [commenter]
  });

  // Post success message
  // Replace {username} with @username format for proper tagging
  // Handle both @{username} and {username} formats in template
  let message = assignmentSuccessMessage
    .replace(/@\{username\}/g, `@${commenter}`)  // Replace @{username} with @username
    .replace(/\{username\}/g, `@${commenter}`)   // Replace {username} with @username
    .replace(/\{days\}/g, autoUnassignDays.toString());
  
  await octokit.rest.issues.createComment({
    ...repo,
    issue_number: issueNumber,
    body: message
  });

  core.info(`Assigned issue #${issueNumber} to ${commenter}`);
}

async function handleUnassign({
  octokit,
  repo,
  issueNumber,
  commenter,
  assignees,
  unassignedLabel
}) {
  // Check if user is assigned
  if (!assignees.includes(commenter)) {
    // Silent fail - do nothing if user is not assigned
    return;
  }

  // Remove assignee
  await octokit.rest.issues.removeAssignees({
    ...repo,
    issue_number: issueNumber,
    assignees: [commenter]
  });

  // Add unassigned label
  try {
    await octokit.rest.issues.addLabels({
      ...repo,
      issue_number: issueNumber,
      labels: [unassignedLabel]
    });
  } catch (error) {
    // Label might already exist, ignore error
    core.info(`Label ${unassignedLabel} might already exist: ${error.message}`);
  }

  // Post confirmation message
  await octokit.rest.issues.createComment({
    ...repo,
    issue_number: issueNumber,
    body: `@${commenter} You have been unassigned from this issue.`
  });

  core.info(`Unassigned ${commenter} from issue #${issueNumber}`);
}

async function getUserAssignments(octokit, repo, username) {
  try {
    const { data: issues } = await octokit.rest.issues.listForRepo({
      ...repo,
      state: 'open',
      assignee: username,
      per_page: 100
    });
    return issues.length;
  } catch (error) {
    core.warning(`Failed to get user assignments: ${error.message}`);
    return 0;
  }
}

if (require.main === module) {
  run();
}

async function handleScheduledUnassign({ octokit, context }) {
  const repo = context.repo;
  const autoUnassignDays = parseInt(core.getInput('auto-unassign-days') || '7');
  const unassignedLabel = core.getInput('unassigned-label') || 'unassigned';
  const enableReminderMessages = core.getInput('enable-reminder-messages') === 'true';
  const reminderMessageTemplate = core.getInput('reminder-message-template') || '{days}/{totalDays} days remaining';

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - autoUnassignDays);

  core.info(`Checking issues assigned before ${cutoffDate.toISOString()}`);

  // Get all open issues with assignees
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const { data: issues } = await octokit.rest.issues.listForRepo({
      ...repo,
      state: 'open',
      per_page: 100,
      page: page
    });

    if (issues.length === 0) {
      hasMore = false;
      break;
    }

    for (const issue of issues) {
      // Skip if already has unassigned label
      const labels = issue.labels.map(l => l.name);
      if (labels.includes(unassignedLabel)) {
        continue;
      }

      // Skip if no assignees
      if (!issue.assignees || issue.assignees.length === 0) {
        continue;
      }

      // Get issue events to find assignment date
      const { data: events } = await octokit.rest.issues.listEvents({
        ...repo,
        issue_number: issue.number,
        per_page: 100
      });

      // Find the most recent assignment event for each assignee
      const assigneeDates = {};
      for (const assignee of issue.assignees) {
        const assignmentEvents = events
          .filter(e => e.event === 'assigned' && e.assignee && e.assignee.login === assignee.login)
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        if (assignmentEvents.length > 0) {
          assigneeDates[assignee.login] = new Date(assignmentEvents[0].created_at);
        }
      }

      // Check each assignee
      for (const assignee of issue.assignees) {
        const assignmentDate = assigneeDates[assignee.login];
        if (!assignmentDate) {
          continue;
        }

        const daysSinceAssignment = Math.floor((new Date() - assignmentDate) / (1000 * 60 * 60 * 24));
        const daysRemaining = autoUnassignDays - daysSinceAssignment;

        // Auto-unassign if deadline passed
        if (daysSinceAssignment >= autoUnassignDays) {
          await octokit.rest.issues.removeAssignees({
            ...repo,
            issue_number: issue.number,
            assignees: [assignee.login]
          });

          // Add unassigned label
          try {
            await octokit.rest.issues.addLabels({
              ...repo,
              issue_number: issue.number,
              labels: [unassignedLabel]
            });
          } catch (error) {
            core.info(`Label ${unassignedLabel} might already exist: ${error.message}`);
          }

          await octokit.rest.issues.createComment({
            ...repo,
            issue_number: issue.number,
            body: `@${assignee.login} has been automatically unassigned after ${autoUnassignDays} days.`
          });

          core.info(`Auto-unassigned ${assignee.login} from issue #${issue.number}`);
        }
        // Send reminder if enabled and within reminder window
        else if (enableReminderMessages && daysRemaining > 0 && daysRemaining <= 2) {
          // Check if a PR exists for this issue
          const { data: pulls } = await octokit.rest.pulls.list({
            ...repo,
            state: 'open',
            per_page: 100
          });

          // Check if any PR references this issue
          const hasPR = pulls.some(pr => {
            const body = (pr.body || '').toLowerCase();
            return body.includes(`#${issue.number}`) || 
                   body.includes(`closes #${issue.number}`) ||
                   body.includes(`fixes #${issue.number}`) ||
                   body.includes(`resolves #${issue.number}`);
          });

          // Only send reminder if no PR exists
          if (!hasPR) {
            // Check if we already sent a reminder today
            const { data: comments } = await octokit.rest.issues.listComments({
              ...repo,
              issue_number: issue.number,
              per_page: 100
            });

            const today = new Date().toDateString();
            const reminderSentToday = comments.some(comment => {
              const commentDate = new Date(comment.created_at).toDateString();
              return commentDate === today && 
                     comment.body.includes(reminderMessageTemplate.replace('{days}', '').replace('{totalDays}', ''));
            });

            if (!reminderSentToday) {
              const reminderMessage = reminderMessageTemplate
                .replace('{days}', daysRemaining.toString())
                .replace('{totalDays}', autoUnassignDays.toString());
              
              await octokit.rest.issues.createComment({
                ...repo,
                issue_number: issue.number,
                body: `@${assignee.login} ${reminderMessage}`
              });

              core.info(`Sent reminder to ${assignee.login} for issue #${issue.number}`);
            }
          }
        }
      }
    }

    if (issues.length < 100) {
      hasMore = false;
    } else {
      page++;
    }
  }
}

module.exports = { run, handleAssign, handleUnassign, getUserAssignments, handleScheduledUnassign };

