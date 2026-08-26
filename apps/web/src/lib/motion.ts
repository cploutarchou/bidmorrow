import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * Motion primitives (docs/redesign/brand-elevation-phase.md §2 "App").
 *
 * Every JS-driven animation in the app surface (count-up, route
 * cross-fade, pointer tilt) reads `prefers-reduced-motion` through here
 * rather than re-querying `matchMedia` ad hoc, so the "instant, never
 * merely slowed" rule is enforced in one place. Pure CSS animations don't
 * need this module at all — `styles/base.css`'s global
 * `@media (prefers-reduced-motion: reduce) { *, *::before, *::after {
 * animation: none !important; transition: none !important; } }`
 * kill-switch already disables them (the exception is the View
 * Transition API's own pseudo-element tree, which that `*` selector does
 * not reach — `RouteTransition` below guards it explicitly).
 */

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** No `window`/`matchMedia` in the Node-environment unit test project
 *  (root `vitest.config.ts` runs `apps/web/src/**\/*.test.ts` under
 *  `environment: 'node'`, not jsdom) and none server-side — every access
 *  is guarded so this module is safe to import anywhere. */
function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

/** Synchronous, one-shot read — SSR/non-browser-safe (`false`, i.e.
 *  motion allowed, when there is no `window`). */
export function prefersReducedMotion(): boolean {
  if (!hasMatchMedia()) return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function subscribe(onChange: () => void): () => void {
  if (!hasMatchMedia()) return () => undefined;
  const mql = window.matchMedia(REDUCED_MOTION_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/** Live `prefers-reduced-motion: reduce` value — updates if the user
 *  flips the OS setting while the tab is open. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}

/** Ease-out cubic: quick start, gentle settle — the standard "count up to
 *  a resting number" feel. Pure and exported for direct testing. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/** How many decimal digits `n`'s own value carries (4.5 -> 1, 100 -> 0) —
 *  lets `useCountUp` preserve the target's precision instead of assuming
 *  every counter is an integer. Falls back to 0 for non-finite input and
 *  for scientific notation, which a UI counter should never produce. */
export function decimalPrecision(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const str = n.toString();
  if (str.includes('e') || str.includes('E')) return 0;
  const dot = str.indexOf('.');
  return dot === -1 ? 0 : str.length - dot - 1;
}

/** Rounds `value` to `decimals` digits (avoids the long tail of floating
 *  point drift a naive `.toFixed`-free round would show mid-animation). */
export function roundToPrecision(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export interface UseCountUpOptions {
  /** @default 900 */
  durationMs?: number;
}

const DEFAULT_COUNT_UP_DURATION_MS = 900;

/**
 * Counts up from 0 to `target` over `durationMs`, easing out.
 *
 * - Under `prefers-reduced-motion`, and on the very first paint for a
 *   reduced-motion user, this returns `target` directly — never a flash
 *   of `0` before the "instant" value lands.
 * - Re-triggers (from 0 again) whenever `target` changes, matching a
 *   freshly-landed number rather than interpolating from the old one.
 * - Preserves `target`'s own decimal precision.
 */
export function useCountUp(target: number, options: UseCountUpOptions = {}): number {
  const { durationMs = DEFAULT_COUNT_UP_DURATION_MS } = options;
  const reducedMotion = usePrefersReducedMotion();
  const [display, setDisplay] = useState<number>(() => (reducedMotion ? target : 0));
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (reducedMotion || !Number.isFinite(target) || durationMs <= 0) {
      setDisplay(target);
      return;
    }
    const decimals = decimalPrecision(target);
    const start =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    setDisplay(0);

    function tick(now: number): void {
      const progress = Math.min(1, (now - start) / durationMs);
      setDisplay(roundToPrecision(target * easeOutCubic(progress), decimals));
      if (progress < 1) {
        frameRef.current = window.requestAnimationFrame(tick);
      }
    }
    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [target, durationMs, reducedMotion]);

  return display;
}

/**
 * `true` while `query` matches; `false` on the server and before the first
 * effect. Used to add behaviour that only makes sense in one layout mode
 * (e.g. a Tab stop on a strip that only scrolls below 40rem).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (): void => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
