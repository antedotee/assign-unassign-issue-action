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
    const autoUnassignDays = parseFloat(core.getInput('auto-unassign-days') || '7');
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
    const suggestAssignAutomatedComment = core.getInput('suggest-assign-automated-comment') === 'true';

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
    // Handle automatic assignment detection from comments and issue description
    else if (suggestAssignAutomatedComment) {
      // Check comment for assignment request
      const assignmentRequestedInComment = detectAssignmentRequest(commentBody);
      
      // Also check issue description if comment doesn't have assignment request
      // Only check issue description if the commenter is the issue opener
      let assignmentRequestedInDescription = false;
      if (!assignmentRequestedInComment) {
        try {
          const { data: issueData } = await octokit.rest.issues.get({
            ...repo,
            issue_number: issueNumber
          });
          // Only check issue description if commenter is the issue opener
          if (issueData.user && issueData.user.login === commenter) {
            const issueDescription = issueData.body || '';
            assignmentRequestedInDescription = detectAssignmentRequest(issueDescription);
          }
        } catch (error) {
          core.warning(`Failed to fetch issue description: ${error.message}`);
        }
      }
      
      if (assignmentRequestedInComment || assignmentRequestedInDescription) {
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
  // Check if already assigned
  if (assignees.includes(commenter)) {
    await octokit.rest.issues.createComment({
      ...repo,
      issue_number: issueNumber,
      body: `@${commenter} You are already assigned to this issue.`
    });
    return;
  }

  // Check concurrent assignee limit FIRST (before checking unassigned label)
  // This ensures we show the correct message when max assignees is reached
  if (assignees.length >= maxConcurrentAssignees) {
    await octokit.rest.issues.createComment({
      ...repo,
      issue_number: issueNumber,
      body: `@${commenter} Maximum concurrent assignees (${maxConcurrentAssignees}) reached for this issue. Please wait for others to unassign or resolve the issue.`
    });
    return;
  }

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

  // Check self-assignment prevention
  if (preventSelfAssignment && !unlimitedUsers.includes(commenter)) {
    await octokit.rest.issues.createComment({
      ...repo,
      issue_number: issueNumber,
      body: `@${commenter} Self-assignment is not allowed. Please ask a maintainer to assign you.`
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

      // Find the FIRST (original) assignment event for each assignee
      // This ensures we count from the original assignment date, regardless of PR activity
      // or temporary unassignments/reassignments
      // 
      // Test case: If user is assigned, creates PR, closes PR, reopens PR:
      // - Assignment date should remain the original assignment date
      // - Timer should continue counting from original assignment, not reset
      const assigneeDates = {};
      for (const assignee of issue.assignees) {
        const assignmentEvents = events
          .filter(e => e.event === 'assigned' && e.assignee && e.assignee.login === assignee.login)
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); // Sort ascending to get FIRST assignment
        
        if (assignmentEvents.length > 0) {
          // Use the FIRST assignment date, not the most recent
          // This ensures:
          // 1. PR closing/reopening doesn't affect the assignment timer
          // 2. Temporary unassignments/reassignments don't reset the timer
          // 3. We always count from when the issue was first assigned to the user
          assigneeDates[assignee.login] = new Date(assignmentEvents[0].created_at);
        }
      }

      // Check each assignee
      for (const assignee of issue.assignees) {
        const assignmentDate = assigneeDates[assignee.login];
        if (!assignmentDate) {
          continue;
        }

        // Calculate days since assignment (supports fractional days for testing)
        const daysSinceAssignment = (new Date() - assignmentDate) / (1000 * 60 * 60 * 24);
        const daysRemaining = autoUnassignDays - daysSinceAssignment;

        // Auto-unassign if deadline passed
        if (daysSinceAssignment >= autoUnassignDays) {
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

          // Create unassignment message based on whether PR exists
          // Format days for display (round to 2 decimal places for fractional days)
          const daysFormatted = Math.round(autoUnassignDays * 100) / 100;
          let unassignMessage;
          if (hasPR) {
            unassignMessage = `@${assignee.login} You have been automatically unassigned from this issue after ${daysFormatted} days. A pull request has been raised for this issue.`;
          } else {
            // Get repository owner for maintainer mention
            const repoOwner = repo.owner;
            unassignMessage = `@${assignee.login} You have been automatically unassigned from this issue.\n\n**Reason:** No pull request was raised within the ${daysFormatted}-day deadline.\n\n**Next steps:**\n- If you're still working on this issue, please create a pull request and ask a maintainer (@${repoOwner}) to reassign you\n- If you're no longer working on this issue, thank you for your time!\n\nMaintainers: Please manually assign this issue if needed.`;
          }

          await octokit.rest.issues.createComment({
            ...repo,
            issue_number: issue.number,
            body: unassignMessage
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
              // Format days for display (round to 2 decimal places for fractional days)
              const daysRemainingFormatted = daysRemaining > 1 
                ? Math.round(daysRemaining * 100) / 100 
                : Math.round(daysRemaining * 100) / 100;
              const totalDaysFormatted = Math.round(autoUnassignDays * 100) / 100;
              
              const reminderMessage = reminderMessageTemplate
                .replace('{days}', daysRemainingFormatted.toString())
                .replace('{totalDays}', totalDaysFormatted.toString());
              
              // Enhanced reminder message with context
              const enhancedReminder = `@${assignee.login} ⚠️ **Reminder**: ${reminderMessage} before automatic unassignment. No pull request has been raised for this issue yet. Please create a PR if you're working on it, or unassign yourself if you're no longer working on it.`;
              
              await octokit.rest.issues.createComment({
                ...repo,
                issue_number: issue.number,
                body: enhancedReminder
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

function detectAssignmentRequest(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }

  const normalizedText = text.toLowerCase().trim();
  
  // Common phrases that indicate assignment request
  const assignmentPhrases = [
    'i want to work',
    'i want to work on this',
    'i\'d like to work',
    'i\'d like to work on this',
    'please assign me',
    'please assign me this',
    'assign me',
    'assign me this',
    'i\'ll work on this',
    'i\'ll work on it',
    'i can work on this',
    'i can work on it',
    'i would like to work',
    'i would like to work on this',
    'i\'m interested in working',
    'i\'m interested in working on this',
    'can i work on this',
    'can i work on it',
    'i want to take this',
    'i want to take this issue',
    'i\'ll take this',
    'i\'ll take this issue',
    'i can take this',
    'i can take this issue',
    'i\'d like to take this',
    'i\'d like to take this issue',
    'let me work on this',
    'let me work on it',
    'i\'ll handle this',
    'i\'ll handle it',
    'i can handle this',
    'i can handle it'
  ];

  // Check if any phrase matches
  return assignmentPhrases.some(phrase => normalizedText.includes(phrase));
}

module.exports = { run, handleAssign, handleUnassign, getUserAssignments, handleScheduledUnassign, detectAssignmentRequest };

