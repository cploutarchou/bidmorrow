import { useEffect, useRef, type RefObject } from 'react';
import { usePrefersReducedMotion } from './motion';

const MAX_TILT_DEG = 4;

/**
 * Pointer-driven 3D tilt for the Home product frame
 * (docs/redesign/brand-elevation-phase.md §2 "Product frame" + brand-
 * elevation delivery item 3): desktop, fine-pointer only, capped at 4°.
 *
 * Writes `--tilt-x`/`--tilt-y` custom properties on the element via
 * `element.style.setProperty` — CSSOM property writes, not a `style=`
 * attribute or a `<style>` tag, so this stays inside `style-src 'self'`
 * with no `unsafe-inline` (same reasoning as `styles/illustrations.css`'s
 * header). `styles/marketing.css` reads those properties inside
 * `@media (pointer: fine) and (prefers-reduced-motion: no-preference)` —
 * the CSS itself is the second gate, so even if this hook ran on a touch
 * device the properties it wrote would have no visible effect.
 *
 * `pointermove` fires far more often than the display can repaint (every
 * mouse-move tick, easily 60-plus times a second on a fast mouse) — the
 * handler is rAF-throttled (one `getBoundingClientRect` + two style
 * writes per animation frame, not per event) so a fast sweep across the
 * card never queues more style-recalculation work than the browser can
 * paint, and the listener is registered `{ passive: true }` since it
 * never calls `preventDefault`.
 *
 * No-ops entirely (attaches no listeners) under reduced motion or on a
 * coarse/touch pointer.
 */
export function useTilt<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (el === null || reducedMotion) return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia('(pointer: fine)').matches) return;

    let frame: number | null = null;
    let pendingEvent: PointerEvent | null = null;

    function applyTilt(): void {
      frame = null;
      const event = pendingEvent;
      if (el === null || event === null) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      const tiltY = (px - 0.5) * 2 * MAX_TILT_DEG;
      const tiltX = (0.5 - py) * 2 * MAX_TILT_DEG;
      el.style.setProperty('--tilt-x', `${tiltX.toFixed(2)}deg`);
      el.style.setProperty('--tilt-y', `${tiltY.toFixed(2)}deg`);
    }

    function handleMove(event: PointerEvent): void {
      pendingEvent = event;
      if (frame === null) frame = window.requestAnimationFrame(applyTilt);
    }

    function handleLeave(): void {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      pendingEvent = null;
      el?.style.setProperty('--tilt-x', '0deg');
      el?.style.setProperty('--tilt-y', '0deg');
    }

    el.addEventListener('pointermove', handleMove, { passive: true });
    el.addEventListener('pointerleave', handleLeave, { passive: true });
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      el.removeEventListener('pointermove', handleMove);
      el.removeEventListener('pointerleave', handleLeave);
      el.style.removeProperty('--tilt-x');
      el.style.removeProperty('--tilt-y');
    };
  }, [reducedMotion]);

  return ref;
}
