import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { events, rpc } from '@renderer/lib/ipc';
import { conversationAgentStatusChangedChannel } from '@shared/core/conversations/conversationEvents';
import {
  prSyncProgressChannel,
  prUpdatedChannel,
  viewerPrsUpdatedChannel,
} from '@shared/core/pull-requests/prEvents';
import {
  taskCreatedChannel,
  taskDeletedChannel,
  taskProvisionedChannel,
  taskStatusUpdatedChannel,
} from '@shared/core/tasks/taskEvents';
import type { TaskLifecycleStatus } from '@shared/core/tasks/tasks';

const WORK_HUB_QUERY_KEY = ['work-hub'];
const INVALIDATE_DEBOUNCE_MS = 300;

export function useWorkHub() {
  return useQuery({
    queryKey: WORK_HUB_QUERY_KEY,
    queryFn: () => rpc.workHub.getSnapshot(),
    placeholderData: keepPreviousData,
  });
}

/**
 * Refresh the hub snapshot when tasks, agent statuses, or PRs change.
 * Events can burst (e.g. a PR sync updating many PRs), so all sources
 * funnel into one trailing debounce.
 */
export function useWorkHubEventBridge() {
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const scheduleInvalidate = () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void queryClient.invalidateQueries({ queryKey: WORK_HUB_QUERY_KEY });
      }, INVALIDATE_DEBOUNCE_MS);
    };

    const unsubscribers = [
      events.on(conversationAgentStatusChangedChannel, scheduleInvalidate),
      events.on(taskCreatedChannel, scheduleInvalidate),
      events.on(taskDeletedChannel, scheduleInvalidate),
      events.on(taskStatusUpdatedChannel, scheduleInvalidate),
      events.on(taskProvisionedChannel, scheduleInvalidate),
      events.on(prUpdatedChannel, scheduleInvalidate),
      events.on(viewerPrsUpdatedChannel, scheduleInvalidate),
      events.on(prSyncProgressChannel, (progress) => {
        if (progress.status === 'done') scheduleInvalidate();
      }),
    ];

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [queryClient]);
}

export function useSetTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskLifecycleStatus }) =>
      rpc.tasks.updateTaskStatus(taskId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WORK_HUB_QUERY_KEY });
    },
  });
}
