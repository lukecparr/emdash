import React from 'react';
import { cn } from '@/lib/utils';
import ThinkingBlock from './ThinkingBlock';
import ToolCallBlock from './ToolCallBlock';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import type { ToolResult } from '@shared/types/agentEvents';

export type MessageBlock =
  | { kind: 'text'; text: string }
  | { kind: 'image'; data: string; mimeType: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; toolName: string; toolCallId: string; args: unknown; result?: ToolResult };

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  blocks: MessageBlock[];
};

interface MessageBubbleProps {
  message: ChatMessage;
  className?: string;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, className }) => {
  const isUser = message.role === 'user';

  if (isUser) {
    const textContent = message.blocks
      .filter((b) => b.kind === 'text')
      .map((b) => (b.kind === 'text' ? b.text : ''))
      .join('');
    const imageBlocks = message.blocks.filter((b) => b.kind === 'image');

    return (
      <div className={cn('flex justify-end py-1', className)}>
        <div className="max-w-[80%] space-y-2 text-right">
          {imageBlocks.map((block, i) =>
            block.kind === 'image' ? (
              <img
                key={`img-${i}`}
                src={`data:${block.mimeType};base64,${block.data}`}
                alt="Pasted image"
                className="ml-auto max-h-64 max-w-full rounded-md border border-border object-contain"
              />
            ) : null
          )}
          {textContent && (
            <p className="whitespace-pre-wrap text-sm text-foreground/80">{textContent}</p>
          )}
        </div>
      </div>
    );
  }

  // Assistant message — flat, no container
  return (
    <div className={cn('py-1', className)}>
      {message.blocks.map((block, i) => {
        if (block.kind === 'text') {
          if (!block.text) return null;
          return (
            <MarkdownRenderer
              key={i}
              content={block.text}
              variant="full"
              className="text-sm leading-relaxed text-foreground [&_p:last-child]:mb-0"
            />
          );
        }

        if (block.kind === 'thinking') {
          return <ThinkingBlock key={i} text={block.text} />;
        }

        if (block.kind === 'tool') {
          return (
            <ToolCallBlock
              key={i}
              toolName={block.toolName}
              args={block.args}
              result={block.result}
            />
          );
        }

        return null;
      })}
    </div>
  );
};

export default MessageBubble;
