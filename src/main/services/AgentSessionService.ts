import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app, type WebContents } from 'electron';
import { log } from '../lib/logger';
import { ClaudeCodeAdapter, makeClaudeSessionUuid } from './adapters/ClaudeCodeAdapter';
import { PiAdapter } from './adapters/PiAdapter';
import type {
  HistoryMessage,
  HistoryMessageBlock,
  NormalizedEvent,
  ToolResult,
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

function makePiSessionPath(taskId: string, conversationId: string): string {
  const dir = path.join(app.getPath('userData'), 'pi-sessions');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, `${taskId}-${conversationId}.jsonl`);
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
  private sessions = new Map<string, ClaudeCodeAdapter | PiAdapter>();
  // Maps internal sessionId → provider-specific key so destroySession can look it up
  private providerSessionKeys = new Map<string, string>();
  // Tracks exit promises keyed by providerSessionKey to prevent "session already in use" errors
  private exitPromises = new Map<string, Promise<void>>();
  // Pi history persistence: keyed by piSessionKey (`pi:${taskId}:${conversationId}`)
  private piHistoryCache = new Map<string, HistoryMessage[]>();
  // In-progress assistant message being assembled during a Pi turn
  private piCurrentMsg = new Map<
    string,
    {
      id: string;
      blocks: Array<
        | { kind: 'text'; text: string }
        | { kind: 'thinking'; text: string }
        | { kind: 'tool'; toolName: string; toolCallId: string; args: unknown; result?: ToolResult }
      >;
    }
  >();
  // Meta for Pi sessions needed by sendMessage (which doesn't have taskId/conversationId)
  private piSessionMeta = new Map<string, { taskId: string; conversationId: string }>();
  private webContents: WebContents | null = null;

  attachWindow(webContents: WebContents): void {
    this.webContents = webContents;
  }

  async createSession(sessionId: string, opts: CreateSessionOptions): Promise<HistoryMessage[]> {
    const { cwd, conversationId, taskId, providerId, autoApprove, env, resume } = opts;

    if (this.sessions.has(sessionId)) {
      log.info(`[AgentSessionService] Session already exists: ${sessionId}, returning history`);
      if (providerId === 'claude') {
        const claudeSessionId = makeClaudeSessionUuid(taskId, conversationId);
        return loadClaudeHistory(cwd, claudeSessionId);
      }
      if (providerId === 'pi') {
        const piSessionKey = `pi:${taskId}:${conversationId}`;
        return this.loadPiHistory(piSessionKey, taskId, conversationId);
      }
      return [];
    }

    if (providerId === 'claude') {
      const claudeSessionId = makeClaudeSessionUuid(taskId, conversationId);
      const history = loadClaudeHistory(cwd, claudeSessionId);

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

      this.providerSessionKeys.set(sessionId, claudeSessionId);
      this.sessions.set(sessionId, adapter);
      adapter.start();

      log.info(
        `[AgentSessionService] Created Claude session: ${sessionId} (claudeSessionId=${claudeSessionId}, history=${history.length} msgs)`
      );

      return history;
    }

    if (providerId === 'pi') {
      const cachedPath = providerStatusCache.get('pi')?.path;
      const piPath = cachedPath ?? 'pi';

      // Always use a deterministic session path so Pi context is preserved across restarts
      const sessionPath = makePiSessionPath(taskId, conversationId);
      const piSessionKey = `pi:${taskId}:${conversationId}`;

      // Load persisted history (in-memory cache or file)
      const history = this.loadPiHistory(piSessionKey, taskId, conversationId);

      const adapter = new PiAdapter({ cwd, sessionPath, piPath, env });

      adapter.on('event', (event: NormalizedEvent) => {
        this.trackPiEvent(event, piSessionKey, taskId, conversationId);
        this.pushEvent(sessionId, event);
      });

      this.providerSessionKeys.set(sessionId, piSessionKey);
      this.piSessionMeta.set(piSessionKey, { taskId, conversationId });
      this.sessions.set(sessionId, adapter);
      adapter.start();

      log.info(
        `[AgentSessionService] Created Pi session: ${sessionId} (history=${history.length} msgs)`
      );

      return history;
    }

    throw new Error(`Provider '${providerId}' does not support streaming-json integration mode`);
  }

  sendMessage(sessionId: string, text: string): void {
    const adapter = this.sessions.get(sessionId);
    if (!adapter) {
      log.warn(`[AgentSessionService] sendMessage: no session for id=${sessionId}`);
      return;
    }

    // Track user message for Pi history
    const providerKey = this.providerSessionKeys.get(sessionId);
    if (providerKey?.startsWith('pi:')) {
      const meta = this.piSessionMeta.get(providerKey);
      if (meta) {
        const { taskId, conversationId } = meta;
        const history = this.piHistoryCache.get(providerKey) ?? [];
        history.push({
          id: `pi-user-${Date.now().toString(36)}`,
          role: 'user',
          blocks: [{ kind: 'text', text }],
        });
        this.piHistoryCache.set(providerKey, history);
        this.savePiHistory(providerKey, taskId, conversationId);
      }
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
    const providerKey = this.providerSessionKeys.get(sessionId);
    this.providerSessionKeys.delete(sessionId);
    if (providerKey?.startsWith('pi:')) {
      this.piCurrentMsg.delete(providerKey);
      // Keep piHistoryCache and piSessionMeta in memory — needed if session is recreated
    }
    log.info(`[AgentSessionService] Destroyed session: ${sessionId}`);
  }

  /**
   * Capture a waitForExit() promise (before abort() nulls out the proc reference)
   * and store it in exitPromises keyed by providerSessionKey.
   */
  private trackExit(sessionId: string, adapter: ClaudeCodeAdapter | PiAdapter): void {
    const providerSessionKey = this.providerSessionKeys.get(sessionId);
    if (!providerSessionKey) return;
    const exitPromise = adapter.waitForExit();
    this.exitPromises.set(providerSessionKey, exitPromise);
    void exitPromise.then(() => {
      if (this.exitPromises.get(providerSessionKey) === exitPromise) {
        this.exitPromises.delete(providerSessionKey);
      }
    });
  }

  private makePiHistoryPath(taskId: string, conversationId: string): string {
    const dir = path.join(app.getPath('userData'), 'pi-sessions');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${taskId}-${conversationId}-history.json`);
  }

  private loadPiHistory(
    piSessionKey: string,
    taskId: string,
    conversationId: string
  ): HistoryMessage[] {
    const cached = this.piHistoryCache.get(piSessionKey);
    if (cached) return cached;

    const filePath = this.makePiHistoryPath(taskId, conversationId);
    if (!fs.existsSync(filePath)) {
      this.piHistoryCache.set(piSessionKey, []);
      return [];
    }
    try {
      const history = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as HistoryMessage[];
      this.piHistoryCache.set(piSessionKey, history);
      return history;
    } catch {
      this.piHistoryCache.set(piSessionKey, []);
      return [];
    }
  }

  private savePiHistory(piSessionKey: string, taskId: string, conversationId: string): void {
    const history = this.piHistoryCache.get(piSessionKey);
    if (!history) return;
    try {
      fs.writeFileSync(
        this.makePiHistoryPath(taskId, conversationId),
        JSON.stringify(history),
        'utf-8'
      );
    } catch (err) {
      log.warn(`[AgentSessionService] Failed to save Pi history for ${piSessionKey}:`, err);
    }
  }

  private trackPiEvent(
    event: NormalizedEvent,
    piSessionKey: string,
    taskId: string,
    conversationId: string
  ): void {
    const history = this.piHistoryCache.get(piSessionKey) ?? [];

    switch (event.type) {
      case 'message_start': {
        this.piCurrentMsg.set(piSessionKey, {
          id: `pi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          blocks: [],
        });
        break;
      }
      case 'text_delta': {
        const cur = this.piCurrentMsg.get(piSessionKey);
        if (!cur) break;
        const last = cur.blocks[cur.blocks.length - 1];
        if (last?.kind === 'text') {
          last.text += event.text;
        } else {
          cur.blocks.push({ kind: 'text', text: event.text });
        }
        break;
      }
      case 'thinking_start': {
        const cur = this.piCurrentMsg.get(piSessionKey);
        if (cur) cur.blocks.push({ kind: 'thinking', text: '' });
        break;
      }
      case 'thinking_delta': {
        const cur = this.piCurrentMsg.get(piSessionKey);
        if (!cur) break;
        const last = cur.blocks[cur.blocks.length - 1];
        if (last?.kind === 'thinking') last.text += event.text;
        break;
      }
      case 'tool_call_start': {
        const cur = this.piCurrentMsg.get(piSessionKey);
        if (cur) {
          cur.blocks.push({
            kind: 'tool',
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            args: event.args,
          });
        }
        break;
      }
      case 'tool_result': {
        const cur = this.piCurrentMsg.get(piSessionKey);
        if (!cur) break;
        const toolBlock = cur.blocks.find(
          (b) => b.kind === 'tool' && b.toolCallId === event.toolCallId
        );
        if (toolBlock?.kind === 'tool') {
          toolBlock.result = event.result;
        }
        break;
      }
      case 'message_end':
      case 'agent_end': {
        const cur = this.piCurrentMsg.get(piSessionKey);
        if (cur && cur.blocks.length > 0) {
          history.push({
            id: cur.id,
            role: 'assistant',
            blocks: cur.blocks as HistoryMessageBlock[],
          });
          this.piHistoryCache.set(piSessionKey, history);
          this.piCurrentMsg.delete(piSessionKey);
          this.savePiHistory(piSessionKey, taskId, conversationId);
        }
        break;
      }
    }
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
