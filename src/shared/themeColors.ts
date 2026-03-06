/**
 * Shared theme color definitions.
 *
 * Two layers of customisation:
 * 1. **Palette presets** — override all CSS variables (background, foreground,
 *    card, border, muted, secondary, accent, primary, ring, etc.)
 * 2. **Accent presets** — override only primary / primary-foreground / ring
 *
 * Both are applied as inline `style` overrides on `<html>` so they win over
 * the defaults defined in index.css.
 */

// ---------------------------------------------------------------------------
// Common types
// ---------------------------------------------------------------------------

/** All CSS custom-property values for one theme mode, keyed by variable name (without `--`). */
export interface PaletteValues {
  background: string;
  foreground: string;
  card: string;
  'card-foreground': string;
  popover: string;
  'popover-foreground': string;
  primary: string;
  'primary-foreground': string;
  secondary: string;
  'secondary-foreground': string;
  muted: string;
  'muted-foreground': string;
  accent: string;
  'accent-foreground': string;
  destructive: string;
  'destructive-foreground': string;
  border: string;
  input: string;
  ring: string;
  selection: string;
  'selection-foreground': string;
}

/** All the CSS variable keys a palette can set. */
export const PALETTE_KEYS: (keyof PaletteValues)[] = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'selection',
  'selection-foreground',
];

// ---------------------------------------------------------------------------
// Palette presets (full-app colour scheme)
// ---------------------------------------------------------------------------

export type ThemeMode = 'light' | 'dark' | 'dark-black';

export interface PalettePreset {
  id: string;
  label: string;
  /** Which base CSS class mode this palette targets (drives `dark` / `dark-black` class). */
  mode: ThemeMode;
  /** Preview colors for the settings UI. */
  preview: { bg: string; fg: string; primary: string; border: string };
  /** Full set of CSS variable overrides. */
  values: PaletteValues;
}

/**
 * `default` means "don't override anything — use the built-in CSS from index.css".
 * Each theme mode (light / dark / dark-black) has its own default.
 */
export const DEFAULT_PALETTE_ID = 'default';

