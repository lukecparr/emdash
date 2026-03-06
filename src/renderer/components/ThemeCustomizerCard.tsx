import React, { useCallback, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { ACCENT_PRESETS, DEFAULT_ACCENT_ID, hexToHsl, hslToHex } from '@shared/themeColors';
import type { AccentColorSetting } from '@shared/themeColors';

const ThemeCustomizerCard: React.FC = () => {
  const { accentColor, setAccentColor } = useTheme();
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Track the custom hex for the color input
  const [customHex, setCustomHex] = useState<string>(() => {
    if (accentColor.id === 'custom' && accentColor.customHsl) {
      return hslToHex(accentColor.customHsl) ?? '#3b82f6';
    }
    return '#3b82f6';
  });

  const handlePresetClick = useCallback(
    (presetId: string) => {
      if (accentColor.id !== presetId) {
        void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
          captureTelemetry('accent_color_changed', { accent: presetId });
        });
      }
      setAccentColor({ id: presetId });
    },
    [accentColor.id, setAccentColor]
  );

  const handleCustomColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const hex = e.target.value;
      setCustomHex(hex);
      const hsl = hexToHsl(hex);
      if (hsl) {
        const accent: AccentColorSetting = { id: 'custom', customHsl: hsl };
        setAccentColor(accent);
      }
    },
    [setAccentColor]
  );

  const handleCustomSwatchClick = useCallback(() => {
    // If already on custom, open the picker. Otherwise, apply the last custom color first.
    if (accentColor.id !== 'custom') {
      const hsl = hexToHsl(customHex);
      if (hsl) {
        setAccentColor({ id: 'custom', customHsl: hsl });
      }
    }
    colorInputRef.current?.click();
  }, [accentColor.id, customHex, setAccentColor]);

  return (
    <div className="grid gap-3">
      <div>
        <div className="text-sm font-medium text-foreground">Accent color</div>
        <div className="text-sm text-muted-foreground">
          Choose the primary accent color used for buttons, links, and active elements.
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {ACCENT_PRESETS.map((preset) => {
          const isSelected = accentColor.id === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => handlePresetClick(preset.id)}
              className={`group relative flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                isSelected
                  ? 'scale-110 border-foreground'
                  : 'border-transparent hover:scale-105 hover:border-border'
              }`}
              style={{
                backgroundColor: preset.id === DEFAULT_ACCENT_ID ? undefined : preset.swatch,
              }}
              aria-pressed={isSelected}
              aria-label={`Set accent color to ${preset.label}`}
              title={preset.label}
            >
              {preset.id === DEFAULT_ACCENT_ID ? (
                /* "Default" swatch: a half-and-half circle */
                <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full">
                  <span className="h-full w-1/2 bg-foreground" />
                  <span className="h-full w-1/2 bg-muted" />
                </span>
              ) : null}
              {isSelected && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Check
                    className="h-4 w-4 drop-shadow-sm"
                    style={{
                      color: preset.id === DEFAULT_ACCENT_ID ? 'hsl(var(--background))' : '#fff',
                    }}
                    strokeWidth={3}
                  />
                </span>
              )}
            </button>
          );
        })}

        {/* Custom color swatch */}
        <button
          type="button"
          onClick={handleCustomSwatchClick}
          className={`group relative flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
            accentColor.id === 'custom'
              ? 'scale-110 border-foreground'
              : 'border-transparent hover:scale-105 hover:border-border'
          }`}
          style={{ backgroundColor: customHex }}
          aria-pressed={accentColor.id === 'custom'}
          aria-label="Set a custom accent color"
          title="Custom"
        >
          {/* Rainbow gradient ring to indicate "custom" */}
          <span
            className="pointer-events-none absolute -inset-[3px] rounded-full opacity-60"
            style={{
              background:
                'conic-gradient(#f43f5e, #f97316, #eab308, #22c55e, #3b82f6, #8b5cf6, #f43f5e)',
              mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))',
              WebkitMask:
                'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))',
            }}
          />
          {accentColor.id === 'custom' && (
            <span className="absolute inset-0 flex items-center justify-center">
              <Check className="h-4 w-4 text-white drop-shadow-sm" strokeWidth={3} />
            </span>
          )}
        </button>

        {/* Hidden native color input */}
        <input
          ref={colorInputRef}
          type="color"
          value={customHex}
          onChange={handleCustomColorChange}
          className="sr-only"
          aria-label="Pick a custom accent color"
          tabIndex={-1}
        />
      </div>
    </div>
  );
};

export default ThemeCustomizerCard;
