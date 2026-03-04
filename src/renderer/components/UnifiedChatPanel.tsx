import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Send, StopCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import MessageBubble, { type ChatMessage, type MessageBlock } from './chat/MessageBubble';
import type { NormalizedEvent, ToolResult } from '@shared/types/agentEvents';

interface ImagePreview {
  id: string;
  data: string; // base64
  mimeType: string;
  /** Object URL for preview rendering (revoked on removal) */
  previewUrl: string;
}

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

/** Read a File/Blob as a base64 data string (without the data-url prefix). */
function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:<mime>;base64," prefix
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const ACCEPTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

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
  const [pendingImages, setPendingImages] = useState<ImagePreview[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Clean up object URLs when component unmounts
  useEffect(() => {
    return () => {
      pendingImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addImages = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => ACCEPTED_IMAGE_TYPES.has(f.type));
    if (imageFiles.length === 0) return;

    const newPreviews: ImagePreview[] = [];
    for (const file of imageFiles) {
      const data = await fileToBase64(file);
      const previewUrl = URL.createObjectURL(file);
      newPreviews.push({
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        data,
        mimeType: file.type,
        previewUrl,
      });
    }
    setPendingImages((prev) => [...prev, ...newPreviews]);
  }, []);

  const removeImage = useCallback((id: string) => {
    setPendingImages((prev) => {
      const removed = prev.find((img) => img.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((img) => img.id !== id);
    });
  }, []);

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

          // Check if a tool block with this ID already exists — update it instead
          const existingIndex = last.blocks.findIndex(
            (b) => b.kind === 'tool' && b.toolCallId === event.toolCallId
          );

          if (existingIndex >= 0) {
            // Update existing tool block with complete info
            const blocks = last.blocks.map((b, i) => {
              if (i === existingIndex && b.kind === 'tool') {
                return {
                  ...b,
                  toolName: event.toolName !== 'unknown' ? event.toolName : b.toolName,
                  args:
                    event.args && Object.keys(event.args as object).length > 0
                      ? event.args
                      : b.args,
                };
              }
              return b;
            });
            return [...prev.slice(0, -1), { ...last, blocks }];
          }

          // New tool block
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
    const images = pendingImages;
    if ((!text && images.length === 0) || !sessionReady || isRunning) return;

    setInputText('');
    // Clear pending images without revoking URLs — the message bubble will use the base64 data
    setPendingImages([]);
    // Revoke preview URLs since we no longer need them
    images.forEach((img) => URL.revokeObjectURL(img.previewUrl));

    // Build user message blocks
    const blocks: MessageBlock[] = [];
    for (const img of images) {
      blocks.push({ kind: 'image', data: img.data, mimeType: img.mimeType });
    }
    if (text) {
      blocks.push({ kind: 'text', text });
    }

    setMessages((prev) => [...prev, { id: nextId(), role: 'user', blocks }]);
    setIsRunning(true);

    const ipcImages =
      images.length > 0
        ? images.map((img) => ({ data: img.data, mimeType: img.mimeType }))
        : undefined;

    await window.electronAPI.agentSessionPrompt({
      sessionId,
      message: text || '(image attached)',
      images: ipcImages,
    });
  }, [inputText, pendingImages, sessionId, sessionReady, isRunning]);

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

  // Handle paste events to capture images from clipboard
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && ACCEPTED_IMAGE_TYPES.has(item.type)) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault(); // Don't paste the image as text
        await addImages(imageFiles);
      }
    },
    [addImages]
  );

  // Handle drag-and-drop of image files
  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        ACCEPTED_IMAGE_TYPES.has(f.type)
      );
      if (files.length > 0) {
        await addImages(files);
      }
    },
    [addImages]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

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
      <div
        className="border-t border-border px-4 py-3"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {/* Image previews */}
        {pendingImages.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingImages.map((img) => (
              <div key={img.id} className="group relative">
                <img
                  src={img.previewUrl}
                  alt="Pending attachment"
                  className="h-16 w-16 rounded-md border border-border object-cover"
                />
                <button
                  onClick={() => removeImage(img.id)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                  title="Remove image"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              sessionReady
                ? `Message ${providerId.charAt(0).toUpperCase() + providerId.slice(1)}… (Enter to send, Shift+Enter for newline, paste images)`
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
              disabled={(!inputText.trim() && pendingImages.length === 0) || !sessionReady}
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