export const PALETTE_PRESETS: PalettePreset[] = [
  // ── Dark palettes ─────────────────────────────────────────────────────
  {
    id: 'midnight',
    label: 'Midnight',
    mode: 'dark',
    preview: { bg: '#0f172a', fg: '#e2e8f0', primary: '#38bdf8', border: '#1e293b' },
    values: {
      background: '222 47% 11%',
      foreground: '210 40% 93%',
      card: '222 47% 13%',
      'card-foreground': '210 40% 93%',
      popover: '222 47% 15%',
      'popover-foreground': '210 40% 93%',
      primary: '199 89% 60%',
      'primary-foreground': '222 47% 11%',
      secondary: '217 33% 18%',
      'secondary-foreground': '210 40% 93%',
      muted: '217 33% 18%',
      'muted-foreground': '215 20% 65%',
      accent: '217 33% 18%',
      'accent-foreground': '210 40% 93%',
      destructive: '0 63% 50%',
      'destructive-foreground': '0 0% 98%',
      border: '217 33% 17%',
      input: '217 33% 17%',
      ring: '199 89% 60%',
      selection: '199 89% 70%',
      'selection-foreground': '222 47% 11%',
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    mode: 'dark',
    preview: { bg: '#2e3440', fg: '#eceff4', primary: '#88c0d0', border: '#3b4252' },
    values: {
      background: '220 16% 22%',
      foreground: '218 27% 94%',
      card: '220 16% 24%',
      'card-foreground': '218 27% 94%',
      popover: '220 17% 27%',
      'popover-foreground': '218 27% 94%',
      primary: '193 43% 67%',
      'primary-foreground': '220 16% 14%',
      secondary: '222 16% 28%',
      'secondary-foreground': '218 27% 94%',
      muted: '222 16% 28%',
      'muted-foreground': '219 28% 72%',
      accent: '222 16% 28%',
      'accent-foreground': '218 27% 94%',
      destructive: '354 42% 56%',
      'destructive-foreground': '0 0% 98%',
      border: '220 17% 28%',
      input: '220 17% 28%',
      ring: '193 43% 67%',
      selection: '193 43% 75%',
      'selection-foreground': '220 16% 22%',
    },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    mode: 'dark',
    preview: { bg: '#282a36', fg: '#f8f8f2', primary: '#bd93f9', border: '#44475a' },
    values: {
      background: '231 15% 18%',
      foreground: '60 30% 96%',
      card: '231 15% 20%',
      'card-foreground': '60 30% 96%',
      popover: '232 14% 23%',
      'popover-foreground': '60 30% 96%',
      primary: '265 89% 78%',
      'primary-foreground': '231 15% 14%',
      secondary: '232 14% 31%',
      'secondary-foreground': '60 30% 96%',
      muted: '232 14% 31%',
      'muted-foreground': '225 14% 66%',
      accent: '232 14% 31%',
      'accent-foreground': '60 30% 96%',
      destructive: '0 100% 67%',
      'destructive-foreground': '0 0% 98%',
      border: '232 14% 31%',
      input: '232 14% 31%',
      ring: '265 89% 78%',
      selection: '265 89% 82%',
      'selection-foreground': '231 15% 18%',
    },
  },
  {
    id: 'github-dark',
    label: 'GitHub Dark',
    mode: 'dark',
    preview: { bg: '#0d1117', fg: '#e6edf3', primary: '#58a6ff', border: '#30363d' },
    values: {
      background: '215 28% 7%',
      foreground: '210 29% 92%',
      card: '215 28% 9%',
      'card-foreground': '210 29% 92%',
      popover: '215 25% 12%',
      'popover-foreground': '210 29% 92%',
      primary: '212 100% 67%',
      'primary-foreground': '0 0% 100%',
      secondary: '215 14% 20%',
      'secondary-foreground': '210 29% 92%',
      muted: '215 14% 20%',
      'muted-foreground': '215 11% 60%',
      accent: '215 14% 20%',
      'accent-foreground': '210 29% 92%',
      destructive: '0 74% 56%',
      'destructive-foreground': '0 0% 98%',
      border: '215 14% 20%',
      input: '215 14% 20%',
      ring: '212 100% 67%',
      selection: '212 100% 75%',
      'selection-foreground': '215 28% 7%',
    },
  },
  // ── Dark-black palettes ───────────────────────────────────────────────
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin',
    mode: 'dark-black',
    preview: { bg: '#1e1e2e', fg: '#cdd6f4', primary: '#cba6f7', border: '#313244' },
    values: {
      background: '240 21% 15%',
      foreground: '226 64% 88%',
      card: '240 21% 17%',
      'card-foreground': '226 64% 88%',
      popover: '240 21% 20%',
      'popover-foreground': '226 64% 88%',
      primary: '267 84% 81%',
      'primary-foreground': '240 21% 12%',
      secondary: '240 21% 23%',
      'secondary-foreground': '226 64% 88%',
      muted: '240 21% 23%',
      'muted-foreground': '228 24% 62%',
      accent: '240 21% 23%',
      'accent-foreground': '226 64% 88%',
      destructive: '343 81% 75%',
      'destructive-foreground': '0 0% 98%',
      border: '240 21% 23%',
      input: '240 21% 23%',
      ring: '267 84% 81%',
      selection: '267 84% 85%',
      'selection-foreground': '240 21% 15%',
    },
  },
  {
    id: 'rose-pine',
    label: 'Rosé Pine',
    mode: 'dark-black',
    preview: { bg: '#191724', fg: '#e0def4', primary: '#c4a7e7', border: '#26233a' },
    values: {
      background: '249 22% 12%',
      foreground: '245 50% 91%',
      card: '249 22% 14%',
      'card-foreground': '245 50% 91%',
      popover: '248 25% 18%',
      'popover-foreground': '245 50% 91%',
      primary: '267 57% 78%',
      'primary-foreground': '249 22% 12%',
      secondary: '249 22% 18%',
      'secondary-foreground': '245 50% 91%',
      muted: '249 22% 18%',
      'muted-foreground': '249 12% 56%',
      accent: '249 22% 18%',
      'accent-foreground': '245 50% 91%',
      destructive: '343 76% 68%',
      'destructive-foreground': '0 0% 98%',
      border: '248 25% 18%',
      input: '248 25% 18%',
      ring: '267 57% 78%',
      selection: '267 57% 82%',
      'selection-foreground': '249 22% 12%',
    },
  },
  // ── Light palettes ────────────────────────────────────────────────────
  {
    id: 'github-light',
    label: 'GitHub Light',
    mode: 'light',
    preview: { bg: '#ffffff', fg: '#1f2328', primary: '#0969da', border: '#d0d7de' },
    values: {
      background: '0 0% 100%',
      foreground: '216 14% 14%',
      card: '0 0% 100%',
      'card-foreground': '216 14% 14%',
      popover: '0 0% 100%',
      'popover-foreground': '216 14% 14%',
      primary: '212 92% 45%',
      'primary-foreground': '0 0% 100%',
      secondary: '210 18% 96%',
      'secondary-foreground': '216 14% 14%',
      muted: '210 18% 96%',
      'muted-foreground': '215 14% 44%',
      accent: '210 18% 96%',
      'accent-foreground': '216 14% 14%',
      destructive: '0 74% 42%',
      'destructive-foreground': '0 0% 98%',
      border: '210 18% 87%',
      input: '210 18% 87%',
      ring: '212 92% 45%',
      selection: '212 92% 55%',
      'selection-foreground': '0 0% 100%',
    },
  },
  {
    id: 'soft-light',
    label: 'Soft',
    mode: 'light',
    preview: { bg: '#faf8f5', fg: '#3c3836', primary: '#8f6d3d', border: '#e8e2d9' },
    values: {
      background: '36 33% 97%',
      foreground: '30 8% 22%',
      card: '36 33% 97%',
      'card-foreground': '30 8% 22%',
      popover: '36 33% 98%',
      'popover-foreground': '30 8% 22%',
      primary: '34 41% 40%',
      'primary-foreground': '36 33% 97%',
      secondary: '35 22% 93%',
      'secondary-foreground': '30 8% 22%',
      muted: '35 22% 93%',
      'muted-foreground': '30 8% 46%',
      accent: '35 22% 93%',
      'accent-foreground': '30 8% 22%',
      destructive: '0 72% 51%',
      'destructive-foreground': '0 0% 98%',
      border: '34 18% 88%',
      input: '34 18% 88%',
      ring: '34 41% 40%',
      selection: '34 41% 50%',
      'selection-foreground': '36 33% 97%',
    },
  },
];

