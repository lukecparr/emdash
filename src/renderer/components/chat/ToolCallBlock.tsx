import React, { useState, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Terminal,
  FileText,
  Pencil,
  Search,
  FolderSearch,
  FileCode,
  FilePlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolResult } from '@shared/types/agentEvents';

const OUTPUT_LINE_LIMIT = 80;

interface ToolCallBlockProps {
  toolName: string;
  args?: unknown;
  result?: ToolResult;
  className?: string;
}

/** Map tool names to display info */
function getToolDisplay(
  toolName: string,
  args: unknown
): {
  icon: React.FC<{ className?: string }>;
  label: string;
  badges: Array<{ text: string; variant?: 'default' | 'added' | 'removed' }>;
} {
  const t = toolName.toLowerCase();
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;

  // Bash / shell / exec
  if (t === 'bash' || t.includes('shell') || t.includes('exec')) {
    const cmd = (a.command ?? a.cmd ?? a.input) as string | undefined;
    const timeout = a.timeout as number | undefined;
    const badges: Array<{ text: string; variant?: 'default' | 'added' | 'removed' }> = [];
    if (typeof cmd === 'string') badges.push({ text: cmd });
    if (typeof timeout === 'number') badges.push({ text: `${timeout}s timeout` });
    return { icon: Terminal, label: 'Run', badges };
  }

  // Edit / str_replace
  if (t === 'edit' || t.includes('str_replace')) {
    const filePath = (a.path ?? a.file_path ?? a.filename ?? a.file) as string | undefined;
    const oldText = (a.oldText ?? a.old_str) as string | undefined;
    const newText = (a.newText ?? a.new_str ?? a.new_content) as string | undefined;

    const badges: Array<{ text: string; variant?: 'default' | 'added' | 'removed' }> = [];
    if (typeof filePath === 'string') badges.push({ text: shortPath(filePath) });

    if (typeof oldText === 'string' || typeof newText === 'string') {
      const oldLines = typeof oldText === 'string' ? oldText.split('\n').length : 0;
      const newLines = typeof newText === 'string' ? newText.split('\n').length : 0;
      badges.push({ text: `+${newLines}`, variant: 'added' });
      badges.push({ text: `−${oldLines}`, variant: 'removed' });
    }

    return { icon: Pencil, label: 'Edit', badges };
  }

  // Write / create file
  if (t === 'write' || t.includes('create')) {
    const filePath = (a.path ?? a.file_path ?? a.filename ?? a.file) as string | undefined;
    const content = (a.content ?? a.new_content) as string | undefined;
    const badges: Array<{ text: string; variant?: 'default' | 'added' | 'removed' }> = [];
    if (typeof filePath === 'string') badges.push({ text: shortPath(filePath) });
    if (typeof content === 'string') {
      const lines = content.split('\n').length;
      badges.push({ text: `${lines} lines`, variant: 'added' });
    }
    return { icon: FilePlus, label: 'Write', badges };
  }

  // Read / view
  if (t === 'read' || t.includes('view')) {
    const filePath = (a.path ?? a.file_path ?? a.filename) as string | undefined;
    const offset = a.offset as number | undefined;
    const limit = a.limit as number | undefined;
    const badges: Array<{ text: string; variant?: 'default' | 'added' | 'removed' }> = [];
    if (typeof filePath === 'string') badges.push({ text: shortPath(filePath) });
    if (typeof offset === 'number' || typeof limit === 'number') {
      const parts: string[] = [];
      if (typeof offset === 'number') parts.push(`from ${offset}`);
      if (typeof limit === 'number') parts.push(`${limit} lines`);
      badges.push({ text: parts.join(', ') });
    }
    return { icon: FileText, label: 'Read', badges };
  }

  // Find / glob / ls
  if (t === 'find' || t === 'ls' || t.includes('glob')) {
    const pattern = (a.pattern ?? a.glob) as string | undefined;
    const path = a.path as string | undefined;
    const badges: Array<{ text: string; variant?: 'default' | 'added' | 'removed' }> = [];
    if (typeof pattern === 'string') badges.push({ text: pattern });
    if (typeof path === 'string') badges.push({ text: shortPath(path) });
    return { icon: FolderSearch, label: t === 'ls' ? 'List' : 'Find', badges };
  }

  // Grep / search
  if (t === 'grep' || t.includes('search')) {
    const pattern = (a.pattern ?? a.query) as string | undefined;
    const path = a.path as string | undefined;
    const glob = a.glob as string | undefined;
    const badges: Array<{ text: string; variant?: 'default' | 'added' | 'removed' }> = [];
    if (typeof pattern === 'string') badges.push({ text: pattern });
    if (typeof glob === 'string') badges.push({ text: glob });
    if (typeof path === 'string') badges.push({ text: shortPath(path) });
    return { icon: Search, label: 'Grep', badges };
  }

  // Generic fallback
  const badges: Array<{ text: string; variant?: 'default' | 'added' | 'removed' }> = [];
  for (const v of Object.values(a)) {
    if (typeof v === 'string' && v.length < 120) {
      badges.push({ text: v });
      break;
    }
  }
  return { icon: FileCode, label: toolName, badges };
}

