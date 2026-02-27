import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { WebContents } from 'electron';
import { log } from '../lib/logger';
import { ClaudeCodeAdapter, makeClaudeSessionUuid } from './adapters/ClaudeCodeAdapter';
import type {
  HistoryMessage,
  HistoryMessageBlock,
  NormalizedEvent,
} from '@shared/types/agentEvents';
import { providerStatusCache } from './providerStatusCache';

function cwdToSlug(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

function loadClaudeHistory(cwd: string, sessionUuid: string): HistoryMessage[] {
  const slug = cwdToSlug(cwd);
  const filePath = path.join(os.homedir(), '.claude', 'projects', slug, `${sessionUuid}.jsonl`);

  log.info(
    `[loadClaudeHistory] cwd=${cwd} slug=${slug} uuid=${sessionUuid} path=${filePath} exists=${fs.existsSync(filePath)}`
  );

  if (!fs.existsSync(filePath)) return [];

  let lines: string[];
  try {
    lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
  } catch {
    return [];
  }

  const messages: HistoryMessage[] = [];
  let msgId = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as {
        type: string;
        message?: { role: string; content: unknown };
      };

      if (entry.type !== 'user' && entry.type !== 'assistant') continue;

      const role = entry.message?.role as 'user' | 'assistant' | undefined;
      const content = entry.message?.content;
      if (!role) continue;

      // User messages often have content as a plain string, not an array
      if (typeof content === 'string') {
        if (content) {
          messages.push({
            id: `hist-${++msgId}`,
            role,
            blocks: [{ kind: 'text', text: content }],
          });
        }
        continue;
      }

      if (!Array.isArray(content)) continue;

      const blocks: HistoryMessageBlock[] = [];

      for (const block of content as Array<Record<string, unknown>>) {
        if (block['type'] === 'text' && block['text']) {
          blocks.push({ kind: 'text', text: String(block['text']) });
        } else if (block['type'] === 'thinking' && block['thinking']) {
          blocks.push({ kind: 'thinking', text: String(block['thinking']) });
        } else if (block['type'] === 'tool_use') {
          blocks.push({
            kind: 'tool',
            toolName: String(block['name'] ?? ''),
            toolCallId: String(block['id'] ?? ''),
            args: block['input'] ?? {},
          });
        } else if (block['type'] === 'tool_result') {
          // tool_result blocks appear in user turns — stitch onto matching tool block
          const prevAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
          if (prevAssistant) {
            const toolBlock = prevAssistant.blocks.find(
              (b) => b.kind === 'tool' && b.toolCallId === String(block['tool_use_id'] ?? '')
            );
            if (toolBlock && toolBlock.kind === 'tool') {
              const rawContent = block['content'];
              const text = Array.isArray(rawContent)
                ? (rawContent as Array<Record<string, unknown>>)
                    .map((c) => String(c['text'] ?? ''))
                    .join('\n')
                : String(rawContent ?? '');
              toolBlock.result = {
                type: 'other',
                content: text,
                isError: Boolean(block['is_error'] ?? false),
              };
            }
          }
          continue;
        }
      }

      if (blocks.length > 0) {
        // Merge consecutive same-role messages into one (Claude JSONL emits
        // separate lines for thinking, tool_use, and text within the same turn)
        const prev = messages[messages.length - 1];
        if (prev && prev.role === role) {
          prev.blocks.push(...blocks);
        } else {
          messages.push({ id: `hist-${++msgId}`, role, blocks });
        }
      }
    } catch {
      // skip malformed lines
    }
  }

  log.info(`[loadClaudeHistory] Parsed ${messages.length} messages from ${lines.length} lines`);
  return messages;
}

export interface CreateSessionOptions {
  cwd: string;
  providerId: string;
  autoApprove: boolean;
  conversationId: string;
  taskId: string;
  env?: Record<string, string>;
  resume?: boolean;
}

class AgentSessionService {
  private sessions = new Map<string, ClaudeCodeAdapter>();
  // Maps internal sessionId → claudeSessionId so destroySession can look it up
  private claudeSessionIds = new Map<string, string>();
  // Tracks exit promises keyed by claudeSessionId to prevent "session already in use" errors
  private exitPromises = new Map<string, Promise<void>>();
  private webContents: WebContents | null = null;

