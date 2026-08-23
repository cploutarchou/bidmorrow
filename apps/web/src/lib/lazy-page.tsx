import {
  lazy,
  Suspense,
  type ComponentType,
  type LazyExoticComponent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { RouteFallback } from '../components/RouteChunkBoundary';

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
