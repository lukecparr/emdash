import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AccentColorSetting } from '@shared/themeColors';
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT_ID,
  DEFAULT_PALETTE_ID,
  PALETTE_PRESETS,
  PALETTE_KEYS,
  deriveColorsFromPrimary,
  expandCustomColors,
  type ThemeColorValues,
  type PaletteValues,
} from '@shared/themeColors';

type Theme = 'light' | 'dark' | 'dark-black' | 'system';
type EffectiveTheme = 'light' | 'dark' | 'dark-black';

const STORAGE_KEY = 'emdash-theme';

function getSystemTheme(): EffectiveTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark-black' : 'light';
}

function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'dark-black' || stored === 'system') {
      return stored;
    }
  } catch {}
  return 'system';
}

function applyThemeClass(theme: Theme, paletteId: string) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  let effectiveTheme = theme === 'system' ? getSystemTheme() : theme;

  // When a palette preset is active, its `mode` dictates the CSS class
  if (paletteId !== DEFAULT_PALETTE_ID) {
    const preset = PALETTE_PRESETS.find((p) => p.id === paletteId);
    if (preset) {
      effectiveTheme = preset.mode;
    }
  }

  root.classList.remove('dark', 'dark-black');

  if (effectiveTheme === 'dark') {
    root.classList.add('dark');
  } else if (effectiveTheme === 'dark-black') {
    root.classList.add('dark', 'dark-black');
  }
}

/** Resolve the effective theme taking palette into account. */
function resolveEffectiveTheme(
  theme: Theme,
  systemTheme: EffectiveTheme,
  paletteId: string
): EffectiveTheme {
  if (paletteId !== DEFAULT_PALETTE_ID) {
    const preset = PALETTE_PRESETS.find((p) => p.id === paletteId);
    if (preset) return preset.mode;
  }
  return theme === 'system' ? systemTheme : (theme as EffectiveTheme);
}

/**
 * Apply palette CSS variable overrides on the root element.
 * Custom palette overrides are layered on top of preset values.
 */
function applyPalette(paletteId: string, customPalette: Record<string, string> | undefined) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  // Expand custom palette editor colors into full CSS variable map
  const customExpanded: Partial<PaletteValues> = customPalette
    ? expandCustomColors(customPalette)
    : {};
  const hasCustom = Object.keys(customExpanded).length > 0;

  if (paletteId === DEFAULT_PALETTE_ID && !hasCustom) {
    // Remove all palette overrides
    for (const key of PALETTE_KEYS) {
      root.style.removeProperty(`--${key}`);
    }
    return;
  }

  const preset = PALETTE_PRESETS.find((p) => p.id === paletteId);

  for (const key of PALETTE_KEYS) {
    // Custom overrides take priority, then preset values, then remove (let CSS default)
    const customVal = customExpanded[key];
    if (customVal) {
      root.style.setProperty(`--${key}`, customVal);
    } else if (preset) {
      root.style.setProperty(`--${key}`, preset.values[key]);
    } else if (hasCustom) {
      // Has custom but no preset — only set overridden keys, remove the rest
      root.style.removeProperty(`--${key}`);
    } else {
      root.style.removeProperty(`--${key}`);
    }
  }
}

