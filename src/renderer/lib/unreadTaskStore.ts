/**
 * Tracks which tasks have unread agent completions (busy → idle while not
 * the active/visible task). Cleared when the user opens the task.
 */

type Listener = () => void;

class UnreadTaskStore {
  private unread = new Set<string>();
  private listeners = new Set<Listener>();

  /** Mark a task as having an unread completion. */
  markUnread(taskId: string): void {
    if (this.unread.has(taskId)) return;
    this.unread.add(taskId);
    this.emit();
  }

  /** Clear the unread state for a task (e.g. when the user opens it). */
  markRead(taskId: string): void {
    if (!this.unread.has(taskId)) return;
    this.unread.delete(taskId);
    this.emit();
  }

  /** Check whether a task has an unread completion. */
  isUnread(taskId: string): boolean {
    return this.unread.has(taskId);
  }

  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {}
    }
  }
}

export const unreadTaskStore = new UnreadTaskStore();
