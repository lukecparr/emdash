import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import { log } from '../../lib/logger';
import type { NormalizedEvent, TokenUsage } from '@shared/types/agentEvents';

export interface ClaudeCodeAdapterOptions {
  cwd: string;
  sessionId: string;
  autoApprove: boolean;
  resume: boolean;
  claudePath: string;
  env?: Record<string, string>;
}

/**
 * Generate a deterministic UUID from an arbitrary string input.
 */
function deterministicUuid(input: string): string {
  const hash = crypto.createHash('sha256').update(input).digest();
  hash[6] = (hash[6] & 0x0f) | 0x40;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function makeClaudeSessionUuid(taskId: string, conversationId: string): string {
  return deterministicUuid(`${taskId}::${conversationId}`);
}

/**
 * Spawns claude with --output-format stream-json --input-format stream-json,
 * parses JSONL from stdout, and emits NormalizedEvents.
 */
export class ClaudeCodeAdapter extends EventEmitter {
  private proc: ChildProcess | null = null;
  private readonly opts: ClaudeCodeAdapterOptions;
  // Track whether the current spawn saw a session-ID conflict in stderr
  private sessionIdConflict = false;
  // Allow one retry with a fresh random session ID to survive daemon-held locks
  private retries = 0;
  private static readonly MAX_RETRIES = 1;

  constructor(opts: ClaudeCodeAdapterOptions) {
    super();
    this.opts = opts;
  }

  start(): void {
    const { cwd, autoApprove, resume, claudePath, env } = this.opts;
    // Use a fresh random UUID on retry so we don't collide with the daemon-held lock
    const sessionId = this.retries > 0 ? crypto.randomUUID() : this.opts.sessionId;

    const args = [
      '--output-format',
      'stream-json',
      '--verbose',
      '--input-format',
      'stream-json',
      '--session-id',
      sessionId,
    ];

    if (autoApprove) {
      args.push('--dangerously-skip-permissions');
    }

    if (resume) {
      args.push('-c', '-r');
    }

    log.info(`[ClaudeCodeAdapter] Spawning: ${claudePath} ${args.join(' ')} (cwd=${cwd})`);

    this.proc = spawn(claudePath, args, {
      cwd,
      env: { ...process.env, ...(env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const rl = createInterface({ input: this.proc.stdout! });

    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const obj = JSON.parse(line);
        this.handleClaudeEvent(obj);
      } catch (err) {
        log.warn(`[ClaudeCodeAdapter] Failed to parse JSONL line: ${line}`, err);
      }
    });

    this.proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      log.warn(`[ClaudeCodeAdapter] stderr: ${text}`);
      if (text.includes('is already in use')) {
        this.sessionIdConflict = true;
      }
    });

    this.proc.on('exit', (code, signal) => {
      log.info(`[ClaudeCodeAdapter] Process exited: code=${code} signal=${signal}`);
      if (this.sessionIdConflict && code === 1 && this.retries < ClaudeCodeAdapter.MAX_RETRIES) {
        this.sessionIdConflict = false;
        this.retries += 1;
        log.warn(
          `[ClaudeCodeAdapter] Session ID conflict detected, retrying with a fresh session ID (attempt ${this.retries})`
        );
        this.start();
      }
    });

    this.proc.on('error', (err) => {
      log.error('[ClaudeCodeAdapter] Spawn error:', err);
      this.emit('event', { type: 'error', message: err.message } satisfies NormalizedEvent);
    });
  }

  sendMessage(text: string, _images?: Array<{ data: string; mimeType: string }>): void {
    if (!this.proc?.stdin) {
      log.warn('[ClaudeCodeAdapter] Cannot sendMessage: no stdin');
      return;
    }
    const payload = JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
    this.proc.stdin.write(payload + '\n');
  }

  /**
   * Returns a promise that resolves when the underlying process exits.
   * Must be called BEFORE abort() since abort() nulls out this.proc.
   */
  waitForExit(): Promise<void> {
    const proc = this.proc;
    if (!proc) return Promise.resolve();
    return new Promise<void>((resolve) => {
      if (proc.exitCode !== null || proc.killed) {
        resolve();
        return;
      }
      proc.once('exit', () => resolve());
    });
  }

  abort(): void {
    if (this.proc) {
      try {
        this.proc.kill('SIGTERM');
      } catch {}
      this.proc = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Map Claude JSONL events → NormalizedEvent
  // ---------------------------------------------------------------------------

  private handleClaudeEvent(obj: Record<string, unknown>): void {
    const msgType = obj.type as string | undefined;

    if (msgType === 'system') {
      const subtype = obj.subtype as string | undefined;
      if (subtype === 'init') {
        const event: NormalizedEvent = {
          type: 'session_init',
          model: (obj.model as string) ?? '',
          tools: (obj.tools as string[]) ?? [],
          sessionId: (obj.session_id as string) ?? this.opts.sessionId,
        };
        this.emit('event', event);
      }
      return;
    }

    if (msgType === 'assistant') {
      this.emit('event', { type: 'message_start', role: 'assistant' } satisfies NormalizedEvent);

      const message = obj.message as Record<string, unknown> | undefined;
      const content = message?.content as unknown[] | undefined;
      if (!Array.isArray(content)) return;

      for (const block of content) {
        const b = block as Record<string, unknown>;
        const blockType = b.type as string;

        if (blockType === 'text') {
          const text = (b.text as string) ?? '';
          if (text) {
            this.emit('event', { type: 'text_delta', text } satisfies NormalizedEvent);
          }
        } else if (blockType === 'thinking') {
          const thinking = (b.thinking as string) ?? '';
          this.emit('event', { type: 'thinking_start' } satisfies NormalizedEvent);
          if (thinking) {
            this.emit('event', {
              type: 'thinking_delta',
              text: thinking,
            } satisfies NormalizedEvent);
          }
          this.emit('event', { type: 'thinking_end' } satisfies NormalizedEvent);
        } else if (blockType === 'tool_use') {
          const event: NormalizedEvent = {
            type: 'tool_call_start',
            toolName: (b.name as string) ?? 'unknown',
            toolCallId: (b.id as string) ?? '',
            args: b.input ?? {},
          };
          this.emit('event', event);
        }
      }

      const stopReason = (message?.stop_reason as string) ?? 'end_turn';
      this.emit('event', { type: 'message_end', stopReason } satisfies NormalizedEvent);
      return;
    }

    if (msgType === 'tool_result') {
      const toolUseId = (obj.tool_use_id as string) ?? '';
      const content = obj.content;
      let text = '';
      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .map((c: unknown) => {
            const cb = c as Record<string, unknown>;
            return typeof cb.text === 'string' ? cb.text : JSON.stringify(cb);
          })
          .join('\n');
      }

      const event: NormalizedEvent = {
        type: 'tool_result',
        toolCallId: toolUseId,
        result: {
          type: 'other',
          content: text,
          isError: (obj.is_error as boolean) ?? false,
        },
      };
      this.emit('event', event);
      return;
    }

    if (msgType === 'result') {
      const usage = obj.usage as Record<string, number> | undefined;
      const tokenUsage: TokenUsage = {
        input: usage?.input_tokens ?? 0,
        output: usage?.output_tokens ?? 0,
        cacheRead: usage?.cache_read_input_tokens,
        cacheWrite: usage?.cache_creation_input_tokens,
      };
      const totalCost = (obj.total_cost as number) ?? 0;

      this.emit('event', { type: 'turn_end', usage: tokenUsage } satisfies NormalizedEvent);
      this.emit('event', {
        type: 'agent_end',
        totalCost,
        totalTokens: tokenUsage,
      } satisfies NormalizedEvent);
      return;
    }

    if (msgType === 'error') {
      this.emit('event', {
        type: 'error',
        message: (obj.message as string) ?? 'Unknown error',
      } satisfies NormalizedEvent);
    }
  }
}
