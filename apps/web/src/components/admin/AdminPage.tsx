import type { ReactElement, ReactNode } from 'react';

/**
 * Page frame for every admin section — 2026-08-21 handoff redesign
 * (`BidMorrow Admin.dc.html`), which gives each section a title and a
 * one-line note explaining what the operator is looking at.
 *
 * The note is not decoration. These pages are read by whoever is on call,
 * often for the first time, and several of them show numbers that are easy
 * to misread (a paused queue is not a broken one; an unmeasured database
 * size is not a zero). The note is where that context lives.
 *
 * Also owns the document title, so a page cannot be added without one.
 */
export function AdminPage({
  documentTitle,
  heading,
  note,
  children,
}: {
  documentTitle: string;
  heading: string;
  note: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="admin-page">
      <title>{documentTitle}</title>
      <div className="admin-page__head">
        <h1 className="admin-page__title">{heading}</h1>
        <p className="admin-page__note">{note}</p>
      </div>
      {children}
    </div>
  );
}
