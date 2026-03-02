import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Send, StopCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import MessageBubble, { type ChatMessage, type MessageBlock } from './chat/MessageBubble';
import type { NormalizedEvent, ToolResult } from '@shared/types/agentEvents';

interface UnifiedChatPanelProps {
  sessionId: string;
  cwd: string;
  providerId: string;
  autoApprove: boolean;
  taskId: string;
  conversationId: string;
  env?: Record<string, string>;
  resume?: boolean;
  className?: string;
}

let _msgCounter = 0;
function nextId(): string {
  return `msg-${++_msgCounter}`;
}

const UnifiedChatPanel: React.FC<UnifiedChatPanelProps> = ({
  sessionId,
  cwd,
  providerId,
  autoApprove,
  taskId,
  conversationId,
  env,
  resume,
  className,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleNormalizedEvent = useCallback((event: NormalizedEvent) => {
    switch (event.type) {
      case 'history_replay': {
        setMessages(event.messages as ChatMessage[]);
        break;
      }

      case 'message_start': {
        setIsRunning(true);
        setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', blocks: [] }]);
        break;
      }

      case 'text_delta': {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          const blocks = [...last.blocks];
          const lastBlock = blocks[blocks.length - 1];
          if (lastBlock?.kind === 'text') {
            blocks[blocks.length - 1] = { kind: 'text', text: lastBlock.text + event.text };
          } else {
            blocks.push({ kind: 'text', text: event.text });
          }
          return [...prev.slice(0, -1), { ...last, blocks }];
        });
        break;
      }

      case 'thinking_start': {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          const blocks: MessageBlock[] = [...last.blocks, { kind: 'thinking', text: '' }];
          return [...prev.slice(0, -1), { ...last, blocks }];
        });
        break;
      }

      case 'thinking_delta': {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          const blocks = [...last.blocks];
          const lastBlock = blocks[blocks.length - 1];
          if (lastBlock?.kind === 'thinking') {
            blocks[blocks.length - 1] = { kind: 'thinking', text: lastBlock.text + event.text };
          }
          return [...prev.slice(0, -1), { ...last, blocks }];
        });
        break;
      }

      case 'tool_call_start': {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          const blocks: MessageBlock[] = [
            ...last.blocks,
            {
              kind: 'tool',
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              args: event.args,
            },
          ];
          return [...prev.slice(0, -1), { ...last, blocks }];
        });
        break;
      }

      case 'tool_result': {
        const result: ToolResult = event.result;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          const blocks = last.blocks.map((b) => {
            if (b.kind === 'tool' && b.toolCallId === event.toolCallId) {
              return { ...b, result };
            }
            return b;
          });
          return [...prev.slice(0, -1), { ...last, blocks }];
        });
        break;
      }

      case 'agent_end':
      case 'turn_end': {
        setIsRunning(false);
        break;
      }

      case 'error': {
        setIsRunning(false);
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            blocks: [{ kind: 'text', text: `Error: ${event.message}` }],
          },
        ]);
        break;
      }
    }
  }, []);

  // Single effect: attach the event listener synchronously FIRST, then fire the
  // async agentSessionCreate IPC call. This guarantees the listener is registered
  // before the main process sends history_replay via webContents.send().
  useEffect(() => {
    let destroyed = false;

    const off = window.electronAPI.onAgentEvent(sessionId, (event: NormalizedEvent) => {
      if (!destroyed) handleNormalizedEvent(event);
    });

    const init = async () => {
      const result = await window.electronAPI.agentSessionCreate({
        sessionId,
        cwd,
        providerId,
        autoApprove,
        conversationId,
        taskId,
        env,
        resume,
      });

      if (destroyed) return;

      if (!result.ok) {
        setSessionError(result.error ?? 'Failed to create session');
        return;
      }

      // History is returned directly in the IPC response — no event timing issues.
      if (result.history?.length) {
        setMessages(result.history as ChatMessage[]);
      }

      setSessionReady(true);
    };

    init().catch((err: unknown) => {
      if (!destroyed) {
        setSessionError(err instanceof Error ? err.message : String(err));
      }
    });

    return () => {
      destroyed = true;
      off();
      window.electronAPI.agentSessionDestroy({ sessionId }).catch(() => {});
    };
  }, [
    sessionId,
    cwd,
    providerId,
    autoApprove,
    conversationId,
    taskId,
    env,
    resume,
    handleNormalizedEvent,
  ]);

  const handleSubmit = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !sessionReady || isRunning) return;

    setInputText('');
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'user', blocks: [{ kind: 'text', text }] },
    ]);
    setIsRunning(true);

    await window.electronAPI.agentSessionPrompt({ sessionId, message: text });
  }, [inputText, sessionId, sessionReady, isRunning]);

  const handleAbort = useCallback(async () => {
    await window.electronAPI.agentSessionAbort({ sessionId });
    setIsRunning(false);
  }, [sessionId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit]
  );

  if (sessionError) {
    return (
      <div
        className={cn('flex items-center justify-center p-8 text-sm text-destructive', className)}
      >
        <p>Failed to start agent: {sessionError}</p>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 && !isRunning && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {sessionReady ? 'Send a message to start' : 'Connecting…'}
          </div>
        )}
        <div className="flex flex-col divide-y divide-border/30">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} className="py-3" />
          ))}
          {isRunning && messages[messages.length - 1]?.role !== 'assistant' && (
            <div className="py-3">
              <span className="animate-pulse text-xs text-muted-foreground">thinking…</span>
            </div>
          )}
        </div>
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-border px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              sessionReady
                ? `Message ${providerId.charAt(0).toUpperCase() + providerId.slice(1)}… (Enter to send, Shift+Enter for newline)`
                : 'Connecting…'
            }
            disabled={!sessionReady}
            rows={1}
            className={cn(
              'flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm',
              'placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'max-h-40 overflow-y-auto'
            )}
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          {isRunning ? (
            <button
              onClick={handleAbort}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              title="Stop"
            >
              <StopCircle className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={() => void handleSubmit()}
              disabled={!inputText.trim() || !sessionReady}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
              title="Send (Enter)"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default UnifiedChatPanel;
