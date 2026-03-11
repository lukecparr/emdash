import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface SlashCommand {
  name: string;
  description?: string;
  source: 'builtin' | 'extension' | 'prompt' | 'skill';
  location?: 'user' | 'project' | 'path';
  path?: string;
}

interface SlashCommandAutocompleteProps {
  commands: SlashCommand[];
  inputText: string;
  cursorPosition: number;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onSelect: (command: SlashCommand) => void;
  visible: boolean;
}

/** Source label badge color */
function sourceBadge(source: SlashCommand['source']): { label: string; className: string } {
  switch (source) {
    case 'builtin':
      return { label: 'builtin', className: 'bg-muted text-muted-foreground' };
    case 'extension':
      return { label: 'ext', className: 'bg-blue-500/15 text-blue-500' };
    case 'prompt':
      return { label: 'prompt', className: 'bg-purple-500/15 text-purple-500' };
    case 'skill':
      return { label: 'skill', className: 'bg-green-500/15 text-green-500' };
  }
}

const SlashCommandAutocomplete: React.FC<SlashCommandAutocompleteProps> = ({
  commands,
  inputText,
  cursorPosition,
  textareaRef,
  onSelect,
  visible,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Extract the slash command query from the input
  const query = useMemo(() => {
    if (!visible) return '';
    // Look backwards from cursor to find the '/' that starts the command
    const textBeforeCursor = inputText.slice(0, cursorPosition);
    const match = textBeforeCursor.match(/(?:^|\s)\/([\w:.-]*)$/);
    return match ? match[1].toLowerCase() : '';
  }, [inputText, cursorPosition, visible]);

  // Filter and sort commands
  const filtered = useMemo(() => {
    if (!visible) return [];
    return commands
      .filter((cmd) => cmd.name.toLowerCase().includes(query))
      .sort((a, b) => {
        // Exact prefix match first
        const aPrefix = a.name.toLowerCase().startsWith(query) ? 0 : 1;
        const bPrefix = b.name.toLowerCase().startsWith(query) ? 0 : 1;
        if (aPrefix !== bPrefix) return aPrefix - bPrefix;
        // Then alphabetical
        return a.name.localeCompare(b.name);
      })
      .slice(0, 15); // Limit to 15 results
  }, [commands, query, visible]);

  // Reset selection when filtered results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length, query]);

  // Scroll selected item into view
  useEffect(() => {
    const item = itemRefs.current[selectedIndex];
    if (item) {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Keyboard handler – attached to the textarea via the parent
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible || filtered.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => (prev + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const cmd = filtered[selectedIndex];
        if (cmd) onSelect(cmd);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        // Dispatch a custom event to signal the parent to close the menu
        textareaRef.current?.dispatchEvent(new CustomEvent('slash-autocomplete-close'));
      }
    },
    [visible, filtered, selectedIndex, onSelect, textareaRef]
  );

  // Attach keyboard handler to the textarea element
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || !visible || filtered.length === 0) return;

    // Use capture phase so we intercept before React's onKeyDown
    el.addEventListener('keydown', handleKeyDown, true);
    return () => el.removeEventListener('keydown', handleKeyDown, true);
  }, [textareaRef, handleKeyDown, visible, filtered.length]);

  if (!visible || filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className={cn(
        'absolute bottom-full left-0 z-50 mb-1 max-h-64 w-full overflow-y-auto',
        'rounded-md border border-border bg-popover shadow-lg'
      )}
      role="listbox"
    >
      {filtered.map((cmd, index) => {
        const badge = sourceBadge(cmd.source);
        return (
          <button
            key={`${cmd.source}:${cmd.name}`}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            role="option"
            aria-selected={index === selectedIndex}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
              'transition-colors',
              index === selectedIndex
                ? 'bg-accent text-accent-foreground'
                : 'text-popover-foreground hover:bg-accent/50'
            )}
            onMouseEnter={() => setSelectedIndex(index)}
            onClick={(e) => {
              e.preventDefault();
              onSelect(cmd);
            }}
          >
            <span className="font-mono text-xs font-medium text-primary">/{cmd.name}</span>
            {cmd.description && (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {cmd.description}
              </span>
            )}
            <span
              className={cn(
                'flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                badge.className
              )}
            >
              {badge.label}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default SlashCommandAutocomplete;