/** Shorten a file path for display — show just filename or last 2 segments */
function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 2) return parts.join('/');
  return parts.slice(-2).join('/');
}

function truncateLines(text: string, limit: number): { text: string; truncated: boolean } {
  const lines = text.split('\n');
  if (lines.length <= limit) return { text, truncated: false };
  return { text: lines.slice(0, limit).join('\n'), truncated: true };
}

/** Build a structured view of tool arguments for the expanded detail panel */
function getExpandedArgs(
  toolName: string,
  args: unknown
): Array<{ label: string; value: string; isCode?: boolean }> {
  const t = toolName.toLowerCase();
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const entries: Array<{ label: string; value: string; isCode?: boolean }> = [];

  if (t === 'bash' || t.includes('shell') || t.includes('exec')) {
    const cmd = (a.command ?? a.cmd ?? a.input) as string | undefined;
    if (typeof cmd === 'string') entries.push({ label: 'Command', value: cmd, isCode: true });
    if (typeof a.timeout === 'number') entries.push({ label: 'Timeout', value: `${a.timeout}s` });
    return entries;
  }

  if (t === 'edit' || t.includes('str_replace')) {
    const filePath = (a.path ?? a.file_path ?? a.filename ?? a.file) as string | undefined;
    const oldText = (a.oldText ?? a.old_str) as string | undefined;
    const newText = (a.newText ?? a.new_str ?? a.new_content) as string | undefined;
    if (typeof filePath === 'string') entries.push({ label: 'File', value: filePath });
    if (typeof oldText === 'string')
      entries.push({ label: 'Old text', value: oldText, isCode: true });
    if (typeof newText === 'string')
      entries.push({ label: 'New text', value: newText, isCode: true });
    return entries;
  }

  if (t === 'write' || t.includes('create')) {
    const filePath = (a.path ?? a.file_path ?? a.filename ?? a.file) as string | undefined;
    const content = (a.content ?? a.new_content) as string | undefined;
    if (typeof filePath === 'string') entries.push({ label: 'File', value: filePath });
    if (typeof content === 'string')
      entries.push({ label: 'Content', value: content, isCode: true });
    return entries;
  }

  if (t === 'read' || t.includes('view')) {
    const filePath = (a.path ?? a.file_path ?? a.filename) as string | undefined;
    if (typeof filePath === 'string') entries.push({ label: 'File', value: filePath });
    if (typeof a.offset === 'number') entries.push({ label: 'Offset', value: String(a.offset) });
    if (typeof a.limit === 'number') entries.push({ label: 'Limit', value: `${a.limit} lines` });
    return entries;
  }

  if (t === 'grep' || t.includes('search')) {
    if (typeof a.pattern === 'string')
      entries.push({ label: 'Pattern', value: a.pattern as string });
    if (typeof a.path === 'string') entries.push({ label: 'Path', value: a.path as string });
    if (typeof a.glob === 'string') entries.push({ label: 'Glob', value: a.glob as string });
    if (a.ignoreCase) entries.push({ label: 'Case', value: 'insensitive' });
    if (a.literal) entries.push({ label: 'Mode', value: 'literal' });
    if (typeof a.context === 'number')
      entries.push({ label: 'Context', value: `${a.context} lines` });
    if (typeof a.limit === 'number') entries.push({ label: 'Limit', value: String(a.limit) });
    return entries;
  }

  if (t === 'find' || t === 'ls' || t.includes('glob')) {
    if (typeof a.pattern === 'string')
      entries.push({ label: 'Pattern', value: a.pattern as string });
    if (typeof a.path === 'string') entries.push({ label: 'Path', value: a.path as string });
    if (typeof a.limit === 'number') entries.push({ label: 'Limit', value: String(a.limit) });
    return entries;
  }

  // Generic: show all string/number args
  for (const [k, v] of Object.entries(a)) {
    if (typeof v === 'string') entries.push({ label: k, value: v, isCode: v.includes('\n') });
    else if (typeof v === 'number' || typeof v === 'boolean')
      entries.push({ label: k, value: String(v) });
  }
  return entries;
}

