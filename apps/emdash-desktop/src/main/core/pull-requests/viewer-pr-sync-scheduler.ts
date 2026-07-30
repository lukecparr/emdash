import type { IDisposable, IInitializable } from '@emdash/shared';
import { githubAccountService } from '@main/core/github/accounts/github-account-service-instance';
import { log } from '@main/lib/logger';
import { prSyncEngineErrorMessage } from './pr-sync-errors';
import { viewerPrSyncService } from './viewer-pr-sync-service';

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const RESYNC_DEBOUNCE_MS = 3_000;

/**
 * Periodically syncs viewer-scoped PRs (review requests + authored) for every
 * connected GitHub account, independent of which projects are open.
 *
 * Account mutations must call requestResync() directly: main-emitted event
 * channels only broadcast to renderer windows, so a main-side subscription
 * would never fire.
 */
export class ViewerPrSyncScheduler implements IInitializable, IDisposable {
  private timer: ReturnType<typeof setInterval> | null = null;
  private resyncTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;

  initialize(): void {
    if (this.timer) return;
    void this.syncAll();
    this.timer = setInterval(() => void this.syncAll(), SYNC_INTERVAL_MS);
    this.timer.unref?.();
  }

  requestResync(reason: string): void {
    log.info('ViewerPrSyncScheduler: resync requested', { reason });
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = null;
      void this.syncAll();
    }, RESYNC_DEBOUNCE_MS);
    this.resyncTimer.unref?.();
  }

  syncAll(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this._syncAll().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    this.resyncTimer = null;
  }

  private async _syncAll(): Promise<void> {
    try {
      const accounts = await githubAccountService.listAccounts();
      await viewerPrSyncService.pruneFlagsForMissingAccounts(accounts.map((a) => a.accountId));

      for (const account of accounts) {
        const result = await viewerPrSyncService.syncAccount({
          accountId: account.accountId,
          host: account.host,
        });
        if (!result.success) {
          log.warn('ViewerPrSyncScheduler: account sync failed', {
            accountId: account.accountId,
            error: prSyncEngineErrorMessage(result.error),
          });
        }
      }

      await viewerPrSyncService.pruneOrphanPrRows();
    } catch (error) {
      log.error('ViewerPrSyncScheduler: sync cycle failed', { error });
    }
  }
}

export const viewerPrSyncScheduler = new ViewerPrSyncScheduler();
