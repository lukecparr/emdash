import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDb } from '@main/db/client';
import {
  conversations,
  projectRemotes,
  projects,
  pullRequests,
  pullRequestViewerFlags,
  tasks,
  workspaces,
} from '@main/db/schema';
import { getWorkHubSnapshot } from './work-hub-service';

const mocks = vi.hoisted(() => ({
  db: undefined as AppDb | undefined,
}));

vi.mock('@main/db/client', () => ({
  get db() {
    if (!mocks.db) throw new Error('Test database not initialized');
    return mocks.db;
  },
}));

const REPO_A = 'https://github.com/acme/alpha';
const REPO_B = 'https://github.com/acme/beta';
const NOW = '2026-07-29T12:00:00.000Z';

function taskRow(overrides: Partial<typeof tasks.$inferInsert> & { id: string }) {
  return {
    projectId: 'project-a',
    name: `Task ${overrides.id}`,
    status: 'todo',
    createdAt: NOW,
    updatedAt: NOW,
    statusChangedAt: NOW,
    ...overrides,
  };
}

function conversationRow(
  overrides: Partial<typeof conversations.$inferInsert> & { id: string; taskId: string }
) {
  return {
    projectId: 'project-a',
    title: 'Conversation',
    provider: 'claude-code',
    createdAt: NOW,
    ...overrides,
  };
}

function prRow(overrides: Partial<typeof pullRequests.$inferInsert> & { url: string }) {
  return {
    repositoryUrl: REPO_A,
    baseRefName: 'main',
    baseRefOid: 'base-oid',
    headRepositoryUrl: REPO_A,
    headRefName: 'feature/default',
    headRefOid: 'head-oid',
    identifier: '#1',
    title: 'A PR',
    status: 'open',
    isDraft: 0,
    ...overrides,
  };
}

