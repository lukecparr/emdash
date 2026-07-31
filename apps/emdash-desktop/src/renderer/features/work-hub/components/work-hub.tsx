import { Inbox } from 'lucide-react';
import { useMemo } from 'react';
import { PageHeader } from '@renderer/lib/components/page-header';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { Spinner } from '@renderer/lib/ui/spinner';
import type { WorkHubItem, WorkHubPrItem, WorkHubSection } from '@shared/core/work-hub/work-hub';
import {
  groupWorkHubItems,
  sortAuthoredPrs,
  workHubSections,
} from '@shared/core/work-hub/work-hub';
import { useWorkHub, useWorkHubEventBridge } from '../use-work-hub';
import { WorkHubPrRow } from './work-hub-pr-row';
import { WorkHubRow } from './work-hub-row';

const SECTION_LABELS: Record<WorkHubSection, string> = {
  attention: 'Needs attention',
  active: 'Active',
  review: 'In review',
  planned: 'Planned',
  done: 'Recently done',
};

function WorkHubPrSectionList({ title, items }: { title: string; items: WorkHubPrItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col">
      <div className="flex items-center gap-2 pt-6 pb-1">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <span className="text-xs text-foreground-passive">{items.length}</span>
      </div>
      <div>
        {items.map((item, index) => (
          <WorkHubPrRow key={item.pr.url} item={item} isLast={index === items.length - 1} />
        ))}
      </div>
    </section>
  );
}

function WorkHubSectionList({ section, items }: { section: WorkHubSection; items: WorkHubItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col">
      <div className="flex items-center gap-2 pt-6 pb-1">
        <h3 className="text-sm font-medium text-foreground">{SECTION_LABELS[section]}</h3>
        <span className="text-xs text-foreground-passive">{items.length}</span>
      </div>
      <div>
        {items.map((item, index) => (
          <WorkHubRow key={item.id} item={item} isLast={index === items.length - 1} />
        ))}
      </div>
    </section>
  );
}

export function WorkHub() {
  useWorkHubEventBridge();
  const snapshot = useWorkHub();

  const groups = useMemo(
    () => (snapshot.data ? groupWorkHubItems(snapshot.data.items, { now: Date.now() }) : undefined),
    [snapshot.data]
  );

  const reviewRequests = snapshot.data?.reviewRequests ?? [];
  const authoredPrs = useMemo(
    () => (snapshot.data ? sortAuthoredPrs(snapshot.data.authoredPrs) : []),
    [snapshot.data]
  );

  const isEmpty =
    groups !== undefined &&
    workHubSections.every((s) => groups[s].length === 0) &&
    reviewRequests.length === 0 &&
    authoredPrs.length === 0;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <div className="h-6 shrink-0 [-webkit-app-region:drag]" />
      <div className="mx-auto grid min-h-0 w-full max-w-4xl flex-1 grid-cols-1 gap-8">
        <div className="relative min-h-0 w-full min-w-0 overflow-y-auto px-8">
          <div className="w-full py-8">
            <PageHeader
              title="Work"
              description="Everything that needs your attention, across all projects."
            />
            {groups === undefined ? (
              <div className="flex justify-center py-16">
                <Spinner />
              </div>
            ) : isEmpty ? (
              <EmptyState
                label="Nothing needs your attention"
                description="Tasks, agent activity, and pull requests across your projects will show up here."
                icon={<Inbox className="size-5" />}
                className="bg-transparent py-16"
              />
            ) : (
              <>
                <WorkHubSectionList section="attention" items={groups.attention} />
                <WorkHubPrSectionList title="Review requests" items={reviewRequests} />
                <WorkHubPrSectionList title="My PRs" items={authoredPrs} />
                {workHubSections
                  .filter((section) => section !== 'attention')
                  .map((section) => (
                    <WorkHubSectionList key={section} section={section} items={groups[section]} />
                  ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
