import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    const tenths = Math.floor((ms % 1000) / 100);
    return `${totalSeconds}.${tenths}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m, ${seconds.toString().padStart(2, '0')}s`;
}

/** Three dots that animate in sequence to indicate activity. */
const AnimatedDots: React.FC<{ className?: string }> = ({ className }) => (
  <span className={cn('inline-flex items-center gap-[2px]', className)} aria-hidden>
    <span className="h-[3px] w-[3px] animate-[dotBounce_1.2s_ease-in-out_infinite_0ms] rounded-full bg-current" />
    <span className="h-[3px] w-[3px] animate-[dotBounce_1.2s_ease-in-out_infinite_200ms] rounded-full bg-current" />
    <span className="h-[3px] w-[3px] animate-[dotBounce_1.2s_ease-in-out_infinite_400ms] rounded-full bg-current" />
  </span>
);

interface ResponseFooterProps {
  isRunning: boolean;
  /** Timestamp (ms since epoch) when the current turn started, or null */
  startedAt: number | null;
  /** Duration in ms of the last completed turn, or null if none completed yet */
  lastDuration: number | null;
  /** The full text content of the last assistant message for copying */
  lastAssistantText: string | null;
  className?: string;
}

const ResponseFooter: React.FC<ResponseFooterProps> = ({
  isRunning,
  startedAt,
  lastDuration,
  lastAssistantText,
  className,
}) => {
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);

  // Live tick while running
  useEffect(() => {
    if (!isRunning || startedAt == null) {
      setElapsed(0);
      return;
    }
    // Sync immediately
    setElapsed(Date.now() - startedAt);
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 100);
    return () => clearInterval(interval);
  }, [isRunning, startedAt]);

  const handleCopy = useCallback(async () => {
    if (!lastAssistantText) return;
    try {
      await navigator.clipboard.writeText(lastAssistantText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      try {
        await window.electronAPI.clipboardWriteText(lastAssistantText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {}
    }
  }, [lastAssistantText]);

  // While running: animated dots + live elapsed counter
  if (isRunning && startedAt != null) {
    return (
      <div
        className={cn('flex items-center gap-1.5 py-2 text-xs text-muted-foreground', className)}
      >
        <AnimatedDots className="text-muted-foreground" />
        <span className="tabular-nums">{formatDuration(elapsed)}</span>
      </div>
    );
  }

  // Completed: show duration + copy button
  if (lastDuration != null && lastAssistantText) {
    return (
      <div
        className={cn('flex items-center gap-1.5 py-2 text-xs text-muted-foreground', className)}
      >
        <span className="tabular-nums">{formatDuration(lastDuration)}</span>
        <span className="text-border">·</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          title={copied ? 'Copied!' : 'Copy response'}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    );
  }

  return null;
};

export default ResponseFooter;
