import {
  lazy,
  Suspense,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type LazyExoticComponent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { RouteFallback } from '../components/RouteChunkBoundary';
import { usePrefersReducedMotion } from './motion';

/**
 * Route-level code splitting helpers.
 *
 * Pages are named exports, and `React.lazy` wants a module with a `default`,
 * hence the small unwrap. `react-router` 7 is used here through the
 * declarative `<Routes>` API rather than a data router, so its own route-level
 * `lazy` property is unavailable — `React.lazy` + `Suspense` is the mechanism.
 */
export function lazyPage<K extends string, P extends object = Record<never, never>>(
  load: () => Promise<Record<K, ComponentType<P>>>,
  name: K,
): LazyExoticComponent<ComponentType<P>> {
  return lazy(async () => {
    const module = await load();
    return { default: module[name] as ComponentType<P> };
  });
}

/**
 * Suspense boundary for a lazily-loaded page.
 *
 * Deliberately placed INSIDE each layout (`<MarketingLayout><Lazy>…`) rather
 * than once around `<Routes>`: a single outer boundary would unmount the
 * header and footer during every chunk fetch, so navigation would flash the
 * whole shell instead of just the page body.
 */
export function Lazy({ children }: { children: ReactNode }): ReactElement {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

/**
 * Cross-fades `/app/*` route content via the native View Transition API
 * (docs/redesign/brand-elevation-phase.md §2 "App" — "View Transitions
 * cross-fade on route change when supported"), with no router
 * integration required: `AppShell` is the single, stable ancestor every
 * `/app/*` route renders through (`<AppShell><Lazy><Page/></Lazy></
 * AppShell>` per `App.tsx`), so wrapping its `children` here is enough to
 * catch every navigation between app pages — Feed <-> Settings <-> Tender
 * detail — without patching `<Link>` or the router.
 *
 * `transitionKey` (not `children` identity) decides whether a swap gets
 * the cross-fade treatment. `children` is a FRESH React element on every
 * single render of `AppShell`'s owner (`AppRoutes` in `App.tsx`) — JSX
 * always allocates a new element object — including renders that are not
 * a real page change: opening the tender slide-over navigates to
 * `/app/tenders/:matchId` with `state.backgroundLocation` set, which
 * changes `useLocation()` and re-renders `AppRoutes`, but the PRIMARY
 * `<Routes location={background}>` still matches `/app` and renders the
 * same Feed page underneath the sheet. Comparing `children !== displayed`
 * by reference (the original approach) fired a view transition on every
 * such re-render, racing the sheet's own slide-in animation. Keying off
 * `location.pathname + location.search` instead — computed by the CALLER
 * via its own `useLocation()` — sidesteps this for free: react-router's
 * `<Routes location>` re-scopes `useLocation()` for its whole matched
 * subtree to that override location (see `useRoutesImpl`'s
 * `LocationContext.Provider` in react-router's source), so `AppShell`'s
 * own `useLocation()` already resolves to `background` while the sheet is
 * open and does not change value across that open/close — only a real
 * navigation changes it.
 *
 * How it lags one commit on purpose: `displayed` only updates inside the
 * `document.startViewTransition` callback, via `flushSync` so the DOM
 * mutation happens synchronously within that callback (the API's own
 * contract — the "old" screenshot is taken at the moment
 * `startViewTransition` is called, so `displayed` must still hold the
 * PREVIOUS page at that instant, and the "new" screenshot needs the
 * mutation to have already landed by the time the callback returns).
 *
 * `displayedKey` is a ref, not state: it only ever needs to be read
 * inside this same effect, and putting it in `useState` would add it to
 * the dependency array, re-running the effect (and thus reading
 * `displayedKey` again, correctly) but via an extra render pass — one
 * that lands mid-transition, inside the very `flushSync` window the
 * View Transition API is timing-sensitive about. A ref sidesteps that
 * extra render entirely.
 *
 * Progressive and guarded: skipped entirely under
 * `prefers-reduced-motion` and where `document.startViewTransition` is
 * unavailable (Firefox, older Safari) — those cases fall straight
 * through to the instant `setDisplayed` update, i.e. today's behavior.
 * No library; the crossfade timing itself lives in
 * `::view-transition-old(root)`/`::view-transition-new(root)` in
 * `styles/app.css`.
 */
export function RouteTransition({
  transitionKey,
  children,
}: {
  transitionKey: string;
  children: ReactNode;
}): ReactElement {
  const [displayed, setDisplayed] = useState(children);
  const displayedKeyRef = useRef(transitionKey);
  const prefersReducedMotion = usePrefersReducedMotion();

  useLayoutEffect(() => {
    if (transitionKey === displayedKeyRef.current) {
      // Same page/view (e.g. the tender slide-over opening or closing over
      // an unchanged Feed) — keep `displayed` current so any new props
      // still reach the page, just never through a view transition.
      setDisplayed(children);
      return;
    }
    // `typeof` (not optional chaining): TS's own `lib.dom.d.ts` declares
    // `startViewTransition` as always present, but Firefox and older
    // Safari genuinely lack it at runtime — this is real feature
    // detection, not type narrowing.
    if (prefersReducedMotion || typeof document.startViewTransition !== 'function') {
      setDisplayed(children);
      displayedKeyRef.current = transitionKey;
      return;
    }
    document.startViewTransition(() => {
      flushSync(() => setDisplayed(children));
    });
    displayedKeyRef.current = transitionKey;
    // `displayed` is intentionally excluded from the dependency array: it
    // is this effect's own write target, and including it would re-run
    // the effect on every frame of the transition rather than only when a
    // NEW `children` arrives.
  }, [children, transitionKey, prefersReducedMotion]);

  return <>{displayed}</>;
}
