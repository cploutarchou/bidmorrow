import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { appendCursor, startCursor, type CursorState } from '../../lib/cursor';
import type { FeedResponse, FeedRow } from '../../lib/types';
import { subscribeToMatchUpdates } from '../../lib/match-events';
import { FeedRail } from '../../components/FeedRail';
import type { SavedSearch } from '../../lib/saved-searches';
import type { OrgProfileResponse } from '../../lib/onboarding-types';
import { TenderCard } from '../../components/TenderCard';
import { SubscriptionRequiredNotice } from '../../components/SubscriptionRequiredNotice';

type Tab = 'today' | 'strong' | 'worth_reviewing' | 'possible' | 'saved' | 'ignored';

/**
 * Fix for C5 (docs/redesign/ux-strategy.md §5.1): the score-band views and
 * the "your shelves" views are a different kind of thing, not six equal
 * tabs — split so a 390px screen never needs a scrolling segmented
 * control. Both groups stay `role="tab"` children of the same tablist (no
 * extra DOM nesting) so keyboard/AT behavior and the existing E2E
 * `getByRole('tab', {name: ...})` selectors are unchanged; only the visual
 * grouping (via `data-group`) differs.
 */
const TABS: { id: Tab; label: string; group: 'score' | 'shelf' }[] = [
  { id: 'today', label: "Today's matches", group: 'score' },
  { id: 'strong', label: 'Strong', group: 'score' },
  { id: 'worth_reviewing', label: 'Worth reviewing', group: 'score' },
  { id: 'possible', label: 'Possible', group: 'score' },
  { id: 'saved', label: 'Saved', group: 'shelf' },
  { id: 'ignored', label: 'Ignored', group: 'shelf' },
];

interface Filters {
  minScore: string;
  country: string;
  cpvPrefix: string;
  buyerName: string;
  minValueEur: string;
  maxValueEur: string;
  deadlineBefore: string;
  deadlineAfter: string;
  publishedAfter: string;
}

const EMPTY_FILTERS: Filters = {
  minScore: '',
  country: '',
  cpvPrefix: '',
  buyerName: '',
  minValueEur: '',
  maxValueEur: '',
  deadlineBefore: '',
  deadlineAfter: '',
  publishedAfter: '',
};

function countActiveFilters(filters: Filters): number {
  return Object.values(filters).filter((v) => v.length > 0).length;
}

function buildQuery(tab: Tab, filters: Filters, cursor: string | undefined): string {
  const params = new URLSearchParams({ tab });
  if (filters.minScore.length > 0) params.set('minScore', filters.minScore);
  if (filters.country.length > 0) params.set('country', filters.country);
  if (filters.cpvPrefix.length > 0) params.set('cpvPrefix', filters.cpvPrefix);
  if (filters.buyerName.length > 0) params.set('buyerName', filters.buyerName);
  if (filters.minValueEur.length > 0) params.set('minValueEur', filters.minValueEur);
  if (filters.maxValueEur.length > 0) params.set('maxValueEur', filters.maxValueEur);
  if (filters.deadlineBefore.length > 0) {
    params.set('deadlineBefore', String(Date.parse(filters.deadlineBefore)));
  }
  if (filters.deadlineAfter.length > 0) {
    params.set('deadlineAfter', String(Date.parse(filters.deadlineAfter)));
  }
  if (filters.publishedAfter.length > 0) params.set('publishedAfter', filters.publishedAfter);
  if (cursor !== undefined) params.set('cursor', cursor);
  return params.toString();
}

/** Minimal shape read from `/api/billing/status` for the 402 notice — see Settings.tsx for the full DTO. */
interface FoundingAvailability {
  foundingAvailable: boolean;
}