// ---------------------------------------------------------------------------
// Accent presets (primary / primary-foreground / ring only)
// ---------------------------------------------------------------------------

export interface ThemeColorValues {
  primary: string;
  primaryForeground: string;
  ring: string;
}

export interface ThemeColorPreset {
  id: string;
  label: string;
  swatch: string;
  light: ThemeColorValues;
  dark: ThemeColorValues;
  darkBlack: ThemeColorValues;
}

export const DEFAULT_ACCENT_ID = 'default';

export const ACCENT_PRESETS: ThemeColorPreset[] = [
  {
    id: 'default',
    label: 'Default',
    swatch: '#737373',
    light: { primary: '0 0% 9%', primaryForeground: '0 0% 98%', ring: '0 0% 3.9%' },
    dark: { primary: '220 9% 96%', primaryForeground: '215 28% 17%', ring: '220 9% 70%' },
    darkBlack: { primary: '0 0% 95%', primaryForeground: '0 0% 0%', ring: '0 0% 60%' },
  },
  {
    id: 'blue',
    label: 'Blue',
    swatch: '#3b82f6',
    light: { primary: '221 83% 53%', primaryForeground: '0 0% 100%', ring: '221 83% 53%' },
    dark: { primary: '217 91% 60%', primaryForeground: '0 0% 100%', ring: '217 91% 60%' },
    darkBlack: { primary: '217 91% 60%', primaryForeground: '0 0% 100%', ring: '217 91% 55%' },
  },
  {
    id: 'violet',
    label: 'Violet',
    swatch: '#8b5cf6',
    light: { primary: '262 83% 58%', primaryForeground: '0 0% 100%', ring: '262 83% 58%' },
    dark: { primary: '263 70% 60%', primaryForeground: '0 0% 100%', ring: '263 70% 60%' },
    darkBlack: { primary: '263 70% 60%', primaryForeground: '0 0% 100%', ring: '263 70% 55%' },
  },
  {
    id: 'rose',
    label: 'Rose',
    swatch: '#f43f5e',
    light: { primary: '347 77% 50%', primaryForeground: '0 0% 100%', ring: '347 77% 50%' },
    dark: { primary: '349 89% 60%', primaryForeground: '0 0% 100%', ring: '349 89% 60%' },
    darkBlack: { primary: '349 89% 60%', primaryForeground: '0 0% 100%', ring: '349 89% 55%' },
  },
  {
    id: 'orange',
    label: 'Orange',
    swatch: '#f97316',
    light: { primary: '25 95% 53%', primaryForeground: '0 0% 100%', ring: '25 95% 53%' },
    dark: { primary: '21 90% 56%', primaryForeground: '0 0% 100%', ring: '21 90% 56%' },
    darkBlack: { primary: '21 90% 56%', primaryForeground: '0 0% 100%', ring: '21 90% 50%' },
  },
  {
    id: 'green',
    label: 'Green',
    swatch: '#22c55e',
    light: { primary: '142 71% 45%', primaryForeground: '0 0% 100%', ring: '142 71% 45%' },
    dark: { primary: '142 69% 50%', primaryForeground: '0 0% 100%', ring: '142 69% 50%' },
    darkBlack: { primary: '142 69% 50%', primaryForeground: '0 0% 100%', ring: '142 69% 45%' },
  },
  {
    id: 'teal',
    label: 'Teal',
    swatch: '#14b8a6',
    light: { primary: '173 80% 40%', primaryForeground: '0 0% 100%', ring: '173 80% 40%' },
    dark: { primary: '172 66% 50%', primaryForeground: '0 0% 100%', ring: '172 66% 50%' },
    darkBlack: { primary: '172 66% 50%', primaryForeground: '0 0% 100%', ring: '172 66% 45%' },
  },
  {
    id: 'amber',
    label: 'Amber',
    swatch: '#f59e0b',
    light: { primary: '38 92% 50%', primaryForeground: '0 0% 100%', ring: '38 92% 50%' },
    dark: { primary: '38 92% 55%', primaryForeground: '0 0% 9%', ring: '38 92% 55%' },
    darkBlack: { primary: '38 92% 55%', primaryForeground: '0 0% 9%', ring: '38 92% 50%' },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function parseHsl(hsl: string): { h: number; s: number; l: number } | null {
  const match = hsl.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!match) return null;
  return { h: parseFloat(match[1]), s: parseFloat(match[2]), l: parseFloat(match[3]) };
}

export function hexToHsl(hex: string): string | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;

  const r = parseInt(result[1], 16) / 255;
  const g = parseInt(result[2], 16) / 255;
  const b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function hslToHex(hsl: string): string | null {
  const parsed = parseHsl(hsl);
  if (!parsed) return null;

  const { h, s, l } = parsed;
  const sNorm = s / 100;
  const lNorm = l / 100;

  const a = sNorm * Math.min(lNorm, 1 - lNorm);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = lNorm - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };

  return `#${f(0)}${f(8)}${f(4)}`;
}

