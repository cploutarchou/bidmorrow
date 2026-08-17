/**
 * Theme plumbing for the Strata design system (M0.1). No visible UI yet —
 * this module exists so M1/M2 can wire a real toggle control without
 * re-deriving the persistence/effective-theme logic.
 *
 * Contract (per docs/redesign/mockups/direction-g-strata.html and
 * .claude/skills/website-redesign/requirements.md):
 *   - bare `:root` is the dark palette; `@media (prefers-color-scheme:
 *     light) :root:not([data-theme="dark"])` is the OS-driven light twin.
 *   - `data-theme="light"` / `data-theme="dark"` on <html> is an explicit
 *     user override that always wins over the OS preference.
 *   - Stamp NOTHING on load unless a stored choice exists — an unvisited
 *     browser must render purely from `prefers-color-scheme`, never from
 *     this module deciding a default.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'bidmorrow-theme';

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark';
}

/** The user's persisted explicit choice, if any (never a guessed default). */
export function getStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    // localStorage unavailable (private browsing, disabled storage, etc.) —
    // treat as "no stored preference" rather than throwing.
    return null;
  }
}

/** The OS/browser color-scheme preference, defaulting to dark (Strata is dark-first). */
export function getSystemTheme(): Theme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** The theme actually rendered right now: the `data-theme` override if set, else the OS preference. */
export function getEffectiveTheme(): Theme {
  if (typeof document === 'undefined') return getSystemTheme();
  const attr = document.documentElement.getAttribute('data-theme');
  return isTheme(attr) ? attr : getSystemTheme();
}

/**
 * Applies a previously stored explicit choice on startup. Does nothing if
 * no choice was ever persisted, so a first-time visitor's page renders
 * purely from `prefers-color-scheme` via CSS — no attribute is stamped,
 * no flash of an assumed default.
 */
export function applyStoredTheme(): void {
  const stored = getStoredTheme();
  if (stored !== null) {
    document.documentElement.setAttribute('data-theme', stored);
  }
}

/** Sets an explicit theme override and persists it for future visits. */
export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Persist best-effort; the DOM attribute still applies for this page view.
  }
}

/** Flips the currently effective theme and persists the result. Returns the new theme. */
export function toggleTheme(): Theme {
  const next: Theme = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}
