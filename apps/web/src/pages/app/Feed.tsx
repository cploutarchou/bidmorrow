import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { DEFAULT_FEED_VIEW, parseFeedView, type FeedView } from '../../lib/feed-view';
import { appendCursor, startCursor, type CursorState } from '../../lib/cursor';
import { useCountUp, useMediaQuery } from '../../lib/motion';
import type { FeedResponse, FeedRow } from '../../lib/types';
import { subscribeToMatchUpdates } from '../../lib/match-events';
import { FeedRail } from '../../components/FeedRail';
import type { SavedSearch } from '../../lib/saved-searches';
import type { OrgProfileResponse } from '../../lib/onboarding-types';
import { TenderCard } from '../../components/TenderCard';
import { SubscriptionRequiredNotice } from '../../components/SubscriptionRequiredNotice';
import { EmptyFeed, EmptyIgnored, EmptySaved } from '../../assets';

/** One KPI tile's number, counting up on mount/refetch (instant under
 *  `prefers-reduced-motion`, see lib/motion.ts). A tiny component of its
 *  own so the hook (one count-up sequence per tile) is only invoked where
 *  a number is actually rendered, not once per Feed render.
 *
 * `.feed-stat dd` is a flex row (`app.css`) with this number and its
 * `.feed-stat__note` sibling side by side, so as the count-up climbs from
 * 0 to `value` the digit count (and therefore this span's own width)
 * grows over the ~900ms animation, pushing the note sideways on every
 * digit gained (layout shift, CLS, with no user input, well after first
 * paint). `--kpi-w` reserves the FINAL digit count's width up front, via
 * a `useLayoutEffect` CSSOM property write (same CSP-safe convention as
 * `lib/use-tilt.ts`: a property write, never an inline `style=`) that
 * commits before the browser's first paint, so the box is always at its
 * settled width and only the digits inside it change. */
function KpiValue({ value }: { value: number }): ReactElement {
  const displayed = useCountUp(value);
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    ref.current?.style.setProperty('--kpi-w', `${String(Math.round(value)).length}ch`);
  }, [value]);
  return (
    <span className="num kpi-num" ref={ref}>
      {Math.round(displayed)}
    </span>
  );
}

type Tab = FeedView;

/**
 * Fix for C5 (docs/redesign/ux-strategy.md §5.1): the score-band views and
 * the "your shelves" views are a different kind of thing, not six equal
 * tabs, split so a 390px screen never needs a scrolling segmented
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

/** Mirrors the worker's `sort` enum (apps/worker/src/routes/feed.ts). */
type Sort = 'fit' | 'deadline' | 'value' | 'newest';

const SORT_OPTIONS: { id: Sort; label: string }[] = [
  { id: 'fit', label: 'Fit score' },
  { id: 'deadline', label: 'Deadline soonest' },
  { id: 'value', label: 'Value highest' },
  { id: 'newest', label: 'Newest' },
];

/** `GET /api/org/feed/stats`: each count is what the matching tab shows. */
interface FeedStats {
  newToday: number;
  closingSoon: number;
  strong: number;
  saved: number;
}

