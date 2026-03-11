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

export interface PiSlashCommand {
  name: string;
  description?: string;
  source: 'builtin' | 'extension' | 'prompt' | 'skill';
  location?: 'user' | 'project' | 'path';
  path?: string;
}

/**
 * Spawns `pi --mode rpc` with bidirectional JSON over stdin/stdout,
 * parses JSONL from stdout, and emits NormalizedEvents.
 */
export class PiAdapter extends EventEmitter {
  private proc: ChildProcess | null = null;
  private readonly opts: PiAdapterOptions;
  private isFirstMessageStart = true;
  // Pending RPC request/response tracking (keyed by request id)
  private pendingRpcRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private rpcIdCounter = 0;

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

  sendMessage(text: string, images?: Array<{ data: string; mimeType: string }>): void {
    if (!this.proc?.stdin) {
      log.warn('[PiAdapter] Cannot sendMessage: no stdin');
      return;
    }
    const cmd: Record<string, unknown> = { type: 'prompt', message: text };
    if (images?.length) {
      cmd.images = images.map((img) => ({
        type: 'image',
        data: img.data,
        mimeType: img.mimeType,
      }));
    }
    const payload = JSON.stringify(cmd);
    this.proc.stdin.write(payload + '\n');
  }

  /**
   * Send an RPC command and wait for a matching response.
   */
  private sendRpcRequest(cmd: Record<string, unknown>, timeoutMs = 5000): Promise<unknown> {
    if (!this.proc?.stdin) {
      return Promise.reject(new Error('No Pi process stdin'));
    }
    const id = `rpc-${++this.rpcIdCounter}`;
    const payload = JSON.stringify({ ...cmd, id });

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRpcRequests.delete(id);
        reject(new Error(`RPC request '${cmd.type}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRpcRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.proc!.stdin!.write(payload + '\n');
    });
  }

  /**
   * Fetch all available slash commands from the running Pi session.
   * Returns builtin commands merged with dynamically loaded extensions/prompts/skills.
   */
  async getCommands(): Promise<PiSlashCommand[]> {
    // Builtin slash commands (always available regardless of RPC state)
    const builtins: PiSlashCommand[] = [
      { name: 'settings', description: 'Open settings menu', source: 'builtin' },
      { name: 'model', description: 'Select model (opens selector UI)', source: 'builtin' },
      {
        name: 'scoped-models',
        description: 'Enable/disable models for Ctrl+P cycling',
        source: 'builtin',
      },
      { name: 'export', description: 'Export session to HTML file', source: 'builtin' },
      { name: 'share', description: 'Share session as a secret GitHub gist', source: 'builtin' },
      { name: 'copy', description: 'Copy last agent message to clipboard', source: 'builtin' },
      { name: 'name', description: 'Set session display name', source: 'builtin' },
      { name: 'session', description: 'Show session info and stats', source: 'builtin' },
      { name: 'changelog', description: 'Show changelog entries', source: 'builtin' },
      { name: 'hotkeys', description: 'Show all keyboard shortcuts', source: 'builtin' },
      { name: 'fork', description: 'Create a new fork from a previous message', source: 'builtin' },
      {
        name: 'tree',
        description: 'Navigate session tree (switch branches)',
        source: 'builtin',
      },
      { name: 'login', description: 'Login with OAuth provider', source: 'builtin' },
      { name: 'logout', description: 'Logout from OAuth provider', source: 'builtin' },
      { name: 'new', description: 'Start a new session', source: 'builtin' },
      { name: 'compact', description: 'Manually compact the session context', source: 'builtin' },
      { name: 'resume', description: 'Resume a different session', source: 'builtin' },
      {
        name: 'reload',
        description: 'Reload extensions, skills, prompts, and themes',
        source: 'builtin',
      },
      { name: 'quit', description: 'Quit pi', source: 'builtin' },
    ];

    if (!this.proc?.stdin) {
      return builtins;
    }

    try {
      const data = (await this.sendRpcRequest({ type: 'get_commands' })) as {
        commands?: Array<{
          name: string;
          description?: string;
          source: string;
          location?: string;
          path?: string;
        }>;
      };

      const dynamicCommands: PiSlashCommand[] = (data?.commands ?? []).map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        source: cmd.source as PiSlashCommand['source'],
        location: cmd.location as PiSlashCommand['location'],
        path: cmd.path,
      }));

      return [...builtins, ...dynamicCommands];
    } catch (err) {
      log.warn('[PiAdapter] Failed to get commands:', err);
      return builtins;
    }
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

    // Route RPC responses to pending request handlers
    if (msgType === 'response') {
      const id = obj.id as string | undefined;
      if (id && this.pendingRpcRequests.has(id)) {
        const pending = this.pendingRpcRequests.get(id)!;
        this.pendingRpcRequests.delete(id);
        if (obj.success === false) {
          pending.reject(new Error((obj.error as string) ?? 'RPC request failed'));
        } else {
          pending.resolve(obj.data);
        }
      }
      return;
    }

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
        // Tool info is at partial.content[contentIndex]
        const contentIndex = assistantMessageEvent.contentIndex as number | undefined;
        const partial = assistantMessageEvent.partial as Record<string, unknown> | undefined;
        const contentArray = partial?.content as Array<Record<string, unknown>> | undefined;
        const toolContent =
          contentArray && typeof contentIndex === 'number' ? contentArray[contentIndex] : undefined;
        const toolName = (toolContent?.name as string) ?? 'unknown';
        const toolCallId = (toolContent?.id as string) ?? '';
        const args = toolContent?.arguments ?? toolContent?.input ?? {};
        this.emit('event', {
          type: 'tool_call_start',
          toolName,
          toolCallId,
          args,
        } satisfies NormalizedEvent);
        return;
      }

      if (eventType === 'toolcall_end') {
        // toolcall_end has the complete ToolCall object — update args
        const toolCall = assistantMessageEvent.toolCall as Record<string, unknown> | undefined;
        if (toolCall) {
          const toolName = (toolCall.name as string) ?? 'unknown';
          const toolCallId = (toolCall.id as string) ?? '';
          const args = toolCall.arguments ?? {};
          this.emit('event', {
            type: 'tool_call_start',
            toolName,
            toolCallId,
            args,
          } satisfies NormalizedEvent);
        }
        return;
      }

      // text_start, text_end, toolcall_delta — currently no-ops
      log.debug('[PiAdapter] unhandled message_update subtype:', eventType);
      return;
    }

    if (msgType === 'tool_execution_start') {
      // tool_execution_start has complete tool info — re-emit to update args
      const toolCallId = (obj.toolCallId as string) ?? '';
      const toolName = (obj.toolName as string) ?? 'unknown';
      const args = obj.args ?? {};
      this.emit('event', {
        type: 'tool_call_start',
        toolName,
        toolCallId,
        args,
      } satisfies NormalizedEvent);
      return;
    }

    if (msgType === 'tool_execution_update') {
      // Partial result streaming during tool execution
      const toolCallId = (obj.toolCallId as string) ?? '';
      const partialResult = obj.partialResult as Record<string, unknown> | undefined;
      if (partialResult) {
        const rawContent = partialResult.content;
        let contentText = '';
        if (typeof rawContent === 'string') {
          contentText = rawContent;
        } else if (Array.isArray(rawContent)) {
          contentText = (rawContent as Array<Record<string, unknown>>)
            .map((c) => (typeof c.text === 'string' ? c.text : JSON.stringify(c)))
            .join('\n');
        }
        this.emit('event', {
          type: 'tool_result',
          toolCallId,
          result: { type: 'other', content: contentText, isError: false },
        } satisfies NormalizedEvent);
      }
      return;
    }

    if (msgType === 'tool_execution_end') {
      const toolCallId = (obj.toolCallId as string) ?? (obj.tool_call_id as string) ?? '';
      const isError = (obj.isError as boolean) ?? (obj.is_error as boolean) ?? false;

      // result is { content: Array<{ type: "text", text: string }>, details?: ... }
      const resultObj = obj.result as Record<string, unknown> | undefined;
      const rawContent = resultObj?.content ?? obj.content;
      let contentText = '';
      if (typeof rawContent === 'string') {
        contentText = rawContent;
      } else if (Array.isArray(rawContent)) {
        contentText = (rawContent as Array<Record<string, unknown>>)
          .map((c) => (typeof c.text === 'string' ? c.text : JSON.stringify(c)))
          .join('\n');
      }
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
