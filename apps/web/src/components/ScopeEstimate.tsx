import { useEffect, useState, type ReactElement } from 'react';
import { api } from '../lib/api';
import { isIngestedCpvCode } from '../lib/onboarding-scope';

/**
 * What the current CPV + country selection WOULD have returned over the last
 * 30 days — 2026-08-21 handoff (`BidMorrow Onboarding.dc.html`).
 *
 * The point of this panel is to make one specific disappointment impossible:
 * finishing onboarding with a selection that matches nothing and finding out
 * from an empty feed. Ingestion covers only some CPV families
 * (docs/ted-ingestion-scope.md), so a construction or catering company can
 * pick a perfectly sensible sector and still get zero. Better said here, in
 * numbers, than discovered later.
 *
 * It is a count of real rows over a real window and is labelled as such. It
 * is NOT a forecast, and nothing here may phrase it as one.
 */

export interface ScopeEstimateResponse {
  readonly windowDays: number;
  readonly scorableLots: number;
  readonly inChosenCountries: number | null;
  readonly ingestedCpvFamilies: readonly string[];
}

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: ScopeEstimateResponse }
  | { readonly kind: 'failed' };

/** Long enough that typing a code does not fire a request per keystroke. */
const DEBOUNCE_MS = 500;

export function ScopeEstimate({
  cpvCodes,
  countryCodes,
}: {
  cpvCodes: readonly string[];
  countryCodes: readonly string[];
}): ReactElement {
  const [state, setState] = useState<State>({ kind: 'idle' });

  // Serialized so the effect re-runs on content change, not identity change —
  // these arrays are rebuilt on every render of the wizard.
  const cpvKey = [...cpvCodes].sort().join(',');
  const countryKey = [...countryCodes].sort().join(',');

  useEffect(() => {
    if (cpvKey.length === 0) {
      setState({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ kind: 'loading' });
    const timer = window.setTimeout(() => {
      api
        .post<ScopeEstimateResponse>('/api/org/onboarding/scope-estimate', {
          cpvCodes: cpvKey.split(','),
          countryCodes: countryKey.length === 0 ? [] : countryKey.split(','),
        })
        .then((data) => {
          if (!cancelled) setState({ kind: 'ready', data });
        })
        .catch(() => {
          // A failed estimate must never block onboarding: it is an aid, not
          // a gate. Say it is unavailable and let the user carry on.
          if (!cancelled) setState({ kind: 'failed' });
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cpvKey, countryKey]);

  if (state.kind === 'idle') {
    return (
      <section className="ob-estimate" aria-live="polite">
        <p className="ob-estimate__value">—</p>
        <p className="ob-estimate__note">Add CPV codes to see what they would have returned.</p>
      </section>
    );
  }

  if (state.kind === 'loading') {
    return (
      <section className="ob-estimate" aria-live="polite">
        <p className="ob-estimate__value">…</p>
        <p className="ob-estimate__note">Checking the last 30 days…</p>
      </section>
    );
  }

  if (state.kind === 'failed') {
    return (
      <section className="ob-estimate" aria-live="polite">
        <p className="ob-estimate__value">—</p>
        <p className="ob-estimate__note">
          The estimate is unavailable right now. This does not affect your selection — carry on.
        </p>
      </section>
    );
  }

  const { data } = state;
  const outOfScope = cpvCodes.filter((code) => !isIngestedCpvCode(code, data.ingestedCpvFamilies));
  const allOutOfScope = outOfScope.length === cpvCodes.length && cpvCodes.length > 0;

  return (
    <section
      className={allOutOfScope ? 'ob-estimate ob-estimate--none' : 'ob-estimate'}
      aria-live="polite"
    >
      <p className="ob-estimate__value num">{data.scorableLots}</p>
      <p className="ob-estimate__note">
        {data.scorableLots === 0
          ? `No notices in the last ${String(data.windowDays)} days matched these codes.`
          : `notices in the last ${String(data.windowDays)} days would have been scored for this selection.`}
        {data.inChosenCountries !== null && data.scorableLots > 0 && (
          <>
            {' '}
            {data.inChosenCountries} of them in the countries you chose — the rest are still scored,
            because geography affects the score rather than deciding whether a tender is scored at
            all.
          </>
        )}
      </p>

      {outOfScope.length > 0 && (
        <p className="ob-estimate__scope">
          {allOutOfScope
            ? `None of your ${String(cpvCodes.length)} codes are ingested yet. They are saved to your profile and start scoring if ingestion is widened to cover them — until then this selection returns nothing.`
            : `${String(outOfScope.length)} of your ${String(cpvCodes.length)} codes are outside the ingested scope. They are saved, and wait for a scope change; the rest are scored today.`}
        </p>
      )}

      <p className="ob-estimate__caveat">
        Counted from notices already ingested over the last {data.windowDays} days. A description of
        the recent past, not a promise about future volume.
      </p>
    </section>
  );
}