function buildQuery(tab: Tab, filters: Filters, sort: Sort, cursor: string | undefined): string {
  const params = new URLSearchParams({ tab });
  if (sort !== 'fit') params.set('sort', sort);
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

/** Minimal shape read from `/api/billing/status` for the 402 notice; see Settings.tsx for the full DTO. */
interface FoundingAvailability {
  foundingAvailable: boolean;
}

export function Feed(): ReactElement {
  const navigate = useNavigate();
  // The URL is the single source of truth for the active view: `?view=`
  // makes shelves linkable (header "Saved" link, bookmarks, reload) and a
  // tab click writes it back with `replace` so history is not spammed.
  // Deriving `tab` from the URL (rather than mirroring URL <-> state with
  // two effects) is what keeps an external navigation from ping-ponging.
  const compactStats = useMediaQuery('(max-width: 40rem)');
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = parseFeedView(searchParams.get('view'));
  const setTab = useCallback(
    (next: Tab): void => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          if (next === DEFAULT_FEED_VIEW) params.delete('view');
          else params.set('view', next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const [sort, setSort] = useState<Sort>('fit');
  const tablistRef = useRef<HTMLDivElement>(null);

  /** Roving tabs (same model as the detail sheet's tablist): the active tab
     is the single tab stop; Left/Right move and activate, Home/End jump to
     the ends. Without this, six tabs were six Tab presses between the rail
     and the filters. */
  function onTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const index = TABS.findIndex((t) => t.id === tab);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = TABS[nextIndex];
    if (next === undefined) return;
    setTab(next.id);
    tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
  }
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
  const [stats, setStats] = useState<FeedStats | null>(null);
  const now = Date.now();

  // KPI strip (prototype's stat tiles, restricted to counts the product can
  // actually back: each tile is "what the matching tab shows"). An
  // accelerator like the rail's profile line: a failure hides the row and
  // must never disturb the feed (a non-entitled org's 402 lands here too;
  // the feed request renders the real paywall state).
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ stats: FeedStats }>('/api/org/feed/stats')
      .then((res) => {
        if (!cancelled) setStats(res.stats);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The rail's profile line. Built from what the profile actually holds,
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
    setTab(parseFeedView(search.tab));
    setUseCustomCountry(next.country.length > 0 && !countryOptions.includes(next.country));
    // Saved searches predate the sort control and store no order, so applying
    // one resets to the default fit ordering rather than inheriting whatever
    // sort happens to be active.
    setSort('fit');
    void load(parseFeedView(search.tab), next, 'fit');
  }

  // Transient toast auto-clear (docs/redesign/app-interface-spec.md §8.2) is
  // purely visual; the accessible `role="status"` live region below reads
  // `statusMessage` independently and is unaffected by this timeout.
  useEffect(() => {
    if (statusMessage === null) return;
    const timeout = window.setTimeout(() => setStatusMessage(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  // Best-effort: populates the country filter's known-value select from the
  // org's own saved opportunity/served countries (fix for C8: a bare
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
  // switch's fetch; both legitimate requests, but only the response for
  // the CURRENTLY selected tab/filters should ever be committed to state).
  const latestRequestId = useRef(0);

  const load = useCallback(
    async (nextTab: Tab, nextFilters: Filters, nextSort: Sort) => {
      const requestId = latestRequestId.current + 1;
      latestRequestId.current = requestId;
      setLoading(true);
      setError(null);
      setSubscriptionRequired(null);
      try {
        const res = await api.get<FeedResponse>(
          `/api/org/feed?${buildQuery(nextTab, nextFilters, nextSort, undefined)}`,
        );
        if (latestRequestId.current !== requestId) return; // superseded by a newer request
        setState(startCursor(res));
      } catch (cause) {
        if (latestRequestId.current !== requestId) return; // superseded by a newer request
        if (cause instanceof ApiError && cause.status === 403) {
          const body = cause.body as { error?: string } | null;
          // R2 (docs/redesign/ux-strategy.md §1.3): a brand-new user who never
          // created an organization is auto-routed to /onboarding instead of
          // dead-ending on this page, the single worst moment in the product
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
            setError('This organization is currently suspended. Contact support for help.');
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
    // Intentionally re-runs only when the tab changes; filters and sort are
    // applied explicitly by their own handlers, not on every keystroke.
    void load(tab, filters, sort);
    // filters/sort/load are deliberately excluded from deps for the reason above.
  }, [tab]);

  // Reads real founding-plan availability for the 402 notice's pricing line
  // and never a hardcoded/fake claim (docs/redesign/ux-strategy.md §5.4 truth
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
    // Same request-id guard as load(): a tab/filter/sort change that resolves
    // while this page fetch is in flight must not have stale-order rows
    // appended onto the fresh list (and vice versa: a newer load() discards
    // this response). The spinner flag itself is unconditional: it is purely
    // local UI state and must never be left stuck on a superseded response.
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await api.get<FeedResponse>(
        `/api/org/feed?${buildQuery(tab, filters, sort, state.nextCursor)}`,
      );
      if (latestRequestId.current !== requestId) return;
      setState((prev) => (prev === null ? startCursor(res) : appendCursor(prev, res)));
    } catch {
      if (latestRequestId.current !== requestId) return;
      setError('Could not load more results. Please try again.');
    } finally {
      setLoadingMore(false);
    }
  }

  function onFilterSubmit(): void {
    void load(tab, filters, sort);
  }

  function clearFilters(): void {
    setFilters(EMPTY_FILTERS);
    setUseCustomCountry(false);
    void load(tab, EMPTY_FILTERS, sort);
  }

  function onSortChange(next: Sort): void {
    setSort(next);
    void load(tab, filters, next);
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
      setStatusMessage('Could not update. Please try again.');
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
      setStatusMessage('Could not update. Please try again.');
    }
  }

  const activeFilterCount = countActiveFilters(filters);
  const isShelfTab = tab === 'saved' || tab === 'ignored';

  return (
    <>
      <title>Feed | BidMorrow</title>
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
            {/* dt/dd pairs: the note rides inside the dd (a bare <p> is
                invalid inside a <dl>'s div wrapper). */}
            {stats !== null && (
              <dl
                className="feed-stats"
                aria-label="Feed overview"
                // Below 40rem the strip is a horizontal scroll region, so it
                // must be keyboard-reachable (WCAG 2.1.1 / axe
                // scrollable-region-focusable); at wider widths it is a static
                // grid where a Tab stop would be dead weight.
                tabIndex={compactStats ? 0 : undefined}
              >
                <div className="feed-stat">
                  <dt>New today</dt>
                  <dd>
                    <KpiValue value={stats.newToday} />{' '}
                    <span className="feed-stat__note">scored in the last 24 hours</span>
                  </dd>
                </div>
                <div
                  className={stats.closingSoon > 0 ? 'feed-stat feed-stat--caution' : 'feed-stat'}
                >
                  <dt>Closing ≤ 7 days</dt>
                  <dd>
                    <KpiValue value={stats.closingSoon} />{' '}
                    <span className="feed-stat__note">deadline within a week</span>
                  </dd>
                </div>
                <div className="feed-stat">
                  <dt>Strong matches</dt>
                  <dd>
                    <KpiValue value={stats.strong} />{' '}
                    <span className="feed-stat__note">open right now</span>
                  </dd>
                </div>
                <div className="feed-stat">
                  <dt>Saved</dt>
                  <dd>
                    <KpiValue value={stats.saved} />{' '}
                    <span className="feed-stat__note">on your shelf</span>
                  </dd>
                </div>
              </dl>
            )}
            <div className="feed-view-switcher">
              <div
                role="tablist"
                aria-label="Feed tabs"
                className="feed-tabs"
                ref={tablistRef}
                onKeyDown={onTabKeyDown}
              >
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    tabIndex={tab === t.id ? 0 : -1}
                    data-group={t.group}
                    className={tab === t.id ? 'tab tab--active' : 'tab'}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="feed-sort">
                <label htmlFor="feed-sort">Sort</label>
                <select
                  id="feed-sort"
                  value={sort}
                  onChange={(event) => onSortChange(event.target.value as Sort)}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
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
                {/* One illustration per shelf/feed context, from apps/web/src/assets/empty/
                    (visual-asset-designer, same phase). Still `aria-hidden` inside the
                    component itself; the empty state's own copy is the accessible text. */}
                {tab === 'saved' ? (
                  <EmptySaved className="feed-empty__illust" />
                ) : tab === 'ignored' ? (
                  <EmptyIgnored className="feed-empty__illust" />
                ) : (
                  <EmptyFeed className="feed-empty__illust" />
                )}
                {isShelfTab ? (
                  <>
                    <p className="feed-empty__title">
                      {tab === 'saved'
                        ? 'Nothing saved yet. Use Save on a tender you want to come back to.'
                        : 'Nothing ignored yet. Use Ignore to keep a tender out of your review queue.'}
                    </p>
                    <div className="feed-empty__actions">
                      <Link className="btn-quiet" to="/app">
                        Browse today's matches
                      </Link>
                    </div>
                  </>
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
                      No matches yet. Ingestion and matching run daily.
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
