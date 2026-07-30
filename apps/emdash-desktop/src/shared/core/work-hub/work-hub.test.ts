import { describe, expect, it } from 'vitest';
import type { LinkedIssue } from '@shared/core/linked-issue';
import type { PullRequest, PullRequestCheck } from '@shared/core/pull-requests/pull-requests';
import type { WorkHubItem } from './work-hub';
import {
  aggregateAgentStatus,
  authoredPrNeedsAttention,
  filterUnstartedIssues,
  groupWorkHubItems,
  prHasFailingChecks,
  sectionForItem,
  sortAuthoredPrs,
} from './work-hub';

describe('aggregateAgentStatus', () => {
  it('returns null status for an empty conversation list', () => {
    expect(aggregateAgentStatus([])).toEqual({ status: null, unseen: false });
  });

  it('ignores conversations without a status', () => {
    expect(aggregateAgentStatus([{ status: null, seen: true }])).toEqual({
      status: null,
      unseen: false,
    });
  });

  it('lets an unseen awaiting-input win over everything else', () => {
    expect(
      aggregateAgentStatus([
        { status: 'working', seen: true },
        { status: 'error', seen: false },
        { status: 'awaiting-input', seen: false },
      ])
    ).toEqual({ status: 'awaiting-input', unseen: true });
  });

  it('does not surface a seen awaiting-input', () => {
    expect(
      aggregateAgentStatus([
        { status: 'awaiting-input', seen: true },
        { status: 'working', seen: true },
      ])
    ).toEqual({ status: 'working', unseen: false });
  });

  it('prefers working over unseen error and unseen completed', () => {
    expect(
      aggregateAgentStatus([
        { status: 'completed', seen: false },
        { status: 'error', seen: false },
        { status: 'working', seen: true },
      ])
    ).toEqual({ status: 'working', unseen: false });
  });

  it('prefers unseen error over unseen completed', () => {
    expect(
      aggregateAgentStatus([
        { status: 'completed', seen: false },
        { status: 'error', seen: false },
      ])
    ).toEqual({ status: 'error', unseen: true });
  });

  it('surfaces unseen completed when nothing else applies', () => {
    expect(
      aggregateAgentStatus([
        { status: 'completed', seen: false },
        { status: 'idle', seen: true },
      ])
    ).toEqual({ status: 'completed', unseen: true });
  });

  it('returns null when all attention states are seen', () => {
    expect(
      aggregateAgentStatus([
        { status: 'error', seen: true },
        { status: 'completed', seen: true },
      ])
    ).toEqual({ status: null, unseen: false });
  });
});

function item(overrides: Partial<WorkHubItem>): WorkHubItem {
  return {
    id: 'task-1',
    projectId: 'project-1',
    projectName: 'Project One',
    name: 'A task',
    status: 'todo',
    statusChangedAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    isPinned: false,
    type: 'task',
    agent: { status: null, unseen: false },
    ...overrides,
  };
}

describe('sectionForItem', () => {
  it('maps lifecycle statuses to sections', () => {
    expect(sectionForItem(item({ status: 'todo' }))).toBe('planned');
    expect(sectionForItem(item({ status: 'backlog' }))).toBe('planned');
    expect(sectionForItem(item({ status: 'triage' }))).toBe('planned');
    expect(sectionForItem(item({ status: 'in_progress' }))).toBe('active');
    expect(sectionForItem(item({ status: 'review' }))).toBe('review');
    expect(sectionForItem(item({ status: 'done' }))).toBe('done');
    expect(sectionForItem(item({ status: 'cancelled' }))).toBeNull();
    expect(sectionForItem(item({ status: 'duplicate' }))).toBeNull();
  });

  it('puts agent attention above lifecycle status, even on done tasks', () => {
    expect(sectionForItem(item({ status: 'done', agent: { status: 'error', unseen: true } }))).toBe(
      'attention'
    );
    expect(
      sectionForItem(item({ status: 'todo', agent: { status: 'awaiting-input', unseen: true } }))
    ).toBe('attention');
  });

  it('treats a working agent as active regardless of lifecycle status', () => {
    expect(
      sectionForItem(item({ status: 'backlog', agent: { status: 'working', unseen: false } }))
    ).toBe('active');
  });
});

describe('groupWorkHubItems', () => {
  const now = Date.parse('2026-07-29T12:00:00.000Z');

  it('excludes automation-run tasks unless opted in', () => {
    const items = [item({ id: 'a', type: 'automation-run' }), item({ id: 'b' })];
    expect(groupWorkHubItems(items, { now }).planned.map((i) => i.id)).toEqual(['b']);
    expect(
      groupWorkHubItems(items, { now, includeAutomationRuns: true }).planned.map((i) => i.id)
    ).toEqual(['a', 'b']);
  });

  it('drops done items older than the window and keeps recent ones', () => {
    const items = [
      item({ id: 'recent', status: 'done', statusChangedAt: '2026-07-28T12:00:00.000Z' }),
      item({ id: 'old', status: 'done', statusChangedAt: '2026-07-01T12:00:00.000Z' }),
    ];
    expect(groupWorkHubItems(items, { now }).done.map((i) => i.id)).toEqual(['recent']);
  });

  it('drops cancelled and duplicate tasks entirely', () => {
    const groups = groupWorkHubItems(
      [item({ id: 'a', status: 'cancelled' }), item({ id: 'b', status: 'duplicate' })],
      { now }
    );
    expect(Object.values(groups).flat()).toEqual([]);
  });

  it('sorts each section pinned-first, then by most recently updated', () => {
    const items = [
      item({ id: 'older', updatedAt: '2026-07-27T00:00:00.000Z' }),
      item({ id: 'newer', updatedAt: '2026-07-28T00:00:00.000Z' }),
      item({ id: 'pinned', isPinned: true, updatedAt: '2026-07-20T00:00:00.000Z' }),
    ];
    expect(groupWorkHubItems(items, { now }).planned.map((i) => i.id)).toEqual([
      'pinned',
      'newer',
      'older',
    ]);
  });
});

