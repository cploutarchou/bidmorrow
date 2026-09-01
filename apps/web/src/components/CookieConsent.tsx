import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import {
  consentStateLabel,
  readCategories,
  readDecision,
  resetConsent,
  saveConsent,
  subscribeToConsent,
} from '../lib/consent';

/**
 * Cookie banner + preferences dialog (2026-08-21 handoff, `BidMorrow
 * Homepage.dc.html`). Rendered once by MarketingLayout so every public
 * page carries the banner until a decision is recorded; the footer's
 * "Cookie preferences" button reopens the dialog via
 * `openCookiePreferences()`. No pre-ticks, closing is not consent, and
 * "Withdraw consent" clears the recorded choice entirely.
 */

const prefsListeners = new Set<() => void>();

export function openCookiePreferences(): void {
  for (const listener of prefsListeners) listener();
}

interface ToggleRow {
  id: 'preferences' | 'analytics' | 'marketing';
  label: string;
  note: string;
}

const TOGGLE_ROWS: ToggleRow[] = [
  {
    id: 'preferences',
    label: 'Preferences',
    note: 'Remembers your theme, saved-search selection and digest view between visits.',
  },
  {
    id: 'analytics',
    label: 'Analytics',
    note: 'Would allow Google Analytics 4 with IP anonymisation (page views and feature use). No analytics runs today: nothing loads unless this ships AND you have said yes.',
  },
  {
    id: 'marketing',
    label: 'Marketing',
    note: 'Nothing today. If we ever add advertising or retargeting tags, they would sit here, off unless you turn them on.',
  },
];

