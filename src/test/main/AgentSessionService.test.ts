import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { HistoryMessage, HistoryMessageBlock } from '@shared/types/agentEvents';

// ── Mocks ────────────────────────────────────────────────────────────────────

const TEST_USERDATA = path.join('/tmp', `emdash-test-${process.pid}-${Date.now()}`);

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockImplementation(() => TEST_USERDATA),
  },
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../../main/lib/logger', () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../main/services/providerStatusCache', () => ({
  providerStatusCache: {
    get: vi.fn().mockReturnValue(null),
  },
}));

// Mock PiAdapter — capture sendMessage calls and allow event emission.
let piEventListener: ((event: unknown) => void) | null = null;
const mockPiSendMessage = vi.fn();

vi.mock('../../main/services/adapters/PiAdapter', () => {
  return {
    PiAdapter: vi.fn().mockImplementation(() => ({
      start: vi.fn(),
      abort: vi.fn(),
      sendMessage: mockPiSendMessage,
      waitForExit: vi.fn().mockResolvedValue(undefined),
      on: vi.fn().mockImplementation((event: string, listener: (event: unknown) => void) => {
        if (event === 'event') piEventListener = listener;
      }),
      removeAllListeners: vi.fn(),
    })),
  };
});

// Mock ClaudeCodeAdapter so it doesn't interfere
vi.mock('../../main/services/adapters/ClaudeCodeAdapter', () => ({
  ClaudeCodeAdapter: vi.fn(),
  makeClaudeSessionUuid: vi.fn().mockReturnValue('mock-claude-uuid'),
}));

// Import AFTER mocks — import the class, not the singleton
import { AgentSessionService } from '../../main/services/AgentSessionService';

// ── Helpers ──────────────────────────────────────────────────────────────────

const SESSION_ID = 'test-pi-session';
const TASK_ID = 'task-img';
const CONV_ID = 'conv-img';

function historyFilePath(): string {
  return path.join(TEST_USERDATA, 'pi-sessions', `${TASK_ID}-${CONV_ID}-history.json`);
}

function readPersistedHistory(): HistoryMessage[] {
  const filePath = historyFilePath();
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as HistoryMessage[];
}

function makeMockWebContents() {
  return { isDestroyed: () => false, send: vi.fn() } as never;
}

async function createPiSession(service: AgentSessionService): Promise<HistoryMessage[]> {
  service.attachWindow(makeMockWebContents());
  return service.createSession(SESSION_ID, {
    cwd: '/tmp/test-project',
    providerId: 'pi',
    autoApprove: false,
    conversationId: CONV_ID,
    taskId: TASK_ID,
    env: {},
    resume: false,
  });
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  // Clean up any leftover test data
  const dir = path.join(TEST_USERDATA, 'pi-sessions');
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  mockPiSendMessage.mockClear();
  piEventListener = null;
});