/** Apply accent colour CSS variable overrides on the root element. */
function applyAccentColor(accent: AccentColorSetting, effectiveTheme: EffectiveTheme) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;

  if (accent.id === DEFAULT_ACCENT_ID) {
    // Remove accent overrides — let palette / CSS defaults take over
    root.style.removeProperty('--primary');
    root.style.removeProperty('--primary-foreground');
    root.style.removeProperty('--ring');
    return;
  }

  let values: ThemeColorValues | undefined;

  if (accent.id === 'custom' && accent.customHsl) {
    values = deriveColorsFromPrimary(accent.customHsl, effectiveTheme);
  } else {
    const preset = ACCENT_PRESETS.find((p) => p.id === accent.id);
    if (preset) {
      values =
        effectiveTheme === 'light'
          ? preset.light
          : effectiveTheme === 'dark'
            ? preset.dark
            : preset.darkBlack;
    }
  }

  if (values) {
    root.style.setProperty('--primary', values.primary);
    root.style.setProperty('--primary-foreground', values.primaryForeground);
    root.style.setProperty('--ring', values.ring);
  }
}

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  effectiveTheme: EffectiveTheme;
  accentColor: AccentColorSetting;
  setAccentColor: (accent: AccentColorSetting) => void;
  palette: string;
  setPalette: (paletteId: string) => void;
  customPalette: Record<string, string> | undefined;
  setCustomPalette: (colors: Record<string, string> | undefined) => void;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());
  const [systemTheme, setSystemTheme] = useState<EffectiveTheme>(() => getSystemTheme());
  const [accentColor, setAccentColorState] = useState<AccentColorSetting>({
    id: DEFAULT_ACCENT_ID,
  });
  const [palette, setPaletteState] = useState<string>(DEFAULT_PALETTE_ID);
  const [customPalette, setCustomPaletteState] = useState<Record<string, string> | undefined>(
    undefined
  );

  const effectiveTheme: EffectiveTheme = resolveEffectiveTheme(theme, systemTheme, palette);

  // Apply CSS classes + palette + custom + accent whenever any relevant state changes
  useEffect(() => {
    applyThemeClass(theme, palette);
    applyPalette(palette, customPalette);
    // Accent must be applied *after* palette so it can override primary/ring
    applyAccentColor(accentColor, effectiveTheme);
  }, [theme, systemTheme, palette, customPalette, accentColor, effectiveTheme]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore localStorage errors
    }
  }, [theme]);

  // Load theme from backend settings on mount and handle migration
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const result = await window.electronAPI.getSettings();
        if (!result.success) return;

        const backendTheme = result.settings?.interface?.theme;
        const backendAccent = result.settings?.interface?.accentColor;
        const backendPalette = result.settings?.interface?.palette;
        const backendCustomPalette = result.settings?.interface?.customPalette;

        if (backendTheme !== undefined) {
          setThemeState(backendTheme);
        } else {
          const localTheme = getStoredTheme();
          if (localTheme !== 'system') {
            await window.electronAPI.updateSettings({
              interface: { theme: localTheme },
            });
          }
          setThemeState(localTheme);
        }

        if (backendAccent && backendAccent.id) {
          setAccentColorState(backendAccent);
        }
        if (backendPalette && typeof backendPalette === 'string') {
          setPaletteState(backendPalette);
        }
        if (backendCustomPalette && typeof backendCustomPalette === 'object') {
          setCustomPaletteState(backendCustomPalette as Record<string, string>);
        }
      } catch (error) {
        console.error('Failed to load theme settings:', error);
      }
    };

    loadSettings();
  }, []);

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== 'system') return undefined;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      setSystemTheme(getSystemTheme());
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }

    mediaQuery.addListener(handler);
    return () => mediaQuery.removeListener(handler);
  }, [theme]);

  const updateTheme = async (newTheme: Theme) => {
    setThemeState(newTheme);
    try {
      await window.electronAPI.updateSettings({
        interface: { theme: newTheme },
      });
    } catch (error) {
      console.error('Failed to save theme setting:', error);
    }
  };

  const setAccentColor = useCallback(
    async (accent: AccentColorSetting) => {
      setAccentColorState(accent);
      try {
        await window.electronAPI.updateSettings({
          interface: { accentColor: accent },
        });
      } catch (error) {
        console.error('Failed to save accent color setting:', error);
      }
    },
    [setAccentColorState]
  );

  const setPalette = useCallback(
    async (paletteId: string) => {
      setPaletteState(paletteId);
      // Clear custom palette when switching to a different preset
      setCustomPaletteState(undefined);
      try {
        await window.electronAPI.updateSettings({
          interface: { palette: paletteId, customPalette: undefined },
        });
      } catch (error) {
        console.error('Failed to save palette setting:', error);
      }
    },
    [setPaletteState, setCustomPaletteState]
  );

  const setCustomPalette = useCallback(
    async (colors: Record<string, string> | undefined) => {
      setCustomPaletteState(colors);
      try {
        await window.electronAPI.updateSettings({
          interface: { customPalette: colors },
        });
      } catch (error) {
        console.error('Failed to save custom palette setting:', error);
      }
    },
    [setCustomPaletteState]
  );

  const toggleTheme = () => {
    let newTheme: Theme = 'light';

    if (theme === 'light') newTheme = 'dark';
    else if (theme === 'dark') newTheme = 'dark-black';
    else if (theme === 'dark-black') newTheme = 'light';
    else if (theme === 'system') {
      if (effectiveTheme === 'light') newTheme = 'dark';
      else if (effectiveTheme === 'dark') newTheme = 'dark-black';
      else newTheme = 'light';
    }

    updateTheme(newTheme);
  };

  const setTheme = (newTheme: Theme) => {
    updateTheme(newTheme);
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        toggleTheme,
        effectiveTheme,
        accentColor,
        setAccentColor,
        palette,
        setPalette,
        customPalette,
        setCustomPalette,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
