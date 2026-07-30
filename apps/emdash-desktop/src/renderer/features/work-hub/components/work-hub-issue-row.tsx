import { Play } from 'lucide-react';
import {
  IssueStatusIndicator,
  toIssueStatus,
} from '@renderer/lib/components/issue-status-indicator';
import { MultiLineListItem } from '@renderer/lib/components/multi-line-list-item';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import type { LinkedIssue } from '@shared/core/linked-issue';
import { linkedIssueDisplayIdentifier } from '@shared/core/linked-issue';
import type { WorkHubProjectRef } from '@shared/core/work-hub/work-hub';

export function WorkHubIssueRow({
  issue,
  projects,
  isLast,
}: {
  issue: LinkedIssue;
  projects: WorkHubProjectRef[];
  isLast: boolean;
}) {
  const showCreateTaskModal = useShowModal('taskModal');
  const identifier = linkedIssueDisplayIdentifier(issue);

  const startTask = (projectId: string) => {
    showCreateTaskModal({ projectId, strategy: 'from-issue', initialIssue: issue });
  };

  const startTaskButton = (
    <Button variant="outline" size="sm">
      <Play className="size-3.5" />
      Start Task
    </Button>
  );

  return (
    <MultiLineListItem isLast={isLast} className="cursor-pointer items-center py-3">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={() => void rpc.app.openExternal(issue.url)}
      >
        <span className="flex size-6 shrink-0 items-center justify-center">
          <IssueStatusIndicator status={toIssueStatus(issue.status)} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm text-foreground">{issue.title}</span>
          <span className="flex items-center gap-1.5 text-xs text-foreground-muted">
            {identifier && <span>{identifier}</span>}
            {issue.project && (
              <>
                {identifier && <span aria-hidden>·</span>}
                <span className="truncate">{issue.project}</span>
              </>
            )}
          </span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-3">
          {issue.updatedAt && (
            <RelativeTime value={issue.updatedAt} className="text-xs text-foreground-passive" />
          )}
        </span>
      </button>
      {projects.length > 0 && (
        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
          {projects.length === 1 ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      startTask(projects[0].id);
                    }}
                  >
                    <Play className="size-3.5" />
                    Start Task
                  </Button>
                }
              />
              <TooltipContent>Create a task from this issue</TooltipContent>
            </Tooltip>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={startTaskButton}
                onClick={(event) => event.stopPropagation()}
              />
              <DropdownMenuContent align="end">
                {[...projects]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((project) => (
                    <DropdownMenuItem
                      key={project.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        startTask(project.id);
                      }}
                    >
                      {project.name}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </MultiLineListItem>
  );
}
