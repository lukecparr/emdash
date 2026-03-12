import React from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import type { LifecycleInfo } from '../lib/lifecycleStage';

const DOT_COLORS: Record<LifecycleInfo['dotColor'], string> = {
  gray: 'bg-muted-foreground/40',
  yellow: 'bg-yellow-500',
  blue: 'bg-blue-500',
  green: 'bg-emerald-500',
  purple: 'bg-purple-500',
  red: 'bg-red-500',
};

const PULSE_RING_COLORS: Record<string, string> = {
  yellow: 'bg-yellow-500/40',
  green: 'bg-emerald-500/40',
};

interface PrStatusDotProps {
  info: LifecycleInfo;
  className?: string;
}

export const PrStatusDot: React.FC<PrStatusDotProps> = ({ info, className = '' }) => {
  const { dotColor, pulse, label } = info;

  const dot = (
    <span className={`relative inline-flex h-2 w-2 flex-shrink-0 ${className}`}>
      {pulse && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${PULSE_RING_COLORS[dotColor] || 'bg-current opacity-30'}`}
        />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${DOT_COLORS[dotColor]}`} />
    </span>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{dot}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default PrStatusDot;
