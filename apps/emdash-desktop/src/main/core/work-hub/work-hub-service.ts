import { desc, inArray, isNull } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations, projectRemotes, projects, tasks, workspaces } from '@main/db/schema';
import type { AgentStatus } from '@shared/core/agents/agentEvents';
import type { PullRequest } from '@shared/core/pull-requests/pull-requests';
import { selectCurrentPr } from '@shared/core/pull-requests/pull-requests';
import type { TaskLifecycleStatus } from '@shared/core/tasks/tasks';
import type { WorkHubItem, WorkHubSnapshot } from '@shared/core/work-hub/work-hub';
import { aggregateAgentStatus } from '@shared/core/work-hub/work-hub';
import { prQueryService } from '../pull-requests/pr-query-service';

/** Stay well below SQLite's 999 bound-variable limit. */
const IN_CHUNK_SIZE = 900;

function chunk<T>(values: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += IN_CHUNK_SIZE) {
    chunks.push(values.slice(i, i + IN_CHUNK_SIZE));
  }
  return chunks;
}

export async function getWorkHubSnapshot(): Promise<WorkHubSnapshot> {
  const projectRows = await db.select({ id: projects.id, name: projects.name }).from(projects);
  const projectNames = new Map(projectRows.map((p) => [p.id, p.name]));

  const taskRows = await db
    .select()
    .from(tasks)
    .where(isNull(tasks.archivedAt))
    .orderBy(desc(tasks.updatedAt));

  if (taskRows.length === 0) {
    return { projects: projectRows, items: [] };
  }

  const taskIds = taskRows.map((t) => t.id);
  const workspaceIds = [
    ...new Set(taskRows.map((t) => t.workspaceId).filter((id): id is string => id !== null)),
  ];

  const conversationRows = (
    await Promise.all(
      chunk(taskIds).map((ids) =>
        db
          .select({
            taskId: conversations.taskId,
            agentStatus: conversations.agentStatus,
            agentStatusSeen: conversations.agentStatusSeen,
          })
          .from(conversations)
          .where(inArray(conversations.taskId, ids))
      )
    )
  ).flat();

  const conversationsByTask = new Map<string, { status: AgentStatus | null; seen: boolean }[]>();
  for (const row of conversationRows) {
    const arr = conversationsByTask.get(row.taskId) ?? [];
    arr.push({
      status: (row.agentStatus as AgentStatus | null) ?? null,
      seen: row.agentStatusSeen !== 0,
    });
    conversationsByTask.set(row.taskId, arr);
  }

  const workspaceRows = (
    await Promise.all(
      chunk(workspaceIds).map((ids) =>
        db
          .select({ id: workspaces.id, branchName: workspaces.branchName })
          .from(workspaces)
          .where(inArray(workspaces.id, ids))
      )
    )
  ).flat();
  const branchByWorkspace = new Map(workspaceRows.map((w) => [w.id, w.branchName]));

  const remoteRows = await db
    .select({ projectId: projectRemotes.projectId, remoteUrl: projectRemotes.remoteUrl })
    .from(projectRemotes);
  const remotesByProject = new Map<string, Set<string>>();
  for (const row of remoteRows) {
    const set = remotesByProject.get(row.projectId) ?? new Set<string>();
    set.add(row.remoteUrl);
    remotesByProject.set(row.projectId, set);
  }

  const branchNames = new Set<string>();
  for (const task of taskRows) {
    const branch = task.workspaceId ? branchByWorkspace.get(task.workspaceId) : undefined;
    if (branch) branchNames.add(branch);
  }
  const prs = await prQueryService.getPullRequestsByBranches(
    [...branchNames],
    [...new Set(remoteRows.map((r) => r.remoteUrl))]
  );
  const prsByBranch = new Map<string, PullRequest[]>();
  for (const pr of prs) {
    const arr = prsByBranch.get(pr.headRefName) ?? [];
    arr.push(pr);
    prsByBranch.set(pr.headRefName, arr);
  }

  const items: WorkHubItem[] = taskRows.map((task) => {
    const branchName = task.workspaceId
      ? (branchByWorkspace.get(task.workspaceId) ?? undefined)
      : undefined;

    let currentPr: PullRequest | undefined;
    if (branchName) {
      const projectRemoteSet = remotesByProject.get(task.projectId);
      const matched = (prsByBranch.get(branchName) ?? []).filter(
        (pr) =>
          projectRemoteSet !== undefined &&
          (projectRemoteSet.has(pr.repositoryUrl) || projectRemoteSet.has(pr.headRepositoryUrl))
      );
      currentPr = selectCurrentPr(matched);
    }

    return {
      id: task.id,
      projectId: task.projectId,
      projectName: projectNames.get(task.projectId) ?? task.projectId,
      name: task.name,
      status: task.status as TaskLifecycleStatus,
      statusChangedAt: task.statusChangedAt,
      updatedAt: task.updatedAt,
      isPinned: task.isPinned === 1,
      type: (task.type as 'task' | 'automation-run') ?? 'task',
      linkedIssue: task.linkedIssue ?? undefined,
      branchName: branchName ?? undefined,
      currentPr,
      agent: aggregateAgentStatus(conversationsByTask.get(task.id) ?? []),
    };
  });

  return { projects: projectRows, items };
}
