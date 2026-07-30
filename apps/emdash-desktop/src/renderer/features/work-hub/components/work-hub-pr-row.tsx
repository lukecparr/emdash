import { CircleAlert } from 'lucide-react';
import { MultiLineListItem } from '@renderer/lib/components/multi-line-list-item';
import { StatusIcon } from '@renderer/lib/components/pr-status-icon';
import { rpc } from '@renderer/lib/ipc';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import type { PullRequest } from '@shared/core/pull-requests/pull-requests';
import { authoredPrNeedsAttention } from '@shared/core/work-hub/work-hub';
import { parseRepositoryRef } from '@shared/repository-ref';

export function WorkHubPrRow({ pr, isLast }: { pr: PullRequest; isLast: boolean }) {
  const slug = parseRepositoryRef(pr.repositoryUrl)?.nameWithOwner ?? pr.repositoryUrl;
  const needsAttention = authoredPrNeedsAttention(pr);

  return (
    <MultiLineListItem isLast={isLast} className="cursor-pointer items-center py-3">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={() => void rpc.app.openExternal(pr.url)}
      >
        <span className="flex size-6 shrink-0 items-center justify-center">
          <StatusIcon pr={pr} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm text-foreground">{pr.title}</span>
          <span className="flex items-center gap-1.5 text-xs text-foreground-muted">
            <span className="truncate">{slug}</span>
            {pr.identifier && (
              <>
                <span aria-hidden>·</span>
                <span>{pr.identifier}</span>
              </>
            )}
          </span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-3">
          {needsAttention && (
            <Tooltip>
              <TooltipTrigger render={<CircleAlert className="size-4 text-foreground-error" />} />
              <TooltipContent>Failing checks, conflicts, or changes requested</TooltipContent>
            </Tooltip>
          )}
          <RelativeTime value={pr.updatedAt} className="text-xs text-foreground-passive" />
        </span>
      </button>
    </MultiLineListItem>
  );
}
