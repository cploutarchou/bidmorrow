import { useEffect, useState, type ReactElement } from 'react';
import { getEffectiveTheme, toggleTheme, type Theme } from '../lib/theme';

/**
 * Explicit theme override control for the marketing shell (Direction G
 * "Strata" mockup's `.theme-toggle`). Reuses `lib/theme.ts` for all
 * persistence/effective-theme logic — this component only renders the
 * control and keeps its label in sync with whichever theme is effective
 * (an explicit `data-theme` override, or the OS `prefers-color-scheme`
 * when no override has ever been set).
 */
export function ThemeToggle(): ReactElement {
  const [theme, setTheme] = useState<Theme>(() => getEffectiveTheme());

  useEffect(() => {
    // No override has necessarily been made yet — stay in sync with the OS
    // preference so the label never lies about what's actually rendered.
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const sync = (): void => setTheme(getEffectiveTheme());
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return (
    <button
      type="button"
      className="mkt-theme-toggle"
      onClick={() => setTheme(toggleTheme())}
      aria-pressed={theme === 'light'}
      aria-label="Switch between dark and light theme"
    >
      <svg
        className="mkt-theme-toggle__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19" />
      </svg>
      <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
    </button>
  );
}
