/**
 * Cookie-consent state machine (2026-08-21 handoff, `BidMorrow
 * Homepage.dc.html`): GDPR-shaped, no pre-ticked boxes, nothing
 * non-essential runs before an explicit choice, and the choice is
 * revocable from the footer at any time.
 *
 * Storage keys and semantics match the prototype exactly:
 * - `bm_consent_categories`: JSON of per-category booleans.
 * - `bm_analytics_consent`: 'granted' | 'denied' | 'custom'. Only these
 *   three count as a recorded decision; anything else means "never
 *   asked", so the banner shows again and stale values self-heal.
 *
 * Analytics loading is a stub: the prototype gates GA4 injection on a
 * real measurement ID, and shipping one needs a CSP allowlist change
 * (script-src/connect-src are 'self'), an owner decision recorded in
 * HUMAN_DECISION_BLOCKERS.md. Until then consent is recorded but no
 * third-party script ever loads.
 */

export interface ConsentCategories {
  necessary: true;
  preferences: boolean;
  analytics: boolean;
  marketing: boolean;
}

export type ConsentDecision = 'granted' | 'denied' | 'custom' | null;

const DECISION_KEY = 'bm_analytics_consent';
const CATEGORIES_KEY = 'bm_consent_categories';

const FALLBACK: ConsentCategories = {
  necessary: true,
  preferences: false,
  analytics: false,
  marketing: false,
};

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function readDecision(): ConsentDecision {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(DECISION_KEY);
  } catch {
    raw = null;
  }
  return raw === 'granted' || raw === 'denied' || raw === 'custom' ? raw : null;
}

export function readCategories(): ConsentCategories {
  try {
    const raw = window.localStorage.getItem(CATEGORIES_KEY);
    if (raw === null) return FALLBACK;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return FALLBACK;
    const record = parsed as Record<string, unknown>;
    return {
      necessary: true,
      preferences: record['preferences'] === true,
      analytics: record['analytics'] === true,
      marketing: record['marketing'] === true,
    };
  } catch {
    return FALLBACK;
  }
}

/**
 * The one writer for consent: stores the categories, records the
 * decision, and (once a GA property + CSP change exist) would load
 * analytics only when the analytics category is on.
 */
export function saveConsent(categories: Omit<ConsentCategories, 'necessary'>): void {
  const next: ConsentCategories = {
    necessary: true,
    preferences: categories.preferences,
    analytics: categories.analytics,
    marketing: categories.marketing,
  };
  const decision: ConsentDecision = next.analytics
    ? 'granted'
    : next.preferences || next.marketing
      ? 'custom'
      : 'denied';
  try {
    window.localStorage.setItem(CATEGORIES_KEY, JSON.stringify(next));
    window.localStorage.setItem(DECISION_KEY, decision);
  } catch {
    // Private mode; the in-memory state below still applies for this tab.
  }
  notify();
}

/** Withdraw: remove both keys so the banner shows again. */
export function resetConsent(): void {
  try {
    window.localStorage.removeItem(DECISION_KEY);
    window.localStorage.removeItem(CATEGORIES_KEY);
  } catch {
    // Private mode.
  }
  notify();
}

export function subscribeToConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Human-readable footer state line, per the prototype. */
export function consentStateLabel(): string {
  const decision = readDecision();
  if (decision === null) return 'Cookies: no choice recorded yet';
  if (decision === 'granted') {
    const categories = readCategories();
    return (
      'Cookies: analytics on' +
      (categories.preferences ? ', preferences on' : '') +
      (categories.marketing ? ', marketing on' : '')
    );
  }
  if (decision === 'custom') return 'Cookies: your selection saved';
  return 'Cookies: strictly necessary only';
}
