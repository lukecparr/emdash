import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../../lib/logger';
import type { NormalizedEvent, TokenUsage } from '@shared/types/agentEvents';

export interface PiAdapterOptions {
  cwd: string;
  /** null = --no-session, string = --session <path> --continue */
  sessionPath: string | null;
  piPath: string;
  env?: Record<string, string>;
}

/**
 * Spawns `pi --mode rpc` with bidirectional JSON over stdin/stdout,
 * parses JSONL from stdout, and emits NormalizedEvents.
 */
export class PiAdapter extends EventEmitter {
  private proc: ChildProcess | null = null;
  private readonly opts: PiAdapterOptions;
  private isFirstMessageStart = true;

  constructor(opts: PiAdapterOptions) {
    super();
    this.opts = opts;
  }

  start(): void {
    const { cwd, sessionPath, piPath, env } = this.opts;

    const args = ['--mode', 'rpc'];

    if (sessionPath === null) {
      args.push('--no-session');
    } else {
      const dir = path.dirname(sessionPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      args.push('--session', sessionPath);
      if (fs.existsSync(sessionPath)) {
        args.push('--continue');
      }
    }

    log.info(`[PiAdapter] Spawning: ${piPath} ${args.join(' ')} (cwd=${cwd})`);

    this.proc = spawn(piPath, args, {
      cwd,
      env: { ...process.env, ...(env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const rl = createInterface({ input: this.proc.stdout! });

    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        this.handlePiEvent(obj);
      } catch (err) {
        log.warn(`[PiAdapter] Failed to parse JSONL line: ${line}`, err);
      }
    });

    this.proc.stderr?.on('data', (chunk: Buffer) => {
      log.warn(`[PiAdapter] stderr: ${chunk.toString()}`);
    });

    this.proc.on('exit', (code, signal) => {
      log.info(`[PiAdapter] Process exited: code=${code} signal=${signal}`);
    });

    this.proc.on('error', (err) => {
      log.error('[PiAdapter] Spawn error:', err);
      this.emit('event', { type: 'error', message: err.message } satisfies NormalizedEvent);
    });
  }

  sendMessage(text: string): void {
    if (!this.proc?.stdin) {
      log.warn('[PiAdapter] Cannot sendMessage: no stdin');
      return;
    }
    const payload = JSON.stringify({ type: 'prompt', message: text });
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
        this.proc.stdin?.write(JSON.stringify({ type: 'abort' }) + '\n');
      } catch {}
      try {
        this.proc.kill('SIGTERM');
      } catch {}
      this.proc = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Map Pi RPC events → NormalizedEvent
  // ---------------------------------------------------------------------------

  private handlePiEvent(obj: Record<string, unknown>): void {
    const msgType = obj.type as string | undefined;

    // Filter out RPC acknowledgments
    if (msgType === 'response') return;

    if (msgType === 'message_start') {
      const message = obj.message as Record<string, unknown> | undefined;
      const role = message?.role as string | undefined;

      // Ignore user/toolResult echoes from Pi
      if (role !== 'assistant') return;

      if (this.isFirstMessageStart) {
        this.isFirstMessageStart = false;
        // Emit session_init with model/tools extracted from the first assistant message
        const model = (message?.model as string) ?? '';
        const tools = (message?.tools as string[]) ?? [];
        this.emit('event', {
          type: 'session_init',
          model,
          tools,
          sessionId: '',
        } satisfies NormalizedEvent);
      }

      this.emit('event', { type: 'message_start', role: 'assistant' } satisfies NormalizedEvent);
      return;
    }

    if (msgType === 'message_update') {
      const assistantMessageEvent = obj.assistantMessageEvent as
        | Record<string, unknown>
        | undefined;
      if (!assistantMessageEvent) return;

      const eventType = assistantMessageEvent.type as string | undefined;

      if (eventType === 'text_delta') {
        const delta = (assistantMessageEvent.delta as string) ?? '';
        this.emit('event', { type: 'text_delta', text: delta } satisfies NormalizedEvent);
        return;
      }

      if (eventType === 'thinking_start') {
        this.emit('event', { type: 'thinking_start' } satisfies NormalizedEvent);
        return;
      }

      if (eventType === 'thinking_delta') {
        const delta = (assistantMessageEvent.delta as string) ?? '';
        this.emit('event', { type: 'thinking_delta', text: delta } satisfies NormalizedEvent);
        return;
      }

      if (eventType === 'thinking_end') {
        this.emit('event', { type: 'thinking_end' } satisfies NormalizedEvent);
        return;
      }

      if (eventType === 'toolcall_start') {
        log.debug('[PiAdapter] toolcall_start raw:', JSON.stringify(assistantMessageEvent));
        // Tool info is nested inside partial.content
        const partial = assistantMessageEvent.partial as Record<string, unknown> | undefined;
        const content = partial?.content as Record<string, unknown> | undefined;
        const toolName = (content?.name as string) ?? 'unknown';
        const toolCallId = (content?.id as string) ?? '';
        const args = content?.input ?? {};
        this.emit('event', {
          type: 'tool_call_start',
          toolName,
          toolCallId,
          args,
        } satisfies NormalizedEvent);
        return;
      }

      // text_start, text_end, toolcall_delta, toolcall_end — currently no-ops
      log.debug('[PiAdapter] unhandled message_update subtype:', eventType);
      return;
    }

    if (msgType === 'tool_execution_end') {
      const toolCallId = (obj.tool_call_id as string) ?? (obj.toolCallId as string) ?? '';
      const rawContent = obj.content;
      let contentText = '';
      if (typeof rawContent === 'string') {
        contentText = rawContent;
      } else if (Array.isArray(rawContent)) {
        contentText = (rawContent as Array<Record<string, unknown>>)
          .map((c) => (typeof c.text === 'string' ? c.text : JSON.stringify(c)))
          .join('\n');
      }
      const isError = (obj.is_error as boolean) ?? false;
      this.emit('event', {
        type: 'tool_result',
        toolCallId,
        result: { type: 'other', content: contentText, isError },
      } satisfies NormalizedEvent);
      return;
    }

    if (msgType === 'message_end') {
      const message = obj.message as Record<string, unknown> | undefined;
      const role = message?.role as string | undefined;

      // Ignore user/toolResult echoes
      if (role !== 'assistant') return;

      const stopReason = (message?.stop_reason as string) ?? 'end_turn';
      this.emit('event', { type: 'message_end', stopReason } satisfies NormalizedEvent);
      return;
    }

    if (msgType === 'turn_end') {
      const message = obj.message as Record<string, unknown> | undefined;
      const rawUsage = message?.usage as Record<string, unknown> | undefined;
      const cost = rawUsage?.cost as Record<string, unknown> | undefined;

      const usage: TokenUsage = {
        input: (rawUsage?.input_tokens as number) ?? 0,
        output: (rawUsage?.output_tokens as number) ?? 0,
        cost: (cost?.total as number) ?? 0,
      };

      this.emit('event', { type: 'turn_end', usage } satisfies NormalizedEvent);
      return;
    }

    if (msgType === 'agent_end') {
      const message = obj.message as Record<string, unknown> | undefined;
      const rawUsage = message?.usage as Record<string, unknown> | undefined;
      const cost = rawUsage?.cost as Record<string, unknown> | undefined;
      const totalCost = (cost?.total as number) ?? 0;

      const totalTokens: TokenUsage = {
        input: (rawUsage?.input_tokens as number) ?? 0,
        output: (rawUsage?.output_tokens as number) ?? 0,
        cost: totalCost,
      };

      this.emit('event', { type: 'agent_end', totalCost, totalTokens } satisfies NormalizedEvent);
      return;
    }

    if (msgType === 'error') {
      this.emit('event', {
        type: 'error',
        message: (obj.message as string) ?? 'Unknown Pi error',
      } satisfies NormalizedEvent);
      return;
    }

    log.debug('[PiAdapter] unhandled top-level event type:', msgType, JSON.stringify(obj));
  }
}