describe('getWorkHubSnapshot', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    mocks.db = fixture.db;

    await fixture.db.insert(projects).values([
      { id: 'project-a', name: 'Alpha', path: '/alpha' },
      { id: 'project-b', name: 'Beta', path: '/beta' },
    ]);
    await fixture.db.insert(projectRemotes).values([
      { projectId: 'project-a', remoteName: 'origin', remoteUrl: REPO_A },
      { projectId: 'project-b', remoteName: 'origin', remoteUrl: REPO_B },
    ]);
  });

  afterEach(() => {
    fixture.close();
    mocks.db = undefined;
  });

  it('returns projects and an empty item list when there are no tasks', async () => {
    const snapshot = await getWorkHubSnapshot();
    expect(snapshot.projects).toEqual(
      expect.arrayContaining([
        { id: 'project-a', name: 'Alpha' },
        { id: 'project-b', name: 'Beta' },
      ])
    );
    expect(snapshot.items).toEqual([]);
    expect(snapshot.reviewRequests).toEqual([]);
    expect(snapshot.authoredPrs).toEqual([]);
  });

  it('returns viewer PR lists with authored excluded from review requests', async () => {
    const EXTERNAL_REPO = 'https://github.com/other/lib';
    await fixture.db.insert(pullRequests).values([
      prRow({
        url: `${EXTERNAL_REPO}/pull/1`,
        repositoryUrl: EXTERNAL_REPO,
        headRepositoryUrl: EXTERNAL_REPO,
        identifier: '#1',
        headRefName: 'review-me',
      }),
      prRow({
        url: `${EXTERNAL_REPO}/pull/2`,
        repositoryUrl: EXTERNAL_REPO,
        headRepositoryUrl: EXTERNAL_REPO,
        identifier: '#2',
        headRefName: 'mine',
      }),
      prRow({
        url: `${EXTERNAL_REPO}/pull/3`,
        repositoryUrl: EXTERNAL_REPO,
        headRepositoryUrl: EXTERNAL_REPO,
        identifier: '#3',
        headRefName: 'closed-one',
        status: 'closed',
      }),
    ]);
    await fixture.db.insert(pullRequestViewerFlags).values([
      // Review requested by one account, authored per another: authored wins exclusion.
      {
        pullRequestUrl: `${EXTERNAL_REPO}/pull/2`,
        providerAccountId: 'github.com:1',
        reviewRequested: 1,
        authored: 0,
        syncedAt: NOW,
      },
      {
        pullRequestUrl: `${EXTERNAL_REPO}/pull/2`,
        providerAccountId: 'github.com:2',
        reviewRequested: 0,
        authored: 1,
        syncedAt: NOW,
      },
      {
        pullRequestUrl: `${EXTERNAL_REPO}/pull/1`,
        providerAccountId: 'github.com:1',
        reviewRequested: 1,
        authored: 0,
        syncedAt: NOW,
      },
      // Closed PRs never surface even when flagged.
      {
        pullRequestUrl: `${EXTERNAL_REPO}/pull/3`,
        providerAccountId: 'github.com:1',
        reviewRequested: 1,
        authored: 1,
        syncedAt: NOW,
      },
    ]);

    const snapshot = await getWorkHubSnapshot();
    expect(snapshot.reviewRequests.map((pr) => pr.url)).toEqual([`${EXTERNAL_REPO}/pull/1`]);
    expect(snapshot.authoredPrs.map((pr) => pr.url)).toEqual([`${EXTERNAL_REPO}/pull/2`]);
  });

  it('excludes archived tasks and joins the project name', async () => {
    await fixture.db
      .insert(tasks)
      .values([
        taskRow({ id: 'task-live' }),
        taskRow({ id: 'task-archived', archivedAt: NOW }),
        taskRow({ id: 'task-beta', projectId: 'project-b' }),
      ]);

    const snapshot = await getWorkHubSnapshot();
    const ids = snapshot.items.map((i) => i.id).sort();
    expect(ids).toEqual(['task-beta', 'task-live']);
    expect(snapshot.items.find((i) => i.id === 'task-beta')?.projectName).toBe('Beta');
  });

  it('aggregates agent status across a task&apos;s conversations', async () => {
    await fixture.db
      .insert(tasks)
      .values([taskRow({ id: 'task-attention' }), taskRow({ id: 'task-quiet' })]);
    await fixture.db.insert(conversations).values([
      conversationRow({
        id: 'conv-1',
        taskId: 'task-attention',
        agentStatus: 'working',
        agentStatusSeen: 1,
      }),
      conversationRow({
        id: 'conv-2',
        taskId: 'task-attention',
        agentStatus: 'awaiting-input',
        agentStatusSeen: 0,
      }),
    ]);

    const snapshot = await getWorkHubSnapshot();
    const attention = snapshot.items.find((i) => i.id === 'task-attention');
    const quiet = snapshot.items.find((i) => i.id === 'task-quiet');
    expect(attention?.agent).toEqual({ status: 'awaiting-input', unseen: true });
    expect(quiet?.agent).toEqual({ status: null, unseen: false });
  });

  it('matches PRs by branch within the task&apos;s project remotes only', async () => {
    await fixture.db.insert(workspaces).values([
      {
        id: 'ws-a',
        kind: 'worktree',
        location: 'local',
        type: 'local',
        path: '/alpha-wt',
        branchName: 'feature-x',
        createdAt: NOW,
      },
      {
        id: 'ws-b',
        kind: 'worktree',
        location: 'local',
        type: 'local',
        path: '/beta-wt',
        branchName: 'feature-x',
        createdAt: NOW,
      },
    ]);
    await fixture.db
      .insert(tasks)
      .values([
        taskRow({ id: 'task-a', workspaceId: 'ws-a' }),
        taskRow({ id: 'task-b', projectId: 'project-b', workspaceId: 'ws-b' }),
        taskRow({ id: 'task-no-ws' }),
      ]);
    await fixture.db.insert(pullRequests).values([
      prRow({
        url: `${REPO_A}/pull/1`,
        identifier: '#1',
        headRefName: 'feature-x',
        status: 'merged',
        pullRequestCreatedAt: '2026-07-01T00:00:00.000Z',
      }),
      prRow({
        url: `${REPO_A}/pull/2`,
        identifier: '#2',
        headRefName: 'feature-x',
        status: 'open',
        pullRequestCreatedAt: '2026-07-02T00:00:00.000Z',
      }),
      prRow({
        url: `${REPO_B}/pull/3`,
        repositoryUrl: REPO_B,
        headRepositoryUrl: REPO_B,
        identifier: '#3',
        headRefName: 'feature-x',
        status: 'open',
      }),
    ]);

    const snapshot = await getWorkHubSnapshot();
    const taskA = snapshot.items.find((i) => i.id === 'task-a');
    const taskB = snapshot.items.find((i) => i.id === 'task-b');
    const taskNoWs = snapshot.items.find((i) => i.id === 'task-no-ws');

    expect(taskA?.branchName).toBe('feature-x');
    // Same branch name exists in both repos; each task only sees its own
    // project's PRs, and the open PR wins over the merged one.
    expect(taskA?.currentPr?.url).toBe(`${REPO_A}/pull/2`);
    expect(taskB?.currentPr?.url).toBe(`${REPO_B}/pull/3`);
    expect(taskNoWs?.branchName).toBeUndefined();
    expect(taskNoWs?.currentPr).toBeUndefined();
  });

  it('leaves currentPr unset when the task&apos;s project has no remotes', async () => {
    await fixture.db.insert(projects).values({ id: 'project-c', name: 'Gamma', path: '/gamma' });
    await fixture.db.insert(workspaces).values({
      id: 'ws-c',
      kind: 'worktree',
      location: 'local',
      type: 'local',
      path: '/gamma-wt',
      branchName: 'feature-x',
      createdAt: NOW,
    });
    await fixture.db
      .insert(tasks)
      .values(taskRow({ id: 'task-c', projectId: 'project-c', workspaceId: 'ws-c' }));
    await fixture.db
      .insert(pullRequests)
      .values(prRow({ url: `${REPO_A}/pull/9`, identifier: '#9', headRefName: 'feature-x' }));

    const snapshot = await getWorkHubSnapshot();
    const taskC = snapshot.items.find((i) => i.id === 'task-c');
    expect(taskC?.branchName).toBe('feature-x');
    expect(taskC?.currentPr).toBeUndefined();
  });
});
