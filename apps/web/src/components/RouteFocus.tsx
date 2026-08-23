import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

interface BackgroundLocationState {
  readonly backgroundLocation?: unknown;
}

/**
 * Route-change focus and scroll management (audit minor: the SPA had
 * neither).
 *
 * On a client-side navigation nothing happens by default: focus stays on the
 * link that was just clicked — so a screen reader announces nothing and the
 * next Tab continues from mid-page — and the scroll position carries over,
 * so clicking a nav link from the bottom of a long page lands mid-way down
 * the next one. After each pathname change this moves focus to the page's
 * `<main>` (made programmatically focusable on the fly) and scrolls to the
 * top instantly — `scroll-behavior: smooth` is for in-page jumps, not for
 * arriving on a different page.
 *
 * Three deliberate exceptions:
 *
 * - The initial load: the browser's own focus and the skip link are correct
 *   and must not be preempted.
 * - Search-only changes (feed filters and tabs live in the query string):
 *   the page did not change, so focus must not move.
 * - The slide-over sheet, in both directions: a location whose state carries
 *   `backgroundLocation` is the sheet OPENING over the feed, and leaving one
 *   is the sheet CLOSING — `DetailSheet` traps focus on open and restores it
 *   to the card that opened it on close, and stealing either would break the
 *   dialog contract.
 */
export function RouteFocus(): null {
  const location = useLocation();
  const previous = useRef<{ pathname: string; hadBackground: boolean } | null>(null);

  useEffect(() => {
    const hasBackground =
      (location.state as BackgroundLocationState | null)?.backgroundLocation !== undefined;
    const prev = previous.current;
    previous.current = { pathname: location.pathname, hadBackground: hasBackground };

    if (prev === null) return; // initial load
    if (prev.pathname === location.pathname) return; // search/hash-only change
    if (hasBackground || prev.hadBackground) return; // sheet opening/closing

    const main = document.querySelector<HTMLElement>('main');
    if (main !== null) {
      if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
      main.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location]);

  return null;
}
