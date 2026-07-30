import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import type { LinkedIssue } from '@shared/core/linked-issue';

const CONFIGURED_QUERY_KEY = ['work-hub', 'issues-configured'];
const ASSIGNED_ISSUES_QUERY_KEY = ['work-hub', 'assigned-issues'];

/**
 * Assigned Linear issues for the hub. Kept out of the hub snapshot on
 * purpose: the snapshot is pure-DB and refreshed aggressively by the event
 * bridge, while this hits the Linear API on its own gentle schedule. The
 * section stays hidden when Linear is not connected or the fetch fails.
 */
export function useAssignedIssues(): { issues: LinkedIssue[]; isLoading: boolean } {
  const configured = useQuery({
    queryKey: CONFIGURED_QUERY_KEY,
    queryFn: () => rpc.issues.checkConfiguredConnections(),
    staleTime: Infinity,
  });
  const linearConfigured = configured.data?.linear === true;

  const issues = useQuery({
    queryKey: ASSIGNED_ISSUES_QUERY_KEY,
    queryFn: () => rpc.issues.listIssues('linear', { limit: 50, assignedToMe: true }),
    enabled: linearConfigured,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

  return {
    issues: issues.data?.success ? issues.data.data : [],
    isLoading: configured.isPending || (linearConfigured && issues.isPending),
  };
}