/** Count lines in result content */
function countResultLines(content: string): number {
  return content.split('\n').length;
}

const ToolCallBlock: React.FC<ToolCallBlockProps> = ({ toolName, args, result, className }) => {
  const [expanded, setExpanded] = useState(false);
  const [outputShowAll, setOutputShowAll] = useState(false);

  const display = useMemo(() => getToolDisplay(toolName, args), [toolName, args]);
  const { icon: Icon, label, badges } = display;

  const hasOutput = !!result?.content;
  const hasExpandableContent =
    hasOutput || (args != null && Object.keys(args as object).length > 0);

  // For read tool, show line count from result
  const readLineCount = useMemo(() => {
    if (label === 'Read' && hasOutput && result?.content) {
      return countResultLines(result.content);
    }
    return null;
  }, [label, hasOutput, result?.content]);

  // Expanded detail: structured args
  const expandedArgs = useMemo(() => getExpandedArgs(toolName, args), [toolName, args]);

  // Truncated output for expanded view
  const { text: truncatedOutput, truncated: outputTruncated } =
    hasOutput && !outputShowAll
      ? truncateLines(result!.content, OUTPUT_LINE_LIMIT)
      : { text: result?.content ?? '', truncated: false };

  return (
    <div className={cn('my-1.5', className)}>
      {/* Clickable header row */}
      <button
        onClick={() => hasExpandableContent && setExpanded((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left',
          hasExpandableContent ? 'cursor-pointer hover:bg-muted/50' : 'cursor-default'
        )}
      >
        {hasExpandableContent ? (
          expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/50" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
          )
        ) : null}
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
        <span className="text-sm font-medium text-foreground/90">{label}</span>
        {readLineCount !== null && (
          <span className="text-sm text-muted-foreground/70">
            {readLineCount} line{readLineCount !== 1 ? 's' : ''}
          </span>
        )}
        {badges.map((badge, i) => {
          if (badge.variant === 'added') {
            return (
              <span key={i} className="text-xs font-medium text-green-500">
                {badge.text}
              </span>
            );
          }
          if (badge.variant === 'removed') {
            return (
              <span key={i} className="text-xs font-medium text-red-400">
                {badge.text}
              </span>
            );
          }
          return (
            <code
              key={i}
              className="max-w-[40ch] truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
              title={badge.text}
            >
              {badge.text}
            </code>
          );
        })}
        {result?.isError && (
          <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
            error
          </span>
        )}
      </button>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="ml-6 mt-1 space-y-2 border-l-2 border-muted/40 pl-3">
          {/* Arguments */}
          {expandedArgs.length > 0 && (
            <div className="space-y-1.5">
              {expandedArgs.map((entry, i) => (
                <div key={i}>
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/50">
                    {entry.label}
                  </span>
                  {entry.isCode ? (
                    <pre className="mt-0.5 whitespace-pre-wrap break-all rounded bg-muted/40 px-2 py-1 font-mono text-[11px] leading-relaxed text-foreground/80">
                      {entry.value}
                    </pre>
                  ) : (
                    <p className="font-mono text-xs text-foreground/80">{entry.value}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Result / output */}
          {hasOutput && (
            <div>
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/50">
                Output
              </span>
              <pre
                className={cn(
                  'mt-0.5 whitespace-pre-wrap break-all rounded bg-muted/40 px-2 py-1 font-mono text-[11px] leading-relaxed',
                  result?.isError ? 'text-destructive/70' : 'text-foreground/70'
                )}
              >
                {truncatedOutput}
              </pre>
              {outputTruncated && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setOutputShowAll(true);
                  }}
                  className="mt-0.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground"
                >
                  … show all ({result!.content.split('\n').length} lines)
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
