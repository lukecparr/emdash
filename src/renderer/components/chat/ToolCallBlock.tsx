import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Terminal, FileText, Search, File } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolResult } from '@shared/types/agentEvents';

const CONTENT_LINE_LIMIT = 18;

interface ToolCallBlockProps {
  toolName: string;
  args?: unknown;
  result?: ToolResult;
  className?: string;
}

function getToolIcon(toolName: string) {
  const t = toolName.toLowerCase();
  if (t.includes('bash') || t.includes('shell') || t.includes('exec')) return Terminal;
  if (t.includes('read') || t.includes('view')) return FileText;
  if (t.includes('search') || t.includes('grep') || t.includes('glob')) return Search;
  return File;
}

/** Extract the most interesting part of tool args for inline display. */
function extractArgs(toolName: string, args: unknown): { label: string; body?: string } {
  if (!args || typeof args !== 'object') return { label: '' };
  const a = args as Record<string, unknown>;
  const t = toolName.toLowerCase();

  // Bash / shell commands
  if (t.includes('bash') || t.includes('shell') || t.includes('exec')) {
    const cmd = (a.command ?? a.cmd ?? a.input) as string | undefined;
    return { label: typeof cmd === 'string' ? cmd : '' };
  }

  // File write / create
  if (
    t.includes('write') ||
    t.includes('create') ||
    t.includes('edit') ||
    t.includes('str_replace')
  ) {
    const filePath = (a.path ?? a.file_path ?? a.filename ?? a.file) as string | undefined;
    const content = (a.content ?? a.new_content ?? a.new_str) as string | undefined;
    return {
      label: typeof filePath === 'string' ? filePath : '',
      body: typeof content === 'string' ? content : undefined,
    };
  }

  // File read
  if (t.includes('read') || t.includes('view')) {
    const filePath = (a.path ?? a.file_path ?? a.filename) as string | undefined;
    return { label: typeof filePath === 'string' ? filePath : '' };
  }

  // Search / glob
  if (t.includes('glob') || t.includes('search') || t.includes('grep')) {
    const pattern = (a.pattern ?? a.query ?? a.glob) as string | undefined;
    return { label: typeof pattern === 'string' ? pattern : '' };
  }

  // Generic fallback — show first string value
  for (const v of Object.values(a)) {
    if (typeof v === 'string' && v.length < 200) return { label: v };
  }
  return { label: '' };
}

function truncateLines(text: string, limit: number): { text: string; truncated: boolean } {
  const lines = text.split('\n');
  if (lines.length <= limit) return { text, truncated: false };
  return { text: lines.slice(0, limit).join('\n'), truncated: true };
}

const ToolCallBlock: React.FC<ToolCallBlockProps> = ({ toolName, args, result, className }) => {
  const [outputExpanded, setOutputExpanded] = useState(false);
  const Icon = getToolIcon(toolName);
  const { label, body } = extractArgs(toolName, args);

  const hasOutput = !!result?.content;
  const { text: truncatedBody, truncated: bodyTruncated } = body
    ? truncateLines(body, CONTENT_LINE_LIMIT)
    : { text: '', truncated: false };
  const { text: truncatedOutput, truncated: outputTruncated } =
    hasOutput && !outputExpanded
      ? truncateLines(result!.content, CONTENT_LINE_LIMIT)
      : { text: result?.content ?? '', truncated: false };

  return (
    <div className={cn('my-2 font-mono text-xs', className)}>
      {/* Tool call header line */}
      <div className="flex items-baseline gap-2">
        <Icon className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/60" />
        <span className="font-semibold text-muted-foreground/80">{toolName}</span>
        {label && (
          <span className="max-w-[50ch] truncate text-muted-foreground/60" title={label}>
            {label}
          </span>
        )}
        {result?.isError && <span className="text-[10px] text-destructive">error</span>}
      </div>

      {/* Streaming file content (args body — e.g. what's being written to a file) */}
      {body && (
        <div className="ml-5 mt-1 border-l border-muted/40 pl-2">
          <pre className="whitespace-pre-wrap break-all text-[11px] leading-relaxed text-muted-foreground/60">
            {truncatedBody}
          </pre>
          {bodyTruncated && (
            <span className="text-[10px] text-muted-foreground/40">
              … ({body.split('\n').length} lines total)
            </span>
          )}
        </div>
      )}

      {/* Tool output / result */}
      {hasOutput && (
        <div className="ml-5 mt-1">
          <button
            onClick={() => setOutputExpanded((v) => !v)}
            className="mb-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground"
          >
            {outputExpanded ? (
              <ChevronDown className="h-2.5 w-2.5" />
            ) : (
              <ChevronRight className="h-2.5 w-2.5" />
            )}
            output
          </button>
          {outputExpanded && (
            <div className="border-l border-muted/40 pl-2">
              <pre
                className={cn(
                  'whitespace-pre-wrap break-all text-[11px] leading-relaxed',
                  result?.isError ? 'text-destructive/70' : 'text-muted-foreground/60'
                )}
              >
                {truncatedOutput}
              </pre>
              {outputTruncated && (
                <button
                  onClick={() => setOutputExpanded(true)}
                  className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground"
                >
                  … show more
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ToolCallBlock;
