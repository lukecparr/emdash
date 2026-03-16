/**
 * In-memory store for draft (unsent) chat input text, keyed by session ID.
 *
 * When the user types into a UnifiedChatPanel textarea and then switches away
 * (to another task or conversation tab), the component unmounts and local
 * React state is lost.  This module keeps the draft text alive across
 * mount/unmount cycles so it can be restored when the user returns.
 */

const drafts = new Map<string, string>();

export function getDraft(sessionId: string): string {
  return drafts.get(sessionId) ?? '';
}

export function setDraft(sessionId: string, text: string): void {
  if (text) {
    drafts.set(sessionId, text);
  } else {
    drafts.delete(sessionId);
  }
}

export function clearDraft(sessionId: string): void {
  drafts.delete(sessionId);
}
