import React from 'react';
import { useTheme } from '../hooks/useTheme';
import { Sun, Moon, Monitor, Circle, Check } from 'lucide-react';
import { PALETTE_PRESETS, DEFAULT_PALETTE_ID } from '@shared/themeColors';

const ThemeCard: React.FC = () => {
  const { theme, setTheme, palette, setPalette } = useTheme();

  const modeOptions = [
    { value: 'light' as const, label: 'Light', icon: Sun },
    { value: 'dark' as const, label: 'Dark Navy', icon: Moon },
    { value: 'dark-black' as const, label: 'Dark Black', icon: Circle },
    { value: 'system' as const, label: 'System', icon: Monitor },
  ];

  // Group palette presets by mode for display
  const darkPresets = PALETTE_PRESETS.filter((p) => p.mode === 'dark');
  const darkBlackPresets = PALETTE_PRESETS.filter((p) => p.mode === 'dark-black');
  const lightPresets = PALETTE_PRESETS.filter((p) => p.mode === 'light');

  const handleModeClick = (value: typeof theme) => {
    if (theme !== value) {
      void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('theme_changed', { theme: value });
      });
    }
    // When user explicitly picks a base mode, reset palette to default
    if (palette !== DEFAULT_PALETTE_ID) {
      setPalette(DEFAULT_PALETTE_ID);
    }
    setTheme(value);
  };

  const handlePaletteClick = (presetId: string) => {
    if (palette !== presetId) {
      void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('palette_changed', { palette: presetId });
      });
    }
    setPalette(presetId);
  };

  return (
    <div className="grid gap-5">
      {/* Base color mode */}
      <div className="grid gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">Color mode</div>
          <div className="text-sm text-muted-foreground">Choose how Emdash looks.</div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2">
          {modeOptions.map(({ value, label, icon: Icon }) => {
            const isSelected = theme === value && palette === DEFAULT_PALETTE_ID;
            return (
              <button
                key={value}
                type="button"
                onClick={() => handleModeClick(value)}
                className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border px-2 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-3 ${
                  isSelected
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border/60 bg-background text-muted-foreground hover:border-border hover:bg-muted/40'
                }`}
                aria-pressed={isSelected}
                aria-label={`Set theme to ${label}`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="text-center leading-tight">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Palette presets */}
      <div className="grid gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">Theme presets</div>
          <div className="text-sm text-muted-foreground">
            Ready-made color palettes that restyle the entire app.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {[...darkPresets, ...darkBlackPresets, ...lightPresets].map((preset) => {
            const isSelected = palette === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handlePaletteClick(preset.id)}
                className={`group relative flex h-16 w-28 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-lg border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  isSelected
                    ? 'border-primary ring-1 ring-primary/30'
                    : 'border-border/50 hover:border-border'
                }`}
                style={{ backgroundColor: preset.preview.bg }}
                aria-pressed={isSelected}
                aria-label={`Set palette to ${preset.label}`}
              >
                {/* Color bar preview */}
                <div className="flex items-center gap-1">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: preset.preview.primary }}
                  />
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: preset.preview.border }}
                  />
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: preset.preview.fg, opacity: 0.5 }}
                  />
                </div>
                <span
                  className="text-[11px] font-medium leading-none"
                  style={{ color: preset.preview.fg }}
                >
                  {preset.label}
                </span>

                {/* Selected check */}
                {isSelected && (
                  <span
                    className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full"
                    style={{ backgroundColor: preset.preview.primary }}
                  >
                    <Check
                      className="h-2.5 w-2.5"
                      style={{ color: preset.preview.bg }}
                      strokeWidth={3}
                    />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ThemeCard;
