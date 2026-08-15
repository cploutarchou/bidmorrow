import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { api, ApiError } from '../../lib/api';
import { appendCursor, startCursor, type CursorState } from '../../lib/cursor';
import type { FeedResponse, FeedRow } from '../../lib/types';
import { TenderCard } from '../../components/TenderCard';

type Tab = 'today' | 'strong' | 'worth_reviewing' | 'possible' | 'saved' | 'ignored';

const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: "Today's matches" },
  { id: 'strong', label: 'Strong' },
  { id: 'worth_reviewing', label: 'Worth reviewing' },
  { id: 'possible', label: 'Possible' },
  { id: 'saved', label: 'Saved' },
  { id: 'ignored', label: 'Ignored' },
];

interface Filters {
  minScore: string;
  country: string;
  cpvPrefix: string;
  buyerName: string;
  minValueEur: string;
  maxValueEur: string;
  deadlineBefore: string;
}

const EMPTY_FILTERS: Filters = {
  minScore: '',
  country: '',
  cpvPrefix: '',
  buyerName: '',
  minValueEur: '',
  maxValueEur: '',
  deadlineBefore: '',
};

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
  if (cursor !== undefined) params.set('cursor', cursor);
  return params.toString();
}

export function Feed(): ReactElement {
  const [tab, setTab] = useState<Tab>('today');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [state, setState] = useState<CursorState<FeedRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const now = Date.now();

  const load = useCallback(async (nextTab: Tab, nextFilters: Filters) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<FeedResponse>(
        `/api/org/feed?${buildQuery(nextTab, nextFilters, undefined)}`,
      );
      setState(startCursor(res));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) {
        setError('Complete onboarding to see your feed.');
      } else {
        setError('Could not load your feed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Intentionally re-runs only when the tab changes — filters are applied
    // explicitly via the "Apply filters" submit, not on every keystroke.
    void load(tab, filters);
    // filters/load are deliberately excluded from deps for the reason above.
  }, [tab]);

  async function loadMore(): Promise<void> {
    if (state === null || state.nextCursor === null) return;
    setLoadingMore(true);
    try {
      const res = await api.get<FeedResponse>(
        `/api/org/feed?${buildQuery(tab, filters, state.nextCursor)}`,
      );
      setState((prev) => (prev === null ? startCursor(res) : appendCursor(prev, res)));
    } finally {
      setLoadingMore(false);
    }
  }

  function onFilterSubmit(): void {
    void load(tab, filters);
  }

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

  return (
    <>
      <h1>What should you investigate today?</h1>
      <div role="tablist" aria-label="Feed tabs" className="tab-list">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'tab tab--active' : 'tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <form
        className="filter-bar"
        onSubmit={(event) => {
          event.preventDefault();
          onFilterSubmit();
        }}
      >
        <div className="form-field">
          <label htmlFor="filter-min-score">Minimum score</label>
          <input
            id="filter-min-score"
            type="number"
            min={0}
            max={100}
            value={filters.minScore}
            onChange={(event) => setFilters({ ...filters, minScore: event.target.value })}
          />
        </div>
        <div className="form-field">
          <label htmlFor="filter-country">Country</label>
          <input
            id="filter-country"
            maxLength={2}
            value={filters.country}
            onChange={(event) =>
              setFilters({ ...filters, country: event.target.value.toUpperCase() })
            }
          />
        </div>
        <div className="form-field">
          <label htmlFor="filter-cpv">CPV prefix</label>
          <input
            id="filter-cpv"
            value={filters.cpvPrefix}
            onChange={(event) => setFilters({ ...filters, cpvPrefix: event.target.value })}
          />
        </div>
        <div className="form-field">
          <label htmlFor="filter-buyer">Buyer</label>
          <input
            id="filter-buyer"
            value={filters.buyerName}
            onChange={(event) => setFilters({ ...filters, buyerName: event.target.value })}
          />
        </div>
        <div className="form-field">
          <label htmlFor="filter-min-value">Min value (EUR)</label>
          <input
            id="filter-min-value"
            type="number"
            min={0}
            value={filters.minValueEur}
            onChange={(event) => setFilters({ ...filters, minValueEur: event.target.value })}
          />
        </div>
        <div className="form-field">
          <label htmlFor="filter-max-value">Max value (EUR)</label>
          <input
            id="filter-max-value"
            type="number"
            min={0}
            value={filters.maxValueEur}
            onChange={(event) => setFilters({ ...filters, maxValueEur: event.target.value })}
          />
        </div>
        <div className="form-field">
          <label htmlFor="filter-deadline">Deadline before</label>
          <input
            id="filter-deadline"
            type="date"
            value={filters.deadlineBefore}
            onChange={(event) => setFilters({ ...filters, deadlineBefore: event.target.value })}
          />
        </div>
        <button className="cta" type="submit">
          Apply filters
        </button>
      </form>

      <p role="status" aria-live="polite" className="visually-hidden-status">
        {statusMessage}
      </p>

      {loading && <p>Loading your feed…</p>}
      {error !== null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!loading && error === null && state !== null && state.items.length === 0 && (
        <p>
          No matches yet — ingestion runs daily. Check back tomorrow, or widen your CPV preferences
          in Settings.
        </p>
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
            <button type="button" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </>
  );
}
