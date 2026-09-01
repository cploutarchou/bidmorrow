import { useCallback, useEffect, useRef, type ReactElement, type ReactNode } from 'react';

/**
 * Right-hand slide-over: 2026-08-21 handoff (`BidMorrow Client Area.dc.html`),
 * which opens a tender beside the feed instead of navigating away from it.
 *
 * The prototype is a `sheetOpen` boolean with no URL and no keyboard model.
 * That is not shippable as-is: a tender is a thing people send each other, and
 * a sheet with no address cannot be linked, bookmarked, or reopened by Back.
 * So the sheet is driven by the SAME `/app/tenders/:matchId` route the full
 * page uses (see App.tsx's `backgroundLocation` handling): Back closes it,
 * the URL is shareable, and a shared link opens the full page.
 *
 * Everything below is the modal contract the prototype does not have:
 *
 * - `role="dialog"` + `aria-modal` + a label taken from the heading inside.
 * - Focus moves in on open and is restored to whatever opened it on close,
 *   so keyboard users are not dumped back at the top of the document.
 * - Tab is trapped, because `aria-modal` hides the rest of the page from
 *   assistive tech but does NOT stop Tab from walking into it.
 * - Escape closes; so does a click on the scrim, but not a click that merely
 *   ENDS on the scrim after a drag that began inside the sheet (that is text
 *   selection, not a dismissal).
 * - The page behind does not scroll while it is open (`body.sheet-open`),
 *   set as a class rather than an inline style, in keeping with the app's
 *   `style-src 'self'` CSP and its zero inline styles.
 */

/** Matches what a browser will actually let Tab reach. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function DetailSheet({
  onClose,
  labelledBy,
  children,
}: {
  onClose: () => void;
  /** id of the heading inside `children` that names this sheet. */
  labelledBy: string;
  children: ReactNode;
}): ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<Element | null>(null);
  /** Whether the current pointer gesture started inside the panel. */
  const pressStartedInside = useRef(false);

  const focusable = useCallback((): HTMLElement[] => {
    const panel = panelRef.current;
    if (panel === null) return [];
    return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
  }, []);

  // Remember the trigger, move focus in, and restore it on the way out.
  useEffect(() => {
    returnFocusTo.current = document.activeElement;
    const panel = panelRef.current;
    // The panel itself is the initial target rather than the first control:
    // landing on "Close" would read the dismissal before the tender.
    panel?.focus();
    return () => {
      const target = returnFocusTo.current;
      if (target instanceof HTMLElement && document.contains(target)) target.focus();
    };
  }, []);

  useEffect(() => {
    document.body.classList.add('sheet-open');
    return () => document.body.classList.remove('sheet-open');
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        // Nothing to land on (the content is still loading): keep focus in
        // the panel rather than letting Tab escape to the page behind.
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose, focusable]);

  return (
    <div className="sheet-layer">
      <div
        className="sheet-scrim"
        aria-hidden="true"
        onMouseDown={() => {
          pressStartedInside.current = false;
        }}
        onClick={() => {
          if (!pressStartedInside.current) onClose();
        }}
      />
      <div
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        ref={panelRef}
        onMouseDown={() => {
          pressStartedInside.current = true;
        }}
      >
        {children}
      </div>
    </div>
  );
}