  attachWindow(webContents: WebContents): void {
    this.webContents = webContents;
  }

  async createSession(sessionId: string, opts: CreateSessionOptions): Promise<HistoryMessage[]> {
    const { cwd, conversationId, taskId } = opts;
    const claudeSessionId = makeClaudeSessionUuid(taskId, conversationId);
    const history = loadClaudeHistory(cwd, claudeSessionId);

    if (this.sessions.has(sessionId)) {
      log.info(`[AgentSessionService] Session already exists: ${sessionId}, returning history`);
      return history;
    }

    const { providerId, autoApprove, env, resume } = opts;

    if (providerId !== 'claude') {
      throw new Error(`Provider '${providerId}' does not support streaming-json integration mode`);
    }

    // Resolve claude CLI path
    const cachedPath = providerStatusCache.get('claude')?.path;
    const claudePath = cachedPath ?? 'claude';

    // Wait for any previous process using this claudeSessionId to fully exit.
    // Without this, the claude CLI errors with "Session ID already in use" when
    // a session is destroyed and immediately recreated (e.g. on hot reload).
    const prevExit = this.exitPromises.get(claudeSessionId);
    if (prevExit) {
      log.info(
        `[AgentSessionService] Waiting for previous process (claudeSessionId=${claudeSessionId}) to exit`
      );
      // Race against a 5s timeout so we never block indefinitely
      await Promise.race([prevExit, new Promise<void>((r) => setTimeout(r, 5000))]);
    }

    const adapter = new ClaudeCodeAdapter({
      cwd,
      sessionId: claudeSessionId,
      autoApprove,
      resume: resume ?? false,
      claudePath,
      env,
    });

    adapter.on('event', (event: NormalizedEvent) => {
      this.pushEvent(sessionId, event);
    });

    this.claudeSessionIds.set(sessionId, claudeSessionId);
    this.sessions.set(sessionId, adapter);
    adapter.start();

    log.info(
      `[AgentSessionService] Created session: ${sessionId} (claudeSessionId=${claudeSessionId}, history=${history.length} msgs)`
    );

    return history;
  }

  sendMessage(sessionId: string, text: string): void {
    const adapter = this.sessions.get(sessionId);
    if (!adapter) {
      log.warn(`[AgentSessionService] sendMessage: no session for id=${sessionId}`);
      return;
    }
    adapter.sendMessage(text);
  }

  abortSession(sessionId: string): void {
    const adapter = this.sessions.get(sessionId);
    if (!adapter) return;
    this.trackExit(sessionId, adapter);
    adapter.abort();
    log.info(`[AgentSessionService] Aborted session: ${sessionId}`);
  }

  destroySession(sessionId: string): void {
    const adapter = this.sessions.get(sessionId);
    if (!adapter) return;
    this.trackExit(sessionId, adapter);
    adapter.abort();
    this.sessions.delete(sessionId);
    this.claudeSessionIds.delete(sessionId);
    log.info(`[AgentSessionService] Destroyed session: ${sessionId}`);
  }

  /**
   * Capture a waitForExit() promise (before abort() nulls out the proc reference)
   * and store it in exitPromises keyed by claudeSessionId.
   */
  private trackExit(sessionId: string, adapter: ClaudeCodeAdapter): void {
    const claudeSessionId = this.claudeSessionIds.get(sessionId);
    if (!claudeSessionId) return;
    const exitPromise = adapter.waitForExit();
    this.exitPromises.set(claudeSessionId, exitPromise);
    void exitPromise.then(() => {
      if (this.exitPromises.get(claudeSessionId) === exitPromise) {
        this.exitPromises.delete(claudeSessionId);
      }
    });
  }

  private pushEvent(sessionId: string, event: NormalizedEvent): void {
    if (!this.webContents || this.webContents.isDestroyed()) return;
    try {
      this.webContents.send(`agentSession:event:${sessionId}`, event);
    } catch (err) {
      log.warn(`[AgentSessionService] Failed to push event for session ${sessionId}:`, err);
    }
  }
}

export const agentSessionService = new AgentSessionService();
