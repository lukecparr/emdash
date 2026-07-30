import type { AgentStatus } from '@shared/core/agents/agentEvents';
import type { LinkedIssue } from '@shared/core/linked-issue';
import type { PullRequest } from '@shared/core/pull-requests/pull-requests';
import type { TaskLifecycleStatus } from '@shared/core/tasks/tasks';

export interface WorkHubProjectRef {
  id: string;
  name: string;
}

export interface WorkHubAgentSummary {
  status: AgentStatus | null;
  /** Whether the winning status came from a conversation the user has not seen yet. */
  unseen: boolean;
}

export interface WorkHubItem {
  /** Task id. */
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  status: TaskLifecycleStatus;
  statusChangedAt: string;
  updatedAt: string;
  isPinned: boolean;
  type: 'task' | 'automation-run';
  linkedIssue?: LinkedIssue;
  branchName?: string;
  currentPr?: PullRequest;
  agent: WorkHubAgentSummary;
}

export interface WorkHubSnapshot {
  projects: WorkHubProjectRef[];
  items: WorkHubItem[];
  /** Open PRs where the viewer's review is requested (excluding viewer-authored), updatedAt desc. */
  reviewRequests: PullRequest[];
  /** All open PRs authored by the viewer, updatedAt desc. */
  authoredPrs: PullRequest[];
}

const FAILING_CHECK_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED']);

export function prHasFailingChecks(pr: Pick<PullRequest, 'checks'>): boolean {
  return pr.checks.some(
    (check) => check.conclusion !== null && FAILING_CHECK_CONCLUSIONS.has(check.conclusion)
  );
}

/** An authored PR needs the author's attention: failing CI, conflicts, or changes requested. */
export function authoredPrNeedsAttention(
  pr: Pick<PullRequest, 'status' | 'checks' | 'mergeableStatus' | 'reviewDecision'>
): boolean {
  if (pr.status !== 'open') return false;
  return (
    prHasFailingChecks(pr) ||
    pr.mergeableStatus === 'CONFLICTING' ||
    pr.reviewDecision === 'CHANGES_REQUESTED'
  );
}

/** Sort for the "My PRs" section: needs-attention first, then most recently updated. */
export function sortAuthoredPrs(prs: readonly PullRequest[]): PullRequest[] {
  return [...prs].sort((a, b) => {
    const aAttention = authoredPrNeedsAttention(a);
    const bAttention = authoredPrNeedsAttention(b);
    if (aAttention !== bAttention) return aAttention ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export const workHubSections = ['attention', 'active', 'review', 'planned', 'done'] as const;
export type WorkHubSection = (typeof workHubSections)[number];

export interface WorkHubConversationStatus {
  status: AgentStatus | null;
  seen: boolean;
}

/**
 * Roll up per-conversation agent statuses into one task-level summary.
 * Mirrors ConversationManager.taskStatus in the renderer: an unseen
 * awaiting-input wins outright, then working, then unseen error, then
 * unseen completed. Seen attention states do not surface.
 */
export function aggregateAgentStatus(
  conversations: readonly WorkHubConversationStatus[]
): WorkHubAgentSummary {
  let hasWorking = false;
  let hasUnseenError = false;
  let hasUnseenCompleted = false;
  for (const conversation of conversations) {
    if (!conversation.seen && conversation.status === 'awaiting-input') {
      return { status: 'awaiting-input', unseen: true };
    }
    if (conversation.status === 'working') hasWorking = true;
    if (!conversation.seen && conversation.status === 'error') hasUnseenError = true;
    if (!conversation.seen && conversation.status === 'completed') hasUnseenCompleted = true;
  }
  if (hasWorking) return { status: 'working', unseen: false };
  if (hasUnseenError) return { status: 'error', unseen: true };
  if (hasUnseenCompleted) return { status: 'completed', unseen: true };
  return { status: null, unseen: false };
}

/**
 * Assign an item to a hub section. Agent attention wins over lifecycle
 * status so an errored agent surfaces even on a done task. Cancelled and
 * duplicate tasks are excluded entirely (null).
 */
export function sectionForItem(item: Pick<WorkHubItem, 'status' | 'agent'>): WorkHubSection | null {
  if (item.agent.status === 'awaiting-input' || item.agent.status === 'error') return 'attention';
  if (item.agent.status === 'working' || item.status === 'in_progress') return 'active';
  if (item.status === 'review') return 'review';
  if (item.status === 'todo' || item.status === 'backlog' || item.status === 'triage') {
    return 'planned';
  }
  if (item.status === 'done') return 'done';
  return null;
}

const DEFAULT_DONE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface GroupWorkHubItemsOptions {
  now: number;
  doneWindowMs?: number;
  includeAutomationRuns?: boolean;
}

/**
 * Group items into ordered hub sections. Automation-run tasks are dropped
 * unless opted in, done items older than the window are dropped, and each
 * section sorts pinned items first, then most recently updated.
 */
export function groupWorkHubItems(
  items: readonly WorkHubItem[],
  options: GroupWorkHubItemsOptions
): Record<WorkHubSection, WorkHubItem[]> {
  const { now, doneWindowMs = DEFAULT_DONE_WINDOW_MS, includeAutomationRuns = false } = options;
  const groups: Record<WorkHubSection, WorkHubItem[]> = {
    attention: [],
    active: [],
    review: [],
    planned: [],
    done: [],
  };
  for (const item of items) {
    if (!includeAutomationRuns && item.type === 'automation-run') continue;
    const section = sectionForItem(item);
    if (section === null) continue;
    if (section === 'done') {
      const changedAt = Date.parse(item.statusChangedAt);
      if (Number.isFinite(changedAt) && now - changedAt > doneWindowMs) continue;
    }
    groups[section].push(item);
  }
  for (const section of workHubSections) {
    groups[section].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }
  return groups;
}