afterEach(() => {
  const dir = path.join(TEST_USERDATA, 'pi-sessions');
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AgentSessionService image support', () => {
  it('passes images through to PiAdapter.sendMessage', async () => {
    const service = new AgentSessionService();
    await createPiSession(service);

    const images = [{ data: 'iVBORw0KGgo=', mimeType: 'image/png' }];
    service.sendMessage(SESSION_ID, 'describe this', images);

    expect(mockPiSendMessage).toHaveBeenCalledWith('describe this', images);
  });

  it('persists image blocks in Pi history for user messages', async () => {
    const service = new AgentSessionService();
    await createPiSession(service);

    const images = [
      { data: 'png-base64-data', mimeType: 'image/png' },
      { data: 'jpeg-base64-data', mimeType: 'image/jpeg' },
    ];
    service.sendMessage(SESSION_ID, 'what are these?', images);

    const history = readPersistedHistory();
    expect(history).toHaveLength(1);

    const userMsg = history[0];
    expect(userMsg.role).toBe('user');
    expect(userMsg.blocks).toHaveLength(3); // 2 images + 1 text

    expect(userMsg.blocks[0]).toEqual({
      kind: 'image',
      data: 'png-base64-data',
      mimeType: 'image/png',
    });
    expect(userMsg.blocks[1]).toEqual({
      kind: 'image',
      data: 'jpeg-base64-data',
      mimeType: 'image/jpeg',
    });
    expect(userMsg.blocks[2]).toMatchObject({ kind: 'text', text: 'what are these?' });
  });

  it('persists text-only messages without image blocks', async () => {
    const service = new AgentSessionService();
    await createPiSession(service);

    service.sendMessage(SESSION_ID, 'just text');

    const history = readPersistedHistory();
    expect(history).toHaveLength(1);

    const userMsg = history[0];
    expect(userMsg.blocks).toHaveLength(1);
    expect(userMsg.blocks[0]).toMatchObject({ kind: 'text', text: 'just text' });
    expect(userMsg.blocks.some((b: HistoryMessageBlock) => b.kind === 'image')).toBe(false);
  });

  it('persists messages with empty images array as text-only', async () => {
    const service = new AgentSessionService();
    await createPiSession(service);

    service.sendMessage(SESSION_ID, 'no images', []);

    const history = readPersistedHistory();
    expect(history).toHaveLength(1);

    const userMsg = history[0];
    expect(userMsg.blocks).toHaveLength(1);
    expect(userMsg.blocks[0]).toMatchObject({ kind: 'text', text: 'no images' });
  });

  it('image history survives destroy + recreate (persistence round-trip)', async () => {
    const service = new AgentSessionService();
    await createPiSession(service);

    // Send a message with an image
    service.sendMessage(SESSION_ID, 'check this screenshot', [
      { data: 'screenshot-base64', mimeType: 'image/png' },
    ]);

    // Simulate an assistant reply via the event listener
    if (piEventListener) {
      piEventListener({ type: 'message_start', role: 'assistant' });
      piEventListener({ type: 'text_delta', text: 'I can see the screenshot.' });
      piEventListener({
        type: 'message_end',
        message: { role: 'assistant', stop_reason: 'end_turn' },
      });
    }

    // Destroy the session (simulates switching away from the chat)
    service.destroySession(SESSION_ID);

    // Reset the mock so PiAdapter.on captures a new listener
    piEventListener = null;

    // Recreate the session (simulates switching back)
    // Uses a fresh service to prove we load from disk, not just in-memory cache
    const service2 = new AgentSessionService();
    const history = await createPiSession(service2);

    // History should contain the user message with image + assistant reply
    expect(history).toHaveLength(2);

    // Verify user message has image block
    const userMsg = history[0];
    expect(userMsg.role).toBe('user');
    const imageBlock = userMsg.blocks.find((b: HistoryMessageBlock) => b.kind === 'image');
    expect(imageBlock).toBeDefined();
    if (imageBlock && imageBlock.kind === 'image') {
      expect(imageBlock.data).toBe('screenshot-base64');
      expect(imageBlock.mimeType).toBe('image/png');
    }

    // Verify assistant reply
    const assistantMsg = history[1];
    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.blocks[0]).toMatchObject({
      kind: 'text',
      text: 'I can see the screenshot.',
    });
  });

  it('accumulates multiple user messages with images in history', async () => {
    const service = new AgentSessionService();
    await createPiSession(service);

    service.sendMessage(SESSION_ID, 'first image', [{ data: 'img1', mimeType: 'image/png' }]);

    service.sendMessage(SESSION_ID, 'second image', [{ data: 'img2', mimeType: 'image/jpeg' }]);

    service.sendMessage(SESSION_ID, 'text only');

    const history = readPersistedHistory();
    expect(history).toHaveLength(3);

    // First message: 1 image + 1 text
    expect(history[0].blocks).toHaveLength(2);
    expect(history[0].blocks[0]).toMatchObject({ kind: 'image', data: 'img1' });
    expect(history[0].blocks[1]).toMatchObject({ kind: 'text', text: 'first image' });

    // Second message: 1 image + 1 text
    expect(history[1].blocks).toHaveLength(2);
    expect(history[1].blocks[0]).toMatchObject({ kind: 'image', data: 'img2' });
    expect(history[1].blocks[1]).toMatchObject({ kind: 'text', text: 'second image' });

    // Third message: text only
    expect(history[2].blocks).toHaveLength(1);
    expect(history[2].blocks[0]).toMatchObject({ kind: 'text', text: 'text only' });
  });
});