export function isValidAccentId(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  if (id === 'custom') return true;
  return ACCENT_PRESETS.some((p) => p.id === id);
}

export function isValidPaletteId(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  if (id === DEFAULT_PALETTE_ID) return true;
  return PALETTE_PRESETS.some((p) => p.id === id);
}

export function isValidHslString(hsl: unknown): boolean {
  if (typeof hsl !== 'string') return false;
  return parseHsl(hsl) !== null;
}

export function deriveColorsFromPrimary(
  primaryHsl: string,
  _mode: 'light' | 'dark' | 'dark-black'
): ThemeColorValues {
  const parsed = parseHsl(primaryHsl);
  if (!parsed) {
    const def = ACCENT_PRESETS[0];
    return _mode === 'light' ? def.light : _mode === 'dark' ? def.dark : def.darkBlack;
  }

  const { l } = parsed;
  const isLightColor = l > 60;
  const foreground = isLightColor ? '0 0% 9%' : '0 0% 100%';
  const ring = primaryHsl;

  return { primary: primaryHsl, primaryForeground: foreground, ring };
}

// ---------------------------------------------------------------------------
// Custom palette helpers
// ---------------------------------------------------------------------------

/**
 * User-friendly color roles exposed in the custom theme editor.
 * Each maps to one or more CSS variables so users don't have to edit all 21.
 */
