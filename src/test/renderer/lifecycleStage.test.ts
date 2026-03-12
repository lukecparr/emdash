import { describe, it, expect } from 'vitest';
import {
  deriveLifecycleStage,
  computeLifecycleInfo,
  LIFECYCLE_GROUPS,
} from '../../renderer/lib/lifecycleStage';
import type { PrStatus } from '../../renderer/lib/prStatus';
import type { CheckRunsStatus } from '../../renderer/lib/checkRunStatus';

describe('deriveLifecycleStage', () => {
  it('returns "working" when pr is null', () => {
    expect(deriveLifecycleStage(null)).toBe('working');
  });

  it('returns "working" when pr is undefined', () => {
    expect(deriveLifecycleStage(undefined)).toBe('working');
  });

  it('returns "merged" when state is MERGED', () => {
    const pr: PrStatus = { state: 'MERGED' };
    expect(deriveLifecycleStage(pr)).toBe('merged');
  });

  it('returns "merged" for lowercase merged state', () => {
    const pr: PrStatus = { state: 'merged' };
    expect(deriveLifecycleStage(pr)).toBe('merged');
  });

  it('returns "working" when state is CLOSED (not merged)', () => {
    const pr: PrStatus = { state: 'CLOSED' };
    expect(deriveLifecycleStage(pr)).toBe('working');
  });

  it('returns "draft" when isDraft is true', () => {
    const pr: PrStatus = { state: 'OPEN', isDraft: true };
    expect(deriveLifecycleStage(pr)).toBe('draft');
  });

  it('returns "approved" when reviewDecision is APPROVED', () => {
    const pr: PrStatus = { state: 'OPEN', isDraft: false, reviewDecision: 'APPROVED' };
    expect(deriveLifecycleStage(pr)).toBe('approved');
  });

  it('returns "in-review" for open, non-draft, non-approved PR', () => {
    const pr: PrStatus = { state: 'OPEN', isDraft: false };
    expect(deriveLifecycleStage(pr)).toBe('in-review');
  });

  it('returns "in-review" when reviewDecision is CHANGES_REQUESTED', () => {
    const pr: PrStatus = { state: 'OPEN', isDraft: false, reviewDecision: 'CHANGES_REQUESTED' };
    expect(deriveLifecycleStage(pr)).toBe('in-review');
  });

  it('returns "in-review" when reviewDecision is empty string', () => {
    const pr: PrStatus = { state: 'OPEN', isDraft: false, reviewDecision: '' };
    expect(deriveLifecycleStage(pr)).toBe('in-review');
  });
});

describe('computeLifecycleInfo', () => {
  it('returns gray dot for working stage', () => {
    const info = computeLifecycleInfo(null, null);
    expect(info.stage).toBe('working');
    expect(info.dotColor).toBe('gray');
    expect(info.pulse).toBe(false);
  });

  it('returns gray dot for draft PR', () => {
    const pr: PrStatus = { state: 'OPEN', isDraft: true };
    const info = computeLifecycleInfo(pr, null);
    expect(info.stage).toBe('draft');
    expect(info.dotColor).toBe('gray');
  });

  it('returns yellow pulsing dot when in review with pending checks', () => {
    const pr: PrStatus = { state: 'OPEN', isDraft: false };
    const checks: CheckRunsStatus = {
      checks: [],
      summary: { total: 1, passed: 0, failed: 0, pending: 1, skipped: 0, cancelled: 0 },
      allComplete: false,
      hasFailures: false,
    };
    const info = computeLifecycleInfo(pr, checks);
    expect(info.stage).toBe('in-review');
    expect(info.dotColor).toBe('yellow');
    expect(info.pulse).toBe(true);
  });

  it('returns red dot when in review with failing checks', () => {
    const pr: PrStatus = { state: 'OPEN', isDraft: false };
    const checks: CheckRunsStatus = {
      checks: [],
      summary: { total: 1, passed: 0, failed: 1, pending: 0, skipped: 0, cancelled: 0 },
      allComplete: true,
      hasFailures: true,
    };
    const info = computeLifecycleInfo(pr, checks);
    expect(info.stage).toBe('in-review');
    expect(info.dotColor).toBe('red');
  });

  it('returns blue dot when in review with all checks passing', () => {
    const pr: PrStatus = { state: 'OPEN', isDraft: false };
    const checks: CheckRunsStatus = {
      checks: [],
      summary: { total: 1, passed: 1, failed: 0, pending: 0, skipped: 0, cancelled: 0 },
      allComplete: true,
      hasFailures: false,
    };
    const info = computeLifecycleInfo(pr, checks);
    expect(info.stage).toBe('in-review');
    expect(info.dotColor).toBe('blue');
  });

  it('returns green dot when approved with passing checks', () => {
    const pr: PrStatus = { state: 'OPEN', isDraft: false, reviewDecision: 'APPROVED' };
    const checks: CheckRunsStatus = {
      checks: [],
      summary: { total: 1, passed: 1, failed: 0, pending: 0, skipped: 0, cancelled: 0 },
      allComplete: true,
      hasFailures: false,
    };
    const info = computeLifecycleInfo(pr, checks);
    expect(info.stage).toBe('approved');
    expect(info.dotColor).toBe('green');
  });

  it('returns red dot when approved but checks failing', () => {
    const pr: PrStatus = { state: 'OPEN', isDraft: false, reviewDecision: 'APPROVED' };
    const checks: CheckRunsStatus = {
      checks: [],
      summary: { total: 1, passed: 0, failed: 1, pending: 0, skipped: 0, cancelled: 0 },
      allComplete: true,
      hasFailures: true,
    };
    const info = computeLifecycleInfo(pr, checks);
    expect(info.stage).toBe('approved');
    expect(info.dotColor).toBe('red');
  });

  it('returns purple dot for merged PR', () => {
    const pr: PrStatus = { state: 'MERGED' };
    const info = computeLifecycleInfo(pr, null);
    expect(info.stage).toBe('merged');
    expect(info.dotColor).toBe('purple');
  });
});

describe('LIFECYCLE_GROUPS', () => {
  it('has 4 groups in correct order', () => {
    expect(LIFECYCLE_GROUPS.map((g) => g.stage)).toEqual([
      'working',
      'draft',
      'in-review',
      'approved',
    ]);
  });

  it('each group has a label and emptyHint', () => {
    for (const group of LIFECYCLE_GROUPS) {
      expect(group.label).toBeTruthy();
      expect(group.emptyHint).toBeTruthy();
    }
  });
});