export function Feed(): ReactElement {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('today');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [useCustomCountry, setUseCustomCountry] = useState(false);
  const [countryOptions, setCountryOptions] = useState<string[]>([]);
  const [state, setState] = useState<CursorState<FeedRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionRequired, setSubscriptionRequired] = useState<{ reason: string } | null>(null);
  const [foundingAvailable, setFoundingAvailable] = useState<boolean | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [profileSummary, setProfileSummary] = useState<string | null>(null);
  const now = Date.now();

  // The rail's profile line. Built from what the profile actually holds —
  // no completeness percentage, because the product has no such model and a
  // made-up one would be read as guidance.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<OrgProfileResponse>('/api/org/profile'),
      api.get<{ cpvPreferences: { cpvCode: string }[] }>('/api/org/cpv-preferences'),
    ])
      .then(([profile, cpv]) => {
        if (cancelled) return;
        const parts: string[] = [];
        if (cpv.cpvPreferences.length > 0) {
          parts.push(
            `${String(cpv.cpvPreferences.length)} CPV code${cpv.cpvPreferences.length === 1 ? '' : 's'}`,
          );
        }
        const min = profile.matching?.minValueEur ?? null;
        const max = profile.matching?.maxValueEur ?? null;
        if (min !== null || max !== null) {
          parts.push(
            `€${min === null ? '0' : min.toLocaleString()}–€${max === null ? '∞' : max.toLocaleString()}`,
          );
        }
        const days = profile.matching?.minimumDaysRemaining ?? null;
        if (days !== null) parts.push(`min ${String(days)} days runway`);
        setProfileSummary(parts.length > 0 ? parts.join(' · ') : null);
      })
      .catch(() => {
        // The rail is an accelerator; a failure here must not disturb the feed.
        if (!cancelled) setProfileSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function applySavedSearch(search: SavedSearch): void {
    const next: Filters = { ...EMPTY_FILTERS, ...search.filters };
    setFilters(next);
    setTab(search.tab as Tab);
    setUseCustomCountry(next.country.length > 0 && !countryOptions.includes(next.country));
    void load(search.tab as Tab, next);
  }

  // Transient toast auto-clear (docs/redesign/app-interface-spec.md §8.2) —
  // purely visual; the accessible `role="status"` live region below reads
  // `statusMessage` independently and is unaffected by this timeout.
  useEffect(() => {
    if (statusMessage === null) return;
    const timeout = window.setTimeout(() => setStatusMessage(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  // Best-effort: populates the country filter's known-value select from the
  // org's own saved opportunity/served countries (fix for C8 — a bare
  // free-text field invites typos that silently return zero results). Never
  // blocks or errors the feed itself if it fails.
  useEffect(() => {
    api
      .get<{ geographies: { kind: string; code: string }[] }>('/api/org/geographies')
      .then((res) => {
        const codes = Array.from(
          new Set(
            res.geographies
              .filter((g) => g.kind === 'opportunity_country' || g.kind === 'country_served')
              .map((g) => g.code),
          ),
        ).sort();
        setCountryOptions(codes);
      })
      .catch(() => undefined);
  }, []);

  // Guards against an out-of-order network response clobbering a newer one
  // (e.g. the initial mount's 'today' fetch resolving AFTER a fast tab
  // switch's fetch — both legitimate requests, but only the response for
  // the CURRENTLY selected tab/filters should ever be committed to state).
  const latestRequestId = useRef(0);

  const load = useCallback(
    async (nextTab: Tab, nextFilters: Filters) => {
      const requestId = latestRequestId.current + 1;
      latestRequestId.current = requestId;
      setLoading(true);
      setError(null);
      setSubscriptionRequired(null);
      try {
        const res = await api.get<FeedResponse>(
          `/api/org/feed?${buildQuery(nextTab, nextFilters, undefined)}`,
        );
        if (latestRequestId.current !== requestId) return; // superseded by a newer request
        setState(startCursor(res));
      } catch (cause) {
        if (latestRequestId.current !== requestId) return; // superseded by a newer request
        if (cause instanceof ApiError && cause.status === 403) {
          const body = cause.body as { error?: string } | null;
          // R2 (docs/redesign/ux-strategy.md §1.3): a brand-new user who never
          // created an organization is auto-routed to /onboarding instead of
          // dead-ending on this page — the single worst moment in the product
          // before this fix (F12). `organization_deleted`/`organization_
          // suspended` are real, distinct problems and must NOT be routed the
          // same way.
          if (body?.error === 'no_organization') {
            void navigate('/onboarding', { replace: true });
            return;
          }
          if (body?.error === 'organization_deleted') {
            setError('This organization has been deleted.');
          } else if (body?.error === 'organization_suspended') {
            setError('This organization is currently suspended — contact support for help.');
          } else {
            setError('Complete onboarding to see your feed.');
          }
        } else if (cause instanceof ApiError && cause.status === 402) {
          // Fix for F17 (docs/redesign/ux-strategy.md §5.4): a designed
          // paywall state, never the generic "could not load" error.
          const body = cause.body as { error?: string; reason?: string } | null;
          setSubscriptionRequired({ reason: body?.reason ?? 'no_subscription' });
        } else {
          setError('Could not load your feed. Please try again.');
        }
      } finally {
        if (latestRequestId.current === requestId) setLoading(false);
      }
    },
    [navigate],
  );

  useEffect(() => {
    // Intentionally re-runs only when the tab changes — filters are applied
    // explicitly via the "Apply filters" submit, not on every keystroke.
    void load(tab, filters);
    // filters/load are deliberately excluded from deps for the reason above.
  }, [tab]);

  // Reads real founding-plan availability for the 402 notice's pricing line
  // — never a hardcoded/fake claim (docs/redesign/ux-strategy.md §5.4 truth
  // constraint).
  useEffect(() => {
    if (subscriptionRequired === null) return;
    let cancelled = false;
    api
      .get<FoundingAvailability>('/api/billing/status')
      .then((res) => {
        if (!cancelled) setFoundingAvailable(res.foundingAvailable);
      })
      .catch(() => {
        if (!cancelled) setFoundingAvailable(null);
      });
    return () => {
      cancelled = true;
    };
  }, [subscriptionRequired?.reason]);

  async function loadMore(): Promise<void> {
    if (state === null || state.nextCursor === null) return;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await api.get<FeedResponse>(
        `/api/org/feed?${buildQuery(tab, filters, state.nextCursor)}`,
      );
      setState((prev) => (prev === null ? startCursor(res) : appendCursor(prev, res)));
    } catch {
      setError('Could not load more results. Please try again.');
    } finally {
      setLoadingMore(false);
    }
  }

  function onFilterSubmit(): void {
    void load(tab, filters);
  }

  function clearFilters(): void {
    setFilters(EMPTY_FILTERS);
    setUseCustomCountry(false);
    void load(tab, EMPTY_FILTERS);
  }

  // The detail sheet stays open OVER this feed, so a save or ignore made in
  // it must be reflected on the card underneath. Patching the one row beats
  // refetching on close, which would cost a request and could reorder or drop
  // the row the user was just reading (lib/match-events.ts).
  useEffect(
    () =>
      subscribeToMatchUpdates((update) => {
        setState((prev) =>
          prev === null
            ? prev
            : {
                ...prev,
                items: prev.items.map((item) =>
                  item.matchId === update.matchId
                    ? {
                        ...item,
                        ...(update.savedByYou !== undefined
                          ? { savedByYou: update.savedByYou }
                          : {}),
                        ...(update.ignoredByYou !== undefined
                          ? { ignoredByYou: update.ignoredByYou }
                          : {}),
                      }
                    : item,
                ),
              },
        );
      }),
    [],
  );

  async function handleSave(matchId: string, nextSaved: boolean): Promise<void> {
    if (state === null) return;
    const previous = state;
    setState({
      ...state,
      items: state.items.map((item) =>
        item.matchId === matchId ? { ...item, savedByYou: nextSaved } : item,
      ),
    });
    try {
      await api.post(`/api/org/tenders/${matchId}/${nextSaved ? 'save' : 'unsave'}`);
      setStatusMessage(nextSaved ? 'Saved.' : 'Removed from saved.');
    } catch {
      setState(previous);
      setStatusMessage('Could not update — please try again.');
    }
  }

  async function handleIgnore(matchId: string, nextIgnored: boolean): Promise<void> {
    if (state === null) return;
    const previous = state;
    setState({
      ...state,
      items: state.items.map((item) =>
        item.matchId === matchId ? { ...item, ignoredByYou: nextIgnored } : item,
      ),
    });
    try {
      await api.post(`/api/org/tenders/${matchId}/${nextIgnored ? 'ignore' : 'unignore'}`);
      setStatusMessage(nextIgnored ? 'Ignored.' : 'Removed from ignored.');
    } catch {
      setState(previous);
      setStatusMessage('Could not update — please try again.');
    }
  }

  const activeFilterCount = countActiveFilters(filters);
  const isShelfTab = tab === 'saved' || tab === 'ignored';

  return (
    <>
      <title>Feed — BidMorrow</title>
      <h1>What should you investigate today?</h1>

      {subscriptionRequired !== null ? (
        <SubscriptionRequiredNotice
          reason={subscriptionRequired.reason}
          foundingAvailable={foundingAvailable}
        />
      ) : (
        <div className="feed-layout">
          <FeedRail
            activeTab={tab}
            activeFilters={Object.fromEntries(
              Object.entries(filters).filter(([, value]) => value.length > 0),
            )}
            hasActiveFilters={activeFilterCount > 0}
            onApply={applySavedSearch}
            profileSummary={profileSummary}
          />
          <div className="feed-main">
            <div className="feed-view-switcher">
              <div role="tablist" aria-label="Feed tabs" className="feed-tabs">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    data-group={t.group}
                    className={tab === t.id ? 'tab tab--active' : 'tab'}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <details className="feed-filters">
              <summary>
                Filters
                {activeFilterCount > 0 && (
                  <span className="filters-badge">· {activeFilterCount}</span>
                )}
              </summary>
              <form
                className="feed-filter-body"
                onSubmit={(event) => {
                  event.preventDefault();
                  onFilterSubmit();
                }}
              >
                <fieldset className="feed-filter-group">
                  <legend>Score &amp; value</legend>
                  <div className="feed-filter-fields">
                    <div className="form-field">
                      <label htmlFor="filter-min-score">Minimum score</label>
                      <input
                        id="filter-min-score"
                        type="number"
                        min={0}
                        max={100}
                        value={filters.minScore}
                        onChange={(event) =>
                          setFilters({ ...filters, minScore: event.target.value })
                        }
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="filter-min-value">Min value (EUR)</label>
                      <input
                        id="filter-min-value"
                        type="number"
                        min={0}
                        value={filters.minValueEur}
                        onChange={(event) =>
                          setFilters({ ...filters, minValueEur: event.target.value })
                        }
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="filter-max-value">Max value (EUR)</label>
                      <input
                        id="filter-max-value"
                        type="number"
                        min={0}
                        value={filters.maxValueEur}
                        onChange={(event) =>
                          setFilters({ ...filters, maxValueEur: event.target.value })
                        }
                      />
                    </div>
                  </div>
                </fieldset>

                <fieldset className="feed-filter-group">
                  <legend>Where &amp; who</legend>
                  <div className="feed-filter-fields">
                    <div className="form-field">
                      <label htmlFor="filter-country">Country</label>
                      <select
                        id="filter-country"
                        value={useCustomCountry ? '__other__' : filters.country}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (value === '__other__') {
                            setUseCustomCountry(true);
                            return;
                          }
                          setUseCustomCountry(false);
                          setFilters({ ...filters, country: value });
                        }}
                      >
                        <option value="">Any</option>
                        {countryOptions.map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                        <option value="__other__">Other (enter code)…</option>
                      </select>
                    </div>
                    {useCustomCountry && (
                      <div className="form-field">
                        <label htmlFor="filter-country-custom">2-letter country code</label>
                        <input
                          id="filter-country-custom"
                          maxLength={2}
                          value={filters.country}
                          onChange={(event) =>
                            setFilters({ ...filters, country: event.target.value.toUpperCase() })
                          }
                        />
                      </div>
                    )}
                    <div className="form-field">
                      <label htmlFor="filter-cpv">CPV prefix</label>
                      <input
                        id="filter-cpv"
                        value={filters.cpvPrefix}
                        onChange={(event) =>
                          setFilters({ ...filters, cpvPrefix: event.target.value })
                        }
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="filter-buyer">Buyer</label>
                      <input
                        id="filter-buyer"
                        value={filters.buyerName}
                        onChange={(event) =>
                          setFilters({ ...filters, buyerName: event.target.value })
                        }
                      />
                    </div>
                  </div>
                </fieldset>

                <fieldset className="feed-filter-group">
                  <legend>Dates</legend>
                  <div className="feed-filter-fields">
                    <div className="form-field">
                      <label htmlFor="filter-deadline">Deadline before</label>
                      <input
                        id="filter-deadline"
                        type="date"
                        value={filters.deadlineBefore}
                        onChange={(event) =>
                          setFilters({ ...filters, deadlineBefore: event.target.value })
                        }
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="filter-deadline-after">Deadline after</label>
                      <input
                        id="filter-deadline-after"
                        type="date"
                        value={filters.deadlineAfter}
                        onChange={(event) =>
                          setFilters({ ...filters, deadlineAfter: event.target.value })
                        }
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="filter-published-after">Published after</label>
                      <input
                        id="filter-published-after"
                        type="date"
                        value={filters.publishedAfter}
                        onChange={(event) =>
                          setFilters({ ...filters, publishedAfter: event.target.value })
                        }
                      />
                    </div>
                  </div>
                </fieldset>

                <div className="feed-filter-actions">
                  <button className="cta" type="submit">
                    Apply filters
                  </button>
                  <button type="button" className="btn-quiet btn-sm" onClick={clearFilters}>
                    Clear all
                  </button>
                </div>
              </form>
            </details>

            <p role="status" aria-live="polite" className="visually-hidden-status">
              {statusMessage}
            </p>
            {statusMessage !== null && (
              <div className="app-toast" aria-hidden="true">
                {statusMessage}
              </div>
            )}

            {loading && (
              <ul className="feed-skeleton-list" aria-hidden="true">
                <li className="feed-skeleton-card" />
                <li className="feed-skeleton-card" />
                <li className="feed-skeleton-card" />
              </ul>
            )}
            {error !== null && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {!loading && error === null && state !== null && state.items.length === 0 && (
              <div className="feed-empty">
                <span className="feed-empty__glyph" aria-hidden="true" />
                {isShelfTab ? (
                  <p className="feed-empty__title">
                    {tab === 'saved'
                      ? 'Nothing saved yet — use Save on a tender you want to come back to.'
                      : 'Nothing ignored yet — use Ignore to keep a tender out of your review queue.'}
                  </p>
                ) : activeFilterCount > 0 ? (
                  <>
                    <p className="feed-empty__title">No matches with these filters.</p>
                    <div className="feed-empty__actions">
                      <button type="button" className="btn-quiet" onClick={clearFilters}>
                        Clear filters
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="feed-empty__title">
                      No matches yet — ingestion and matching run daily.
                    </p>
                    <p className="feed-empty__body">Your next chance: tomorrow.</p>
                    <div className="feed-empty__actions">
                      <a className="btn-quiet" href="/app/settings#matching-profile">
                        Widen CPV preferences in Settings
                      </a>
                    </div>
                  </>
                )}
              </div>
            )}
            {!loading && state !== null && state.items.length > 0 && (
              <>
                <ul className="tender-list">
                  {state.items.map((item) => (
                    <li key={item.matchId}>
                      <TenderCard
                        item={item}
                        now={now}
                        onSave={(id, s) => void handleSave(id, s)}
                        onIgnore={(id, i) => void handleIgnore(id, i)}
                      />
                    </li>
                  ))}
                </ul>
                {state.nextCursor !== null && (
                  <button
                    type="button"
                    className="btn-quiet"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                  >
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