export interface CustomPaletteEditorColor {
  key: string;
  label: string;
  /** CSS variables this role sets (first is primary, rest are derived). */
  cssVars: (keyof PaletteValues)[];
}

export const CUSTOM_PALETTE_EDITOR_COLORS: CustomPaletteEditorColor[] = [
  { key: 'background', label: 'Background', cssVars: ['background', 'card'] },
  {
    key: 'foreground',
    label: 'Text',
    cssVars: ['foreground', 'card-foreground', 'popover-foreground'],
  },
  { key: 'primary', label: 'Primary', cssVars: ['primary', 'ring', 'selection'] },
  {
    key: 'primary-foreground',
    label: 'Primary text',
    cssVars: ['primary-foreground', 'selection-foreground'],
  },
  { key: 'secondary', label: 'Surface', cssVars: ['secondary', 'muted', 'accent', 'popover'] },
  {
    key: 'secondary-foreground',
    label: 'Surface text',
    cssVars: ['secondary-foreground', 'accent-foreground'],
  },
  { key: 'muted-foreground', label: 'Muted text', cssVars: ['muted-foreground'] },
  { key: 'border', label: 'Border', cssVars: ['border', 'input'] },
  { key: 'destructive', label: 'Destructive', cssVars: ['destructive'] },
];

/**
 * Expand editor-level custom colors into full PaletteValues overrides.
 * `editorColors` is keyed by `CustomPaletteEditorColor.key` with HSL string values.
 */
export function expandCustomColors(editorColors: Record<string, string>): Partial<PaletteValues> {
  const result: Partial<PaletteValues> = {};
  for (const def of CUSTOM_PALETTE_EDITOR_COLORS) {
    const value = editorColors[def.key];
    if (!value || !parseHsl(value)) continue;
    for (const cssVar of def.cssVars) {
      (result as Record<string, string>)[cssVar] = value;
    }
  }
  return result;
}

/**
 * Validate a customPalette object from settings.
 * Returns a sanitized copy containing only valid HSL values keyed by editor color key.
 */
export function sanitizeCustomPalette(
  raw: Record<string, unknown> | undefined
): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const editorKeys = new Set(CUSTOM_PALETTE_EDITOR_COLORS.map((c) => c.key));
  const result: Record<string, string> = {};
  let hasValues = false;
  for (const [key, value] of Object.entries(raw)) {
    if (editorKeys.has(key) && typeof value === 'string' && parseHsl(value)) {
      result[key] = value;
      hasValues = true;
    }
  }
  return hasValues ? result : undefined;
}

/**
 * Get the effective starting colors for the custom editor given the current palette.
 * Returns editor-key → HSL string, using the first CSS var from each editor color def.
 */
