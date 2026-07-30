import { err, ok } from '@emdash/shared';
import type { Octokit } from '@octokit/rest';
import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDb } from '@main/db/client';
import { projectRemotes, projects, pullRequests, pullRequestViewerFlags } from '@main/db/schema';
import { PrSyncEngine, type GqlPrNode } from './pr-sync-engine';
import {
  AUTHORED_SEARCH,
  REVIEW_REQUESTED_SEARCH,
  ViewerPrSyncService,
} from './viewer-pr-sync-service';

const mocks = vi.hoisted(() => ({
  db: undefined as AppDb | undefined,
}));

vi.mock('@main/db/client', () => ({
  get db() {
    if (!mocks.db) throw new Error('Test database not initialized');
    return mocks.db;
  },
}));

vi.mock('@main/core/github/services/octokit-provider', () => ({
  getOctokit: vi.fn(),
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn() },
}));

const ACCOUNT_A = { accountId: 'github.com:1', host: 'github.com' };
const ACCOUNT_B = { accountId: 'github.com:2', host: 'github.com' };
const REPO = 'https://github.com/acme/service';
const PROJECT_REPO = 'https://github.com/acme/project';

function prNode(overrides: Partial<GqlPrNode> & { url: string }): GqlPrNode {
  const repoUrl = overrides.baseRepository?.url ?? REPO;
  return {
    number: 1,
    title: 'A PR',
    state: 'OPEN',
    isDraft: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    headRefName: 'feature-x',
    headRefOid: 'head-oid',
    baseRefName: 'main',
    baseRefOid: 'base-oid',
    commitCount: { totalCount: 1 },
    body: null,
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    author: null,
    headRepository: { nameWithOwner: 'acme/service', url: repoUrl, owner: { login: 'acme' } },
    baseRepository: { url: repoUrl },
    labels: { nodes: [] },
    assignees: { nodes: [] },
    reviewDecision: null,
    ...overrides,
  };
}

/** One-page search result per query string. Pass arrays of pages for pagination. */
function fakeOctokit(pagesByQuery: Record<string, GqlPrNode[][]>): Octokit {
  const cursors = new Map<string, number>();
  return {
    graphql: vi.fn(async (_query: string, variables: { searchQuery: string }) => {
      const pages = pagesByQuery[variables.searchQuery] ?? [[]];
      const index = cursors.get(variables.searchQuery) ?? 0;
      cursors.set(variables.searchQuery, index + 1);
      const nodes = pages[Math.min(index, pages.length - 1)];
      return {
        search: {
          pageInfo: {
            hasNextPage: index < pages.length - 1,
            endCursor: index < pages.length - 1 ? `cursor-${index}` : null,
          },
          nodes,
        },
      };
    }),
  } as unknown as Octokit;
}

function makeService(pagesByQuery: Record<string, GqlPrNode[][]>) {
  const getOctokit = vi.fn().mockResolvedValue(ok(fakeOctokit(pagesByQuery)));
  const engine = new PrSyncEngine(getOctokit);
  const syncChecks = vi.fn().mockResolvedValue(ok(false));
  const service = new ViewerPrSyncService(
    { upsertSearchResults: engine.upsertSearchResults.bind(engine), syncChecks },
    getOctokit
  );
  return { service, engine, syncChecks, getOctokit };
}

