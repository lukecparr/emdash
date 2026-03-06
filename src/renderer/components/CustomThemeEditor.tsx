import React, { useCallback, useMemo, useRef } from 'react';
import { RotateCcw } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import {
  CUSTOM_PALETTE_EDITOR_COLORS,
  DEFAULT_PALETTE_ID,
  getEditorColorsFromPalette,
  getBuiltinEditorColors,
  hslToHex,
  hexToHsl,
} from '@shared/themeColors';
import type { ThemeMode } from '@shared/themeColors';

const CustomThemeEditor: React.FC = () => {
  const { palette, effectiveTheme, customPalette, setCustomPalette } = useTheme();
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Compute baseline colors from the active palette preset (or built-in defaults)
  const baselineColors = useMemo((): Record<string, string> => {
    if (palette !== DEFAULT_PALETTE_ID) {
      return getEditorColorsFromPalette(palette);
    }
    return getBuiltinEditorColors(effectiveTheme as ThemeMode);
  }, [palette, effectiveTheme]);

  // Effective colors: custom overrides merged on top of baseline
  const effectiveColors = useMemo((): Record<string, string> => {
    return { ...baselineColors, ...customPalette };
  }, [baselineColors, customPalette]);

  const handleColorChange = useCallback(
    (key: string, hex: string) => {
      const hsl = hexToHsl(hex);
      if (!hsl) return;
      const next = { ...customPalette, [key]: hsl };
      setCustomPalette(next);
    },
    [customPalette, setCustomPalette]
  );

  const handleResetKey = useCallback(
    (key: string) => {
      if (!customPalette) return;
      const next = { ...customPalette };
      delete next[key];
      const hasKeys = Object.keys(next).length > 0;
      setCustomPalette(hasKeys ? next : undefined);
    },
    [customPalette, setCustomPalette]
  );

  const handleResetAll = useCallback(() => {
    setCustomPalette(undefined);
  }, [setCustomPalette]);

  const hasOverrides = customPalette && Object.keys(customPalette).length > 0;

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-foreground">Custom colors</div>
          <div className="text-sm text-muted-foreground">
            Fine-tune individual colors. Changes apply on top of the active theme.
          </div>
        </div>
        {hasOverrides && (
          <button
            type="button"
            onClick={handleResetAll}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Reset all custom colors"
          >
            <RotateCcw className="h-3 w-3" />
            Reset all
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {CUSTOM_PALETTE_EDITOR_COLORS.map((def) => {
          const hslValue = effectiveColors[def.key] ?? '0 0% 50%';
          const hexValue = hslToHex(hslValue) ?? '#808080';
          const isOverridden = customPalette?.[def.key] !== undefined;

          return (
            <div
              key={def.key}
              className="flex items-center gap-2.5 rounded-lg border border-border/50 px-3 py-2"
            >
              {/* Color swatch / picker trigger */}
              <button
                type="button"
                className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border/60 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                style={{ backgroundColor: hexValue }}
                onClick={() => inputRefs.current[def.key]?.click()}
                aria-label={`Pick color for ${def.label}`}
              >
                {/* Hidden color input positioned over the swatch */}
                <input
                  ref={(el) => {
                    inputRefs.current[def.key] = el;
                  }}
                  type="color"
                  value={hexValue}
                  onChange={(e) => handleColorChange(def.key, e.target.value)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  tabIndex={-1}
                  aria-label={`Color picker for ${def.label}`}
                />
              </button>

              {/* Label */}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-xs font-medium leading-tight text-foreground">
                  {def.label}
                </span>
                <span className="truncate font-mono text-[10px] leading-tight text-muted-foreground">
                  {hexValue}
                </span>
              </div>

              {/* Reset individual color */}
              {isOverridden && (
                <button
                  type="button"
                  onClick={() => handleResetKey(def.key)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={`Reset ${def.label} to default`}
                  title="Reset to default"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CustomThemeEditor;
