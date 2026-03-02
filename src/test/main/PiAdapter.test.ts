import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { NormalizedEvent } from '@shared/types/agentEvents';

// Mock logger
vi.mock('../../main/lib/logger', () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs so we don't hit the filesystem
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
  };
});

// Mock readline — return an EventEmitter so tests can emit 'line' events directly.
// Store a reference on globalThis so tests can access it.
vi.mock('readline', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { EventEmitter: EE } = require('events');
  const rl = new EE();
  (globalThis as Record<string, unknown>).__mockRl__ = rl;
  return { createInterface: vi.fn().mockReturnValue(rl) };
});

// Mock child_process.spawn — stdin write + process kill are what we care about.
vi.mock('child_process', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { EventEmitter: EE } = require('events');
  const stdin = { write: vi.fn() };
  const proc = Object.assign(new EE(), {
    stdin,
    stdout: new EE(), // not used directly (readline mock takes over)
    stderr: new EE(),
    exitCode: null,
    killed: false,
    kill: vi.fn(),
  });
  (globalThis as Record<string, unknown>).__mockPiProc__ = proc;
  (globalThis as Record<string, unknown>).__mockPiStdin__ = stdin;
  return { spawn: vi.fn().mockReturnValue(proc) };
});

// Import after mocks are set up
import { PiAdapter } from '../../main/services/adapters/PiAdapter';

function getMocks() {
  return {
    rl: (globalThis as Record<string, unknown>).__mockRl__ as EventEmitter,
    proc: (globalThis as Record<string, unknown>).__mockPiProc__ as EventEmitter & {
      kill: ReturnType<typeof vi.fn>;
    },
    stdin: (globalThis as Record<string, unknown>).__mockPiStdin__ as {
      write: ReturnType<typeof vi.fn>;
    },
  };
}

/**
 * Create an adapter, start it, collect emitted events.
 * Returns a feed() helper that simulates a stdout readline 'line' event.
 */
function createAdapter() {
  const adapter = new PiAdapter({
    cwd: '/tmp/test',
    sessionPath: null,
    piPath: 'pi',
    env: {},
  });

  const events: NormalizedEvent[] = [];
  adapter.on('event', (e: NormalizedEvent) => events.push(e));

  adapter.start();

  const { rl } = getMocks();
  const feed = (obj: unknown) => {
    rl.emit('line', JSON.stringify(obj));
  };

  return { adapter, events, feed };
}

beforeEach(() => {
  const { stdin, proc } = getMocks();
  stdin.write.mockClear();
  proc.kill.mockClear();
});

describe('PiAdapter event mapping', () => {
  it('maps text_delta to text_delta event', () => {
    const { events, feed } = createAdapter();

    feed({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
    });

    expect(events).toContainEqual({ type: 'text_delta', text: 'Hello' });
  });

  it('maps thinking_start, thinking_delta, thinking_end', () => {
    const { events, feed } = createAdapter();

    feed({ type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } });
    feed({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: 'reasoning' },
    });
    feed({ type: 'message_update', assistantMessageEvent: { type: 'thinking_end' } });

    expect(events).toContainEqual({ type: 'thinking_start' });
    expect(events).toContainEqual({ type: 'thinking_delta', text: 'reasoning' });
    expect(events).toContainEqual({ type: 'thinking_end' });
  });

  it('maps toolcall_start to tool_call_start', () => {
    const { events, feed } = createAdapter();

    feed({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_start',
        partial: {
          content: {
            id: 'tc-123',
            name: 'bash',
            input: { command: 'ls' },
          },
        },
      },
    });

    expect(events).toContainEqual({
      type: 'tool_call_start',
      toolName: 'bash',
      toolCallId: 'tc-123',
      args: { command: 'ls' },
    });
  });

  it('maps tool_execution_end to tool_result', () => {
    const { events, feed } = createAdapter();

    feed({
      type: 'tool_execution_end',
      tool_call_id: 'tc-123',
      content: 'file contents here',
      is_error: false,
    });

    expect(events).toContainEqual({
      type: 'tool_result',
      toolCallId: 'tc-123',
      result: { type: 'other', content: 'file contents here', isError: false },
    });
  });

  it('maps turn_end with usage', () => {
    const { events, feed } = createAdapter();

    feed({
      type: 'turn_end',
      message: {
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cost: { total: 0.002 },
        },
      },
    });

    expect(events).toContainEqual({
      type: 'turn_end',
      usage: { input: 100, output: 50, cost: 0.002 },
    });
  });

  it('maps agent_end with total cost', () => {
    const { events, feed } = createAdapter();

    feed({
      type: 'agent_end',
      message: {
        usage: {
          input_tokens: 200,
          output_tokens: 80,
          cost: { total: 0.005 },
        },
      },
    });

    const agentEnd = events.find((e) => e.type === 'agent_end');
    expect(agentEnd).toBeDefined();
    if (agentEnd?.type === 'agent_end') {
      expect(agentEnd.totalCost).toBe(0.005);
      expect(agentEnd.totalTokens.input).toBe(200);
      expect(agentEnd.totalTokens.output).toBe(80);
    }
  });

  it('ignores RPC response lines', () => {
    const { events, feed } = createAdapter();

    feed({ type: 'response', id: 1, result: 'ok' });

    expect(events).toHaveLength(0);
  });

  it('ignores user role message_start', () => {
    const { events, feed } = createAdapter();

    feed({ type: 'message_start', message: { role: 'user', content: 'hello' } });

    expect(events).toHaveLength(0);
  });

  it('ignores toolResult role message_end', () => {
    const { events, feed } = createAdapter();

    feed({ type: 'message_end', message: { role: 'toolResult', stop_reason: 'end_turn' } });

    expect(events).toHaveLength(0);
  });

  it('emits session_init on first assistant message_start', () => {
    const { events, feed } = createAdapter();

    feed({
      type: 'message_start',
      message: { role: 'assistant', model: 'claude-3-5-sonnet', tools: ['bash', 'read_file'] },
    });

    expect(events[0]).toMatchObject({ type: 'session_init', model: 'claude-3-5-sonnet' });
    expect(events[1]).toMatchObject({ type: 'message_start', role: 'assistant' });
  });

  it('does not re-emit session_init on subsequent assistant message_start', () => {
    const { events, feed } = createAdapter();

    feed({ type: 'message_start', message: { role: 'assistant', model: 'claude-3-5-sonnet' } });
    feed({ type: 'message_start', message: { role: 'assistant', model: 'claude-3-5-sonnet' } });

    const sessionInits = events.filter((e) => e.type === 'session_init');
    expect(sessionInits).toHaveLength(1);
  });
});

describe('PiAdapter sendMessage', () => {
  it('writes correct JSON to stdin', () => {
    const { adapter } = createAdapter();

    adapter.sendMessage('hello world');

    const { stdin } = getMocks();
    expect(stdin.write).toHaveBeenCalledWith(
      JSON.stringify({ type: 'prompt', message: 'hello world' }) + '\n'
    );
  });
});

describe('PiAdapter abort', () => {
  it('writes abort command and kills process', () => {
    const { adapter } = createAdapter();

    adapter.abort();

    const { stdin, proc } = getMocks();
    expect(stdin.write).toHaveBeenCalledWith(JSON.stringify({ type: 'abort' }) + '\n');
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
