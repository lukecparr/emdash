import { err, ok, type Result } from '@emdash/shared';
import type { Octokit } from '@octokit/rest';
import { and, eq, notInArray } from 'drizzle-orm';
import { getOctokit } from '@main/core/github/services/octokit-provider';
import { VIEWER_SEARCH_PRS_QUERY } from '@main/core/github/services/pr-queries';
import { db } from '@main/db/client';
import { projectRemotes, pullRequests, pullRequestViewerFlags } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { githubRateLimiter } from '@main/lib/rate-limiter';
import { withRetry } from '@main/lib/retry';
import { viewerPrsUpdatedChannel } from '@shared/core/pull-requests/prEvents';
import type { PullRequest } from '@shared/core/pull-requests/pull-requests';
import { prSyncEngine, type GqlPrNode, type PrSyncEngine } from './pr-sync-engine';
import { isPrSyncHostUnreachable, toPrApiError, type PrSyncEngineError } from './pr-sync-errors';

const SEARCH_PAGE_SIZE = 50;
const SEARCH_MAX_RESULTS = 100;
const AUTHORED_CHECKS_LIMIT = 30;
const FLAGS_INSERT_CHUNK = 150;

export const REVIEW_REQUESTED_SEARCH = 'is:pr is:open review-requested:@me archived:false';
export const AUTHORED_SEARCH = 'is:pr is:open author:@me archived:false';

export interface ViewerAccountRef {
  accountId: string;
  host: string;
}

interface SearchPage {
  search: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<GqlPrNode | Record<string, never>>;
  };
}

export class ViewerPrSyncService {
  constructor(
    private readonly engine: Pick<PrSyncEngine, 'upsertSearchResults' | 'syncChecks'>,
    private readonly getOctokitFn: typeof getOctokit = getOctokit
  ) {}

  /**
   * Sync review-requested and authored open PRs for one account, then rewrite
   * that account's viewer flags. On failure the account's existing flags are
   * left untouched so a transient outage never empties the review inbox.
   */
  async syncAccount(account: ViewerAccountRef): Promise<Result<void, PrSyncEngineError>> {
    const octokit = await this.getOctokitFn(account.host, { accountId: account.accountId });
    if (!octokit.success) return err(octokit.error);

    let reviewNodes: GqlPrNode[];
    let authoredNodes: GqlPrNode[];
    try {
      reviewNodes = await this._search(octokit.data, REVIEW_REQUESTED_SEARCH);
      authoredNodes = await this._search(octokit.data, AUTHORED_SEARCH);
    } catch (error) {
      const apiError = toPrApiError(error, 'Unable to sync viewer pull requests.', account.host);
      if (isPrSyncHostUnreachable(apiError)) {
        log.warn('ViewerPrSync: host unreachable', { host: account.host });
      } else {
        log.error('ViewerPrSync: search failed', { accountId: account.accountId, error });
      }
      return err(apiError);
    }

    const reviewUrls = new Set(reviewNodes.map((n) => n.url));
    const authoredUrls = new Set(authoredNodes.map((n) => n.url));
    const nodesByUrl = new Map<string, GqlPrNode>();
    for (const node of [...reviewNodes, ...authoredNodes]) nodesByUrl.set(node.url, node);

    const prs = await this.engine.upsertSearchResults([...nodesByUrl.values()]);

    // Flags only for rows that actually exist; skipped/failed upserts get none.
    const syncedAt = new Date().toISOString();
    const flagRows = prs.map((pr) => ({
      pullRequestUrl: pr.url,
      providerAccountId: account.accountId,
      reviewRequested: reviewUrls.has(pr.url) ? 1 : 0,
      authored: authoredUrls.has(pr.url) ? 1 : 0,
      syncedAt,
    }));

    await db
      .delete(pullRequestViewerFlags)
      .where(eq(pullRequestViewerFlags.providerAccountId, account.accountId));
    for (let i = 0; i < flagRows.length; i += FLAGS_INSERT_CHUNK) {
      await db.insert(pullRequestViewerFlags).values(flagRows.slice(i, i + FLAGS_INSERT_CHUNK));
    }

    events.emit(viewerPrsUpdatedChannel, { accountId: account.accountId });

    await this._syncAuthoredChecks(account, prs, authoredUrls);
    return ok();
  }

  /** Drop flags belonging to accounts that no longer exist. */
  async pruneFlagsForMissingAccounts(liveAccountIds: string[]): Promise<void> {
    if (liveAccountIds.length === 0) {
      await db.delete(pullRequestViewerFlags);
      return;
    }
    await db
      .delete(pullRequestViewerFlags)
      .where(notInArray(pullRequestViewerFlags.providerAccountId, liveAccountIds));
  }

  /**
   * Delete PR rows that no viewer flag references and that no project remote
   * covers (base or fork head) — rows only the viewer sync ever brought in.
   */
  async pruneOrphanPrRows(): Promise<void> {
    const flaggedUrls = db
      .select({ url: pullRequestViewerFlags.pullRequestUrl })
      .from(pullRequestViewerFlags);
    const remoteUrls = db.select({ url: projectRemotes.remoteUrl }).from(projectRemotes);
    await db
      .delete(pullRequests)
      .where(
        and(
          notInArray(pullRequests.url, flaggedUrls),
          notInArray(pullRequests.repositoryUrl, remoteUrls),
          notInArray(pullRequests.headRepositoryUrl, remoteUrls)
        )
      );
  }

  private async _search(octokit: Octokit, searchQuery: string): Promise<GqlPrNode[]> {
    const nodes: GqlPrNode[] = [];
    let cursor: string | null = null;
    while (nodes.length < SEARCH_MAX_RESULTS) {
      const page: SearchPage = await withRetry(() =>
        githubRateLimiter.acquire().then(() =>
          octokit.graphql<SearchPage>(VIEWER_SEARCH_PRS_QUERY, {
            searchQuery,
            limit: SEARCH_PAGE_SIZE,
            cursor,
          })
        )
      );
      for (const node of page.search.nodes) {
        // Search can return non-PR issue nodes, which deserialize as {}.
        if ('url' in node) nodes.push(node as GqlPrNode);
      }
      if (!page.search.pageInfo.hasNextPage || !page.search.pageInfo.endCursor) break;
      cursor = page.search.pageInfo.endCursor;
    }
    return nodes.slice(0, SEARCH_MAX_RESULTS);
  }

  private async _syncAuthoredChecks(
    account: ViewerAccountRef,
    prs: PullRequest[],
    authoredUrls: Set<string>
  ): Promise<void> {
    const authored = prs
      .filter((pr) => authoredUrls.has(pr.url) && pr.status === 'open')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, AUTHORED_CHECKS_LIMIT);

    for (const pr of authored) {
      const result = await this.engine.syncChecks(pr.url, pr.headRefOid, {
        accountId: account.accountId,
      });
      if (!result.success) {
        log.warn('ViewerPrSync: check sync failed', { url: pr.url, error: result.error });
      }
    }
  }
}

export const viewerPrSyncService = new ViewerPrSyncService(prSyncEngine);