function linkedIssue(
  identifier: string,
  provider: LinkedIssue['provider'] = 'linear'
): LinkedIssue {
  return {
    provider,
    identifier,
    title: `Issue ${identifier}`,
    url: `https://linear.app/acme/issue/${identifier}`,
  };
}

describe('filterUnstartedIssues', () => {
  it('drops issues already linked to a task, matching provider and identifier', () => {
    const issues = [linkedIssue('GEN-1'), linkedIssue('GEN-2'), linkedIssue('GEN-3', 'jira')];
    const items = [
      item({ id: 'a', linkedIssue: linkedIssue('GEN-1') }),
      // Same identifier under another provider must not shadow the Linear one.
      item({ id: 'b', linkedIssue: linkedIssue('GEN-2', 'jira') }),
      item({ id: 'c' }),
    ];
    expect(filterUnstartedIssues(issues, items).map((i) => i.identifier)).toEqual([
      'GEN-2',
      'GEN-3',
    ]);
  });

  it('keeps everything when no tasks have linked issues', () => {
    expect(filterUnstartedIssues([linkedIssue('GEN-1')], [item({})])).toHaveLength(1);
    expect(filterUnstartedIssues([], [])).toEqual([]);
  });
});

function check(conclusion: string | null, status = 'COMPLETED'): PullRequestCheck {
  return {
    id: 'check-1',
    pullRequestUrl: 'https://github.com/acme/repo/pull/1',
    commitSha: 'sha',
    name: 'ci',
    status,
    conclusion,
    detailsUrl: null,
    startedAt: null,
    completedAt: null,
    workflowName: null,
    appName: null,
    appLogoUrl: null,
  };
}

function pr(overrides: Partial<PullRequest>): PullRequest {
  return {
    url: 'https://github.com/acme/repo/pull/1',
    provider: 'github',
    repositoryUrl: 'https://github.com/acme/repo',
    baseRefName: 'main',
    baseRefOid: 'base',
    headRepositoryUrl: 'https://github.com/acme/repo',
    headRefName: 'feature',
    headRefOid: 'head',
    identifier: '#1',
    title: 'A PR',
    description: null,
    status: 'open',
    isDraft: false,
    additions: null,
    deletions: null,
    changedFiles: null,
    commitCount: null,
    mergeableStatus: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    author: null,
    labels: [],
    assignees: [],
    checks: [],
    ...overrides,
  };
}

describe('prHasFailingChecks', () => {
  it('treats FAILURE, TIMED_OUT, and ACTION_REQUIRED conclusions as failing', () => {
    expect(prHasFailingChecks(pr({ checks: [check('FAILURE')] }))).toBe(true);
    expect(prHasFailingChecks(pr({ checks: [check('TIMED_OUT')] }))).toBe(true);
    expect(prHasFailingChecks(pr({ checks: [check('ACTION_REQUIRED')] }))).toBe(true);
  });

  it('ignores successful, neutral, and still-running checks', () => {
    expect(prHasFailingChecks(pr({ checks: [check('SUCCESS')] }))).toBe(false);
    expect(prHasFailingChecks(pr({ checks: [check('NEUTRAL')] }))).toBe(false);
    expect(prHasFailingChecks(pr({ checks: [check(null, 'IN_PROGRESS')] }))).toBe(false);
    expect(prHasFailingChecks(pr({ checks: [] }))).toBe(false);
  });
});

describe('authoredPrNeedsAttention', () => {
  it('flags failing checks, conflicts, and changes requested on open PRs', () => {
    expect(authoredPrNeedsAttention(pr({ checks: [check('FAILURE')] }))).toBe(true);
    expect(authoredPrNeedsAttention(pr({ mergeableStatus: 'CONFLICTING' }))).toBe(true);
    expect(authoredPrNeedsAttention(pr({ reviewDecision: 'CHANGES_REQUESTED' }))).toBe(true);
  });

  it('never flags healthy or non-open PRs', () => {
    expect(authoredPrNeedsAttention(pr({}))).toBe(false);
    expect(authoredPrNeedsAttention(pr({ status: 'merged', checks: [check('FAILURE')] }))).toBe(
      false
    );
  });
});

describe('sortAuthoredPrs', () => {
  it('sorts needs-attention first, then most recently updated', () => {
    const prItem = (overrides: Partial<PullRequest>) => ({
      projectId: 'project-1',
      pr: pr(overrides),
    });
    const healthyNewer = prItem({ url: 'a', updatedAt: '2026-07-29T00:00:00.000Z' });
    const healthyOlder = prItem({ url: 'b', updatedAt: '2026-07-27T00:00:00.000Z' });
    const failingOlder = prItem({
      url: 'c',
      updatedAt: '2026-07-20T00:00:00.000Z',
      checks: [check('FAILURE')],
    });
    expect(
      sortAuthoredPrs([healthyOlder, healthyNewer, failingOlder]).map((i) => i.pr.url)
    ).toEqual(['c', 'a', 'b']);
  });
});
