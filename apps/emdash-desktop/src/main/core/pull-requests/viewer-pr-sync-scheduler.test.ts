import { err, ok } from '@emdash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewerPrSyncScheduler } from './viewer-pr-sync-scheduler';

const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  syncAccount: vi.fn(),
  pruneFlagsForMissingAccounts: vi.fn(),
  pruneOrphanPrRows: vi.fn(),
}));

vi.mock('@main/core/github/accounts/github-account-service-instance', () => ({
  githubAccountService: {
    listAccounts: mocks.listAccounts,
  },
}));

vi.mock('./viewer-pr-sync-service', () => ({
  viewerPrSyncService: {
    syncAccount: mocks.syncAccount,
    pruneFlagsForMissingAccounts: mocks.pruneFlagsForMissingAccounts,
    pruneOrphanPrRows: mocks.pruneOrphanPrRows,
  },
}));

const ACCOUNT_A = { accountId: 'github.com:1', host: 'github.com', login: 'a' };
const ACCOUNT_B = { accountId: 'github.com:2', host: 'github.com', login: 'b' };

describe('ViewerPrSyncScheduler', () => {
  let scheduler: ViewerPrSyncScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.listAccounts.mockResolvedValue([ACCOUNT_A, ACCOUNT_B]);
    mocks.syncAccount.mockResolvedValue(ok());
    mocks.pruneFlagsForMissingAccounts.mockResolvedValue(undefined);
    mocks.pruneOrphanPrRows.mockResolvedValue(undefined);
    scheduler = new ViewerPrSyncScheduler();
  });

  afterEach(() => {
    scheduler.dispose();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('syncs every account serially and prunes afterwards', async () => {
    await scheduler.syncAll();

    expect(mocks.pruneFlagsForMissingAccounts).toHaveBeenCalledWith([
      ACCOUNT_A.accountId,
      ACCOUNT_B.accountId,
    ]);
    expect(mocks.syncAccount).toHaveBeenNthCalledWith(1, {
      accountId: ACCOUNT_A.accountId,
      host: ACCOUNT_A.host,
    });
    expect(mocks.syncAccount).toHaveBeenNthCalledWith(2, {
      accountId: ACCOUNT_B.accountId,
      host: ACCOUNT_B.host,
    });
    expect(mocks.pruneOrphanPrRows).toHaveBeenCalledTimes(1);
  });

  it('continues to the next account when one fails', async () => {
    mocks.syncAccount
      .mockResolvedValueOnce(err({ type: 'api_error', message: 'boom' }))
      .mockResolvedValueOnce(ok());

    await scheduler.syncAll();

    expect(mocks.syncAccount).toHaveBeenCalledTimes(2);
    expect(mocks.pruneOrphanPrRows).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent syncAll calls', async () => {
    const first = scheduler.syncAll();
    const second = scheduler.syncAll();
    expect(second).toBe(first);
    await first;
    expect(mocks.listAccounts).toHaveBeenCalledTimes(1);
  });

  it('debounces requestResync', async () => {
    scheduler.requestResync('one');
    scheduler.requestResync('two');
    expect(mocks.listAccounts).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_000);
    expect(mocks.listAccounts).toHaveBeenCalledTimes(1);
  });

  it('dispose cancels pending timers', async () => {
    scheduler.requestResync('pending');
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.listAccounts).not.toHaveBeenCalled();
  });
});
