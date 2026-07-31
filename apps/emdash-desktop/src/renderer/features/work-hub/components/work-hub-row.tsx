import { AgentStatusIndicator } from '@renderer/lib/components/agent-status-indicator';
import {
  IssueStatusIndicator,
  type IssueStatus,
} from '@renderer/lib/components/issue-status-indicator';
import { MultiLineListItem } from '@renderer/lib/components/multi-line-list-item';
import { PrBadge } from '@renderer/lib/components/pr-badge';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import type { TaskLifecycleStatus } from '@shared/core/tasks/tasks';
import type { WorkHubItem } from '@shared/core/work-hub/work-hub';
import { useSetTaskStatus } from '../use-work-hub';

const STATUS_OPTIONS: Array<{ status: TaskLifecycleStatus; label: string }> = [
  { status: 'triage', label: 'Triage' },
  { status: 'backlog', label: 'Backlog' },
  { status: 'todo', label: 'To do' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'review', label: 'In review' },
  { status: 'done', label: 'Done' },
  { status: 'cancelled', label: 'Cancelled' },
  { status: 'duplicate', label: 'Duplicate' },
];

export function WorkHubRow({ item, isLast }: { item: WorkHubItem; isLast: boolean }) {
  const { navigate } = useNavigate();
  const setStatus = useSetTaskStatus();

  return (
    <MultiLineListItem isLast={isLast} className="cursor-pointer items-center py-3">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Change task status"
          className="flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-background-2"
          onClick={(event) => event.stopPropagation()}
        >
          <IssueStatusIndicator status={item.status as IssueStatus} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {STATUS_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.status}
              onClick={(event) => {
                event.stopPropagation();
                if (option.status !== item.status) {
                  setStatus.mutate({ taskId: item.id, status: option.status });
                }
              }}
            >
              <IssueStatusIndicator status={option.status as IssueStatus} />
              <span>{option.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={() => navigate('task', { projectId: item.projectId, taskId: item.id })}
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm text-foreground">{item.name}</span>
          <span className="flex items-center gap-1.5 text-xs text-foreground-muted">
            <span className="truncate">{item.projectName}</span>
            {item.branchName && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{item.branchName}</span>
              </>
            )}
          </span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-3">
          {item.currentPr && <PrBadge pr={item.currentPr} variant="compact" />}
          <AgentStatusIndicator status={item.agent.status} />
          <RelativeTime value={item.updatedAt} className="text-xs text-foreground-passive" />
        </span>
      </button>
    </MultiLineListItem>
  );
}
