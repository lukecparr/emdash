import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ThinkingBlockProps {
  text: string;
  className?: string;
}

const ThinkingBlock: React.FC<ThinkingBlockProps> = ({ text, className }) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={cn('my-2', className)}>
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground"
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        <span>Thinking</span>
      </button>
      {!collapsed && (
        <div className="border-l-2 border-muted pl-3">
          <p className="whitespace-pre-wrap text-xs italic leading-relaxed text-muted-foreground/70">
            {text}
          </p>
        </div>
      )}
    </div>
  );
};

export default ThinkingBlock;
