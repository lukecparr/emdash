import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ThinkingBlockProps {
  text: string;
  className?: string;
}

const ThinkingBlock: React.FC<ThinkingBlockProps> = ({ text, className }) => {
  const [collapsed, setCollapsed] = useState(true);

  /** First meaningful line as inline preview */
  const preview = useMemo(() => {
    const firstLine = text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    if (!firstLine) return '';
    return firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine;
  }, [text]);

  return (
    <div className={cn('my-1.5', className)}>
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-2 py-0.5 text-muted-foreground/70 hover:text-muted-foreground"
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        <span className="text-sm font-medium">Thinking</span>
        {collapsed && preview && (
          <code className="max-w-[50ch] truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground/60">
            {preview}
          </code>
        )}
      </button>
      {!collapsed && (
        <div className="ml-5 mt-1 border-l-2 border-muted pl-3">
          <p className="whitespace-pre-wrap text-xs italic leading-relaxed text-muted-foreground/70">
            {text}
          </p>
        </div>
      )}
    </div>
  );
};

export default ThinkingBlock;