export function getEditorColorsFromPalette(paletteId: string): Record<string, string> {
  const result: Record<string, string> = {};
  const preset = PALETTE_PRESETS.find((p) => p.id === paletteId);
  if (preset) {
    for (const def of CUSTOM_PALETTE_EDITOR_COLORS) {
      result[def.key] = preset.values[def.cssVars[0]];
    }
  }
  return result;
}

/**
 * Get the built-in CSS defaults for a given theme mode (from index.css values).
 */
export function getBuiltinEditorColors(mode: ThemeMode): Record<string, string> {
  const builtins: Record<ThemeMode, PaletteValues> = {
    light: {
      background: '0 0% 100%',
      foreground: '0 0% 3.9%',
      card: '0 0% 100%',
      'card-foreground': '0 0% 3.9%',
      popover: '0 0% 100%',
      'popover-foreground': '0 0% 3.9%',
      primary: '0 0% 9%',
      'primary-foreground': '0 0% 98%',
      secondary: '0 0% 96.1%',
      'secondary-foreground': '0 0% 9%',
      muted: '0 0% 96.1%',
      'muted-foreground': '0 0% 45.1%',
      accent: '0 0% 96.1%',
      'accent-foreground': '0 0% 9%',
      destructive: '0 84.2% 60.2%',
      'destructive-foreground': '0 0% 98%',
      border: '0 0% 89.8%',
      input: '0 0% 89.8%',
      ring: '0 0% 3.9%',
      selection: '217 91% 60%',
      'selection-foreground': '0 0% 12%',
    },
    dark: {
      background: '215 28% 17%',
      foreground: '220 9% 96%',
      card: '215 28% 17%',
      'card-foreground': '220 9% 96%',
      popover: '220 24% 21%',
      'popover-foreground': '220 9% 96%',
      primary: '220 9% 96%',
      'primary-foreground': '215 28% 17%',
      secondary: '217 23% 27%',
      'secondary-foreground': '220 9% 96%',
      muted: '217 23% 27%',
      'muted-foreground': '220 9% 70%',
      accent: '217 23% 27%',
      'accent-foreground': '220 9% 96%',
      destructive: '0 62.8% 50%',
      'destructive-foreground': '0 0% 98%',
      border: '217 17% 32%',
      input: '217 17% 32%',
      ring: '220 9% 70%',
      selection: '217 92% 80%',
      'selection-foreground': '0 0% 98%',
    },
    'dark-black': {
      background: '0 0% 0%',
      foreground: '0 0% 95%',
      card: '0 0% 4%',
      'card-foreground': '0 0% 95%',
      popover: '0 0% 8%',
      'popover-foreground': '0 0% 95%',
      primary: '0 0% 95%',
      'primary-foreground': '0 0% 0%',
      secondary: '0 0% 12%',
      'secondary-foreground': '0 0% 95%',
      muted: '0 0% 15%',
      'muted-foreground': '0 0% 65%',
      accent: '0 0% 15%',
      'accent-foreground': '0 0% 95%',
      destructive: '0 62.8% 50%',
      'destructive-foreground': '0 0% 98%',
      border: '0 0% 20%',
      input: '0 0% 20%',
      ring: '0 0% 60%',
      selection: '217 92% 70%',
      'selection-foreground': '0 0% 95%',
    },
  };
  const vals = builtins[mode];
  const result: Record<string, string> = {};
  for (const def of CUSTOM_PALETTE_EDITOR_COLORS) {
    result[def.key] = vals[def.cssVars[0]];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Settings-persisted shapes
// ---------------------------------------------------------------------------

export interface AccentColorSetting {
  id: string; // preset id or 'custom'
  customHsl?: string; // only set when id === 'custom'
}

/** Which palette preset is active (or 'default' for the built-in CSS). */
export type PaletteSetting = string;

/**
 * Custom palette overrides: editor-key → HSL string.
 * Only present keys are overridden; missing keys use the active palette/built-in defaults.
 */
export type CustomPaletteSetting = Record<string, string>;
