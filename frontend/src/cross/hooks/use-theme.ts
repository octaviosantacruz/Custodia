import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'custodia-theme:v1';
const LEGACY_THEME_STORAGE_KEY = 'openpam-theme';

function readTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const current = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (current === 'light' || current === 'dark') return current;
    const legacy = window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (legacy === 'light' || legacy === 'dark') {
      window.localStorage.setItem(THEME_STORAGE_KEY, legacy);
      window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
      return legacy;
    }
  } catch {
    // Fall back to the default theme when browser storage is unavailable.
  }
  return 'dark';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // The theme still applies for the current session.
    }
  }, [theme]);

  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark');
  return { theme, toggleTheme };
}
