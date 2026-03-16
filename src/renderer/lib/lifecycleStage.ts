import type { PrStatus } from './prStatus';
import type { CheckRunsStatus } from './checkRunStatus';

/**
 * Task lifecycle stages derived from GitHub PR state.
 *
 * - working:   No PR exists yet (agent is coding)
 * - draft:     PR exists but is marked as draft
 * - in-review: PR is open, not draft, not yet approved
 * - approved:  PR has been approved (reviewDecision === 'APPROVED')
 * - merged:    PR has been merged
 */
export type LifecycleStage = 'working' | 'draft' | 'in-review' | 'approved' | 'merged';

export interface LifecycleInfo {
  stage: LifecycleStage;
  /** Color for the status dot indicator */
  dotColor: 'gray' | 'yellow' | 'blue' | 'green' | 'purple' | 'red';
  /** Whether the dot should pulse (e.g. checks in progress) */
  pulse: boolean;
  /** Short label for the stage */
  label: string;
}

/** Sidebar group definitions in display order */
export const LIFECYCLE_GROUPS: { stage: LifecycleStage; label: string; emptyHint: string }[] = [
  { stage: 'working', label: 'Working', emptyHint: 'No tasks in progress' },
  { stage: 'draft', label: 'Draft PR', emptyHint: 'No draft PRs' },
  { stage: 'in-review', label: 'In Review', emptyHint: 'No PRs in review' },
  { stage: 'approved', label: 'Approved / Merged', emptyHint: 'No approved PRs' },
];

/**
 * Derive the lifecycle stage for a task from its PR status.
 */
export function deriveLifecycleStage(pr: PrStatus | null | undefined): LifecycleStage {
  if (!pr) return 'working';

  const state = typeof pr.state === 'string' ? pr.state.toUpperCase() : '';

  if (state === 'MERGED') return 'merged';
  if (state === 'CLOSED') return 'working'; // closed without merge — treat as no PR

  if (pr.isDraft) return 'draft';

  const reviewDecision =
    typeof pr.reviewDecision === 'string' ? pr.reviewDecision.toUpperCase() : '';
  if (reviewDecision === 'APPROVED') return 'approved';

  return 'in-review';
}

/**
 * Compute full lifecycle info including CI check status for the dot indicator.
 */
export function computeLifecycleInfo(
  pr: PrStatus | null | undefined,
  checkRuns: CheckRunsStatus | null | undefined
): LifecycleInfo {
  const stage = deriveLifecycleStage(pr);

  switch (stage) {
    case 'working':
      return { stage, dotColor: 'gray', pulse: false, label: 'Working' };

    case 'draft':
      return { stage, dotColor: 'gray', pulse: false, label: 'Draft' };

    case 'in-review': {
      // CI status determines the dot color when in review
      if (checkRuns) {
        if (!checkRuns.allComplete) {
          return { stage, dotColor: 'yellow', pulse: true, label: 'Checks running' };
        }
        if (checkRuns.hasFailures) {
          return { stage, dotColor: 'red', pulse: false, label: 'Checks failing' };
        }
        return { stage, dotColor: 'blue', pulse: false, label: 'In review' };
      }
      return { stage, dotColor: 'blue', pulse: false, label: 'In review' };
    }

    case 'approved': {
      // Even if approved, show CI failures
      if (checkRuns?.hasFailures && checkRuns.allComplete) {
        return { stage, dotColor: 'red', pulse: false, label: 'Approved · checks failing' };
      }
      if (checkRuns && !checkRuns.allComplete) {
        return { stage, dotColor: 'yellow', pulse: true, label: 'Approved · checks running' };
      }
      return { stage, dotColor: 'green', pulse: false, label: 'Approved' };
    }

    case 'merged':
      return { stage, dotColor: 'purple', pulse: false, label: 'Merged' };
  }
}
