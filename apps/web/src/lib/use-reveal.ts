import { useEffect, useState, type RefObject } from 'react';
import { useLocation } from 'react-router';

/**
 * Marketing scroll-reveal system (docs/redesign/brand-elevation-phase.md
 * §2 "Scroll reveal" + brand-elevation delivery item 2).
 *
 * `useReveal()` is ONE IntersectionObserver, shared across every
 * `[data-reveal]` element on the page, adding `.is-in` once each element
 * crosses 15% visible. Call it exactly once, high in the marketing tree
 * (`MarketingLayout`), never per section or per page.
 *
 * Progressive enhancement: the CSS that hides `[data-reveal]` content
 * (styles/marketing.css) only exists under `html.js-reveal` (added here
 * on mount) AND only under `prefers-reduced-motion: no-preference`: a
 * visitor with JS never running, or motion reduced, sees every section
 * already in its final place, never gated on this observer firing.
 *
 * Re-observes on every client-side route change: marketing pages never
 * remount MarketingLayout, so a mount-only effect would only ever see the
 * first page's `[data-reveal]` elements.
 *
 * Every marketing route below Home is code-split (`lib/lazy-page.tsx`,
 * `React.lazy` + `Suspense`), so a route's real `[data-reveal]` content
 * can commit to the DOM strictly AFTER this effect's own initial scan;
 * the effect runs on `pathname` changing, but the lazy chunk resolving is
 * a separate, later commit that does not change `pathname` again. A
 * `MutationObserver` on `<body>` catches that: any `[data-reveal]` node
 * that appears after the initial scan gets handed to the SAME shared
 * `IntersectionObserver` the moment it exists, rather than being missed
 * forever.
 */
export function useReveal(): void {
  const { pathname } = useLocation();

  useEffect(() => {
    document.documentElement.classList.add('js-reveal');

    const intersectionObserver =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries, obs) => {
              for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                revealElement(entry.target as HTMLElement);
                obs.unobserve(entry.target);
              }
            },
            { threshold: 0.15 },
          );

    function observe(el: HTMLElement): void {
      if (intersectionObserver === null) {
        revealElement(el);
        return;
      }
      intersectionObserver.observe(el);
    }

    function observeTreeFor(root: ParentNode): void {
      for (const el of root.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-in)')) {
        observe(el);
      }
    }

    observeTreeFor(document);

    const mutationObserver =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              for (const node of mutation.addedNodes) {
                if (!(node instanceof HTMLElement)) continue;
                if (node.matches('[data-reveal]:not(.is-in)')) observe(node);
                observeTreeFor(node);
              }
            }
          });
    mutationObserver?.observe(document.body, { childList: true, subtree: true });

    return () => {
      intersectionObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [pathname]);
}

/** The event `useReveal()` dispatches on an element the instant it adds
 *  `.is-in`: content that needs to know *when* it was revealed (e.g. a
 *  count-up number), not just how to fade in, listens for this instead of
 *  opening a second observer. */
export const REVEAL_EVENT = 'bm-reveal';

function revealElement(el: HTMLElement): void {
  el.classList.add('is-in');
  el.dispatchEvent(new CustomEvent(REVEAL_EVENT, { bubbles: true }));
}

/**
 * True once the element behind `ref` has been revealed by `useReveal()`'s
 * shared observer (or immediately, if it already carries `.is-in` when
 * this mounts, e.g. IntersectionObserver-unsupported fallback). Opens no
 * observer of its own.
 */
export function useRevealed<T extends HTMLElement>(ref: RefObject<T | null>): boolean {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;

    function onReveal(): void {
      setRevealed(true);
    }
    el.addEventListener(REVEAL_EVENT, onReveal);

    // `useReveal()`'s IntersectionObserver can fire (and dispatch
    // REVEAL_EVENT) in the window between React committing this element
    // and THIS effect running (both are post-commit, but ordering across
    // components isn't guaranteed). Re-check `.is-in` after the listener
    // is attached, not only before, so a reveal that lands in that gap is
    // never missed.
    if (el.classList.contains('is-in')) setRevealed(true);

    return () => el.removeEventListener(REVEAL_EVENT, onReveal);
  }, [ref]);

  return revealed;
}
