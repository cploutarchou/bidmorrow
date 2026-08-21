/**
 * Theme preference (Theme Spec v2, 2026-08-21 handoff): dark is the
 * default at bare `:root`; an explicit choice stamps
 * `data-theme="dark" | "light"` on <html> and persists in localStorage;
 * with no stored choice nothing is stamped and the stylesheet's
 * `prefers-color-scheme: light` mirror lets the OS decide.
 *
 * localStorage can throw (Safari private mode, storage-disabled
 * embeds) — every access is wrapped so the theme system degrades to
 * "system" rather than crashing the shell.
 */

export type ThemeChoice = 'dark' | 'light';
export type ThemePreference = ThemeChoice | 'system';

const STORAGE_KEY = 'bm-theme';

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function readStoredPreference(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === 'dark' || raw === 'light' ? raw : 'system';
  } catch {
    return 'system';
  }
}

function systemTheme(): ThemeChoice {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** The theme actually in effect right now. */
export function resolvedTheme(): ThemeChoice {
  const preference = readStoredPreference();
  return preference === 'system' ? systemTheme() : preference;
}

function stamp(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') {
    delete root.dataset['theme'];
  } else {
    root.dataset['theme'] = preference;
  }
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, preference);
    }
  } catch {
    // Storage unavailable — the stamp below still applies for this tab.
  }
  stamp(preference);
  notify();
}

/** Flip to the opposite of whatever is currently in effect. */
export function toggleTheme(): void {
  setThemePreference(resolvedTheme() === 'dark' ? 'light' : 'dark');
}

/**
 * Apply the stored preference on boot and keep same-tab subscribers in
 * sync with OS changes (relevant while the preference is "system") and
 * with other tabs (storage events). Called once from main.tsx before
 * the first render.
 */
export function initTheme(): void {
  stamp(readStoredPreference());
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', notify);
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    stamp(readStoredPreference());
    notify();
  });
}

/** useSyncExternalStore-compatible subscription for ThemeToggle. */
export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
