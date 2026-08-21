import { useSyncExternalStore, type ReactElement } from 'react';
import { resolvedTheme, subscribeToTheme, toggleTheme } from '../lib/theme';

/**
 * The Light/Dark pill from the 2026-08-21 handoff prototypes (every
 * screen's header carries one). The label names the theme the click
 * switches TO, matching the prototypes; the aria-label spells it out.
 */
export function ThemeToggle(): ReactElement {
  const theme = useSyncExternalStore(subscribeToTheme, resolvedTheme, () => 'dark' as const);
  const target = theme === 'dark' ? 'Light' : 'Dark';
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${target.toLowerCase()} theme`}
      onClick={toggleTheme}
    >
      {target}
    </button>
  );
}