export function CookieConsent(): ReactElement | null {
  const decision = useSyncExternalStore(subscribeToConsent, readDecision, () => null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [draft, setDraft] = useState(() => readCategories());
  const dialogRef = useRef<HTMLDivElement>(null);

  // Footer "Cookie preferences" button (any page) reopens the dialog.
  useEffect(() => {
    const open = (): void => {
      setDraft(readCategories());
      setPrefsOpen(true);
    };
    prefsListeners.add(open);
    return () => {
      prefsListeners.delete(open);
    };
  }, []);

  // Esc closes the dialog without changing anything (closing ≠ consent).
  useEffect(() => {
    if (!prefsOpen) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setPrefsOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [prefsOpen]);

  const acceptAll = useCallback(() => {
    saveConsent({ preferences: true, analytics: true, marketing: true });
    setPrefsOpen(false);
  }, []);
  const rejectAll = useCallback(() => {
    saveConsent({ preferences: false, analytics: false, marketing: false });
    setPrefsOpen(false);
  }, []);

  const bannerOpen = decision === null && !prefsOpen;

  // The banner is position:fixed over the page's tail, so while it is open
  // the document gets matching bottom clearance (styles/marketing.css
  // `body.consent-banner-open`); otherwise the footer's links, including
  // the legally-relevant privacy policy, sit underneath it unreachable.
  // A class + stylesheet rule rather than a measured inline style: the CSP
  // is `style-src 'self'` with no inline styles, by design.
  useEffect(() => {
    if (!bannerOpen) return;
    document.body.classList.add('consent-banner-open');
    return () => {
      document.body.classList.remove('consent-banner-open');
    };
  }, [bannerOpen]);

  if (!bannerOpen && !prefsOpen) return null;

  return (
    <>
      {bannerOpen && (
        <div role="dialog" aria-label="Cookie choices" className="consent-banner">
          <div className="consent-banner__inner">
            <div className="consent-banner__copy">
              <p className="consent-banner__title">Your choice about cookies</p>
              <p className="consent-banner__note">
                We use strictly necessary cookies to run the site. Analytics, preference and
                marketing cookies stay switched off until you say yes, and you can change or
                withdraw your choice at any time from the footer.
              </p>
            </div>
            <div className="consent-banner__actions">
              <button type="button" className="consent-btn consent-btn--raised" onClick={rejectAll}>
                Reject all
              </button>
              <button type="button" className="consent-btn consent-btn--accent" onClick={acceptAll}>
                Accept all
              </button>
              <button
                type="button"
                className="consent-btn consent-btn--quiet"
                onClick={() => {
                  setDraft(readCategories());
                  setPrefsOpen(true);
                }}
              >
                Manage preferences
              </button>
            </div>
          </div>
        </div>
      )}

      {prefsOpen && (
        <div>
          <div className="consent-scrim" aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Cookie preferences"
            className="consent-dialog"
            ref={dialogRef}
          >
            <p className="consent-dialog__title">Cookie preferences</p>
            <p className="consent-dialog__lede">
              Nothing outside “strictly necessary” runs before you switch it on. Your choice is
              stored on this device until you change or withdraw it, one click from the footer.
            </p>
            <div className="mkt-cellgrid mkt-cellgrid--rows consent-rows">
              <div className="mkt-cell consent-row">
                <div>
                  <p className="consent-row__label">Strictly necessary</p>
                  <p className="consent-row__note">
                    Session, sign-in and security. These cannot be switched off; they are what makes
                    the app work.
                  </p>
                </div>
                <div className="consent-row__control">
                  <span className="consent-row__locked">Always on</span>
                  <span className="consent-row__state">On</span>
                </div>
              </div>
              {TOGGLE_ROWS.map((row) => {
                const on = draft[row.id];
                return (
                  <div className="mkt-cell consent-row" key={row.id}>
                    <div>
                      <p className="consent-row__label">{row.label}</p>
                      <p className="consent-row__note">{row.note}</p>
                    </div>
                    <div className="consent-row__control">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={`Toggle ${row.label} cookies`}
                        className={on ? 'consent-switch is-on' : 'consent-switch'}
                        onClick={() => setDraft((d) => ({ ...d, [row.id]: !d[row.id] }))}
                      >
                        <span className="consent-switch__knob" />
                      </button>
                      <span className="consent-row__state">{on ? 'On' : 'Off'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="consent-dialog__actions">
              <button
                type="button"
                className="consent-btn consent-btn--accent"
                onClick={() => {
                  saveConsent({
                    preferences: draft.preferences,
                    analytics: draft.analytics,
                    marketing: draft.marketing,
                  });
                  setPrefsOpen(false);
                }}
              >
                Save my choice
              </button>
              <button type="button" className="consent-btn consent-btn--raised" onClick={rejectAll}>
                Reject all
              </button>
              <button type="button" className="consent-btn consent-btn--quiet" onClick={acceptAll}>
                Accept all
              </button>
              {decision !== null && (
                <button
                  type="button"
                  className="consent-btn consent-btn--danger"
                  onClick={() => {
                    resetConsent();
                    setPrefsOpen(false);
                  }}
                >
                  Withdraw consent
                </button>
              )}
              <button
                type="button"
                className="consent-btn consent-btn--close"
                onClick={() => setPrefsOpen(false)}
              >
                Close without changing
              </button>
            </div>
            <p className="consent-dialog__foot">
              Closing this panel is not consent: nothing changes until you choose. Details of every
              cookie and its retention are in the cookie policy, alongside the privacy notice and
              your rights under the GDPR.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

/** Footer widget: state line + preference/withdraw buttons. */
export function ConsentFooterControls(): ReactElement {
  const decision = useSyncExternalStore(subscribeToConsent, readDecision, () => null);
  const label = useSyncExternalStore(subscribeToConsent, consentStateLabel, () => '');
  return (
    <div className="consent-footer">
      <p className="consent-footer__state">{label}</p>
      <span className="consent-footer__buttons">
        <button
          type="button"
          className="consent-btn consent-btn--quiet"
          onClick={openCookiePreferences}
        >
          Cookie preferences
        </button>
        {decision !== null && (
          <button type="button" className="consent-btn consent-btn--quiet" onClick={resetConsent}>
            Withdraw consent
          </button>
        )}
      </span>
    </div>
  );
}
