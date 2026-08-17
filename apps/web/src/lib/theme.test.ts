import { describe, expect, it } from 'vitest';
import { applyStoredTheme, getEffectiveTheme, getStoredTheme, getSystemTheme } from './theme';

// This suite runs under the root Vitest project's `node` environment (no
// DOM globals — see vitest.config.ts), which exercises exactly the
// non-browser guard branches every exported function needs (e.g. any
// future SSR/build-time import must not throw). DOM-driven behavior
// (localStorage persistence, `data-theme` attribute writes, toggling) is
// exercised once a jsdom-backed suite exists for apps/web; until then this
// suite is the safety net that a bare `import './theme'` never crashes.
describe('theme (no-DOM environment)', () => {
  it('getStoredTheme returns null without throwing when window is unavailable', () => {
    expect(getStoredTheme()).toBeNull();
  });

  it('getSystemTheme defaults to dark (Strata is dark-first) when window is unavailable', () => {
    expect(getSystemTheme()).toBe('dark');
  });

  it('getEffectiveTheme falls back to the system default when document is unavailable', () => {
    expect(getEffectiveTheme()).toBe('dark');
  });

  it('applyStoredTheme is a no-op (never throws) without a document', () => {
    expect(() => applyStoredTheme()).not.toThrow();
  });
});