describe('ViewerPrSyncService', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    mocks.db = fixture.db;
  });

  afterEach(() => {
    fixture.close();
    mocks.db = undefined;
    vi.clearAllMocks();
  });

  async function allFlags() {
    return fixture.db.select().from(pullRequestViewerFlags);
  }

  it('writes flags for review-requested and authored PRs, merging both bits for one PR', async () => {
    const both = prNode({ url: `${REPO}/pull/1`, number: 1 });
    const reviewOnly = prNode({ url: `${REPO}/pull/2`, number: 2 });
    const { service } = makeService({
      [REVIEW_REQUESTED_SEARCH]: [[both, reviewOnly]],
      [AUTHORED_SEARCH]: [[both]],
    });

    const result = await service.syncAccount(ACCOUNT_A);
    expect(result.success).toBe(true);

    const flags = await allFlags();
    expect(flags).toHaveLength(2);
    const bothFlag = flags.find((f) => f.pullRequestUrl === `${REPO}/pull/1`);
    expect(bothFlag).toMatchObject({ reviewRequested: 1, authored: 1 });
    const reviewFlag = flags.find((f) => f.pullRequestUrl === `${REPO}/pull/2`);
    expect(reviewFlag).toMatchObject({ reviewRequested: 1, authored: 0 });

    const prRows = await fixture.db.select().from(pullRequests);
    expect(prRows).toHaveLength(2);
  });

  it('keeps existing flags when the account sync fails', async () => {
    const node = prNode({ url: `${REPO}/pull/1` });
    const good = makeService({ [REVIEW_REQUESTED_SEARCH]: [[node]], [AUTHORED_SEARCH]: [[]] });
    await good.service.syncAccount(ACCOUNT_A);
    expect(await allFlags()).toHaveLength(1);

    const failing = makeService({});
    failing.getOctokit.mockResolvedValue(
      err({ type: 'auth_required', host: 'github.com', hint: 'connect' })
    );
    const result = await failing.service.syncAccount(ACCOUNT_A);
    expect(result.success).toBe(false);
    expect(await allFlags()).toHaveLength(1);
  });

  it('tracks the same PR independently per account', async () => {
    const node = prNode({ url: `${REPO}/pull/1` });
    const a = makeService({ [REVIEW_REQUESTED_SEARCH]: [[node]], [AUTHORED_SEARCH]: [[]] });
    await a.service.syncAccount(ACCOUNT_A);
    const b = makeService({ [REVIEW_REQUESTED_SEARCH]: [[]], [AUTHORED_SEARCH]: [[node]] });
    await b.service.syncAccount(ACCOUNT_B);

    const flags = await allFlags();
    expect(flags).toHaveLength(2);
    expect(new Set(flags.map((f) => f.providerAccountId))).toEqual(
      new Set([ACCOUNT_A.accountId, ACCOUNT_B.accountId])
    );
    expect(await fixture.db.select().from(pullRequests)).toHaveLength(1);
  });

  it('paginates search results and skips nodes without a baseRepository', async () => {
    const page1 = [prNode({ url: `${REPO}/pull/1`, number: 1 })];
    const page2 = [
      prNode({ url: `${REPO}/pull/2`, number: 2 }),
      prNode({ url: `${REPO}/pull/3`, number: 3, baseRepository: null }),
    ];
    const { service } = makeService({
      [REVIEW_REQUESTED_SEARCH]: [page1, page2],
      [AUTHORED_SEARCH]: [[]],
    });

    await service.syncAccount(ACCOUNT_A);

    const flags = await allFlags();
    expect(flags.map((f) => f.pullRequestUrl).sort()).toEqual([`${REPO}/pull/1`, `${REPO}/pull/2`]);
  });

  it('syncs checks only for authored open PRs', async () => {
    const authoredOpen = prNode({ url: `${REPO}/pull/1`, number: 1 });
    const authoredMerged = prNode({ url: `${REPO}/pull/2`, number: 2, state: 'MERGED' });
    const reviewOnly = prNode({ url: `${REPO}/pull/3`, number: 3 });
    const { service, syncChecks } = makeService({
      [REVIEW_REQUESTED_SEARCH]: [[reviewOnly]],
      [AUTHORED_SEARCH]: [[authoredOpen, authoredMerged]],
    });

    await service.syncAccount(ACCOUNT_A);

    expect(syncChecks).toHaveBeenCalledTimes(1);
    expect(syncChecks).toHaveBeenCalledWith(`${REPO}/pull/1`, 'head-oid', {
      accountId: ACCOUNT_A.accountId,
    });
  });

  it('prunes orphaned viewer-only rows but keeps flagged and project-remote rows', async () => {
    await fixture.db.insert(projects).values({ id: 'p1', name: 'P1', path: '/p1' });
    await fixture.db.insert(projectRemotes).values({
      projectId: 'p1',
      remoteName: 'origin',
      remoteUrl: PROJECT_REPO,
    });

    const flagged = prNode({ url: `${REPO}/pull/1`, number: 1 });
    const projectPr = prNode({
      url: `${PROJECT_REPO}/pull/2`,
      number: 2,
      baseRepository: { url: PROJECT_REPO },
      headRepository: { nameWithOwner: 'acme/project', url: PROJECT_REPO, owner: { login: 'a' } },
    });
    const orphan = prNode({ url: `${REPO}/pull/3`, number: 3 });

    const { service, engine } = makeService({
      [REVIEW_REQUESTED_SEARCH]: [[flagged]],
      [AUTHORED_SEARCH]: [[]],
    });
    // Seed all three rows, then flag only the first via a real sync.
    await engine.upsertSearchResults([flagged, projectPr, orphan]);
    await service.syncAccount(ACCOUNT_A);

    await service.pruneOrphanPrRows();

    const remaining = (await fixture.db.select().from(pullRequests)).map((r) => r.url).sort();
    expect(remaining).toEqual([`${PROJECT_REPO}/pull/2`, `${REPO}/pull/1`]);
  });

  it('clears all flags when no accounts remain', async () => {
    const node = prNode({ url: `${REPO}/pull/1` });
    const { service } = makeService({
      [REVIEW_REQUESTED_SEARCH]: [[node]],
      [AUTHORED_SEARCH]: [[]],
    });
    await service.syncAccount(ACCOUNT_A);
    expect(await allFlags()).toHaveLength(1);

    await service.pruneFlagsForMissingAccounts([]);
    expect(await allFlags()).toHaveLength(0);

    await service.pruneOrphanPrRows();
    expect(await fixture.db.select().from(pullRequests)).toHaveLength(0);
  });

  it('deleteProjectData keeps viewer-flagged rows for the removed project repo', async () => {
    await fixture.db.insert(projects).values({ id: 'p1', name: 'P1', path: '/p1' });
    await fixture.db.insert(projectRemotes).values({
      projectId: 'p1',
      remoteName: 'origin',
      remoteUrl: REPO,
    });

    const flagged = prNode({ url: `${REPO}/pull/1`, number: 1 });
    const unflagged = prNode({ url: `${REPO}/pull/2`, number: 2 });
    const { service, engine } = makeService({
      [REVIEW_REQUESTED_SEARCH]: [[flagged]],
      [AUTHORED_SEARCH]: [[]],
    });
    await engine.upsertSearchResults([flagged, unflagged]);
    await service.syncAccount(ACCOUNT_A);

    await engine.deleteProjectData('p1');

    const remaining = (await fixture.db.select().from(pullRequests)).map((r) => r.url);
    expect(remaining).toEqual([`${REPO}/pull/1`]);
  });
});
