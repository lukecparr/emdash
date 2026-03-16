import { useCallback, useSyncExternalStore } from 'react';
import { unreadTaskStore } from '../lib/unreadTaskStore';

/**
 * Returns `true` when the given task has an unread agent completion.
 * Automatically re-renders when the unread state changes.
 */
export function useTaskUnread(taskId: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => unreadTaskStore.subscribe(onStoreChange),
    []
  );
  const getSnapshot = useCallback(() => unreadTaskStore.isUnread(taskId), [taskId]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
