import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { api } from '../lib/api';
import {
  componentLabel,
  componentStatusLabel,
  formatOriginalValue,
  formatRelativeDeadline,
  riskConfidenceLabel,
} from '../lib/format';
import { publishMatchUpdate } from '../lib/match-events';
import { ScoreBadge } from './ScoreBadge';
import {
  FEEDBACK_REASON_LABELS,
  type FeedbackReason,
  type TenderDetailResponse,
} from '../lib/types';

/**
 * One tender's detail, rendered identically by the full page
 * (`/app/tenders/:matchId`) and by the slide-over sheet.
 *
 * Both surfaces exist on purpose — the sheet for reading beside the feed, the
 * page for a shared link or a refresh — and the content must not drift between
 * them, so there is exactly one implementation and the surface only chooses
 * the frame.
 *
 * TABS. The handoff design gives the sheet five: Summary, Requirements, Score,
 * Buyer, Activity. Only two of those can be filled from what BidMorrow
 * actually knows. Requirements presupposes document extraction, Buyer
 * presupposes buyer award history, and Activity presupposes team notes — none
 * of which exist in the V1 TED-only backend (recorded as the owner-gated item
 * in docs/redesign/template-conversion-audit.md). Rendering them empty, or
 * worse populated with plausible-looking placeholders, would be a claim about
 * the product that is not true, so they are absent rather than stubbed.
 */

type Tab = 'summary' | 'score';

const TABS: { readonly id: Tab; readonly label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'score', label: 'Score' },
];

export function TenderDetailContent({
  matchId,
  variant,
  headingId,
  onClose,
}: {
  matchId: string;
  variant: 'page' | 'sheet';
  /** Used by the sheet to label its dialog; the page just needs it unique. */
  headingId: string;
  onClose?: () => void;
}): ReactElement {
  const [detail, setDetail] = useState<TenderDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showNotUseful, setShowNotUseful] = useState(false);
  const [reasons, setReasons] = useState<FeedbackReason[]>([]);
  const [comment, setComment] = useState('');
  const [tab, setTab] = useState<Tab>('summary');
  const tablistRef = useRef<HTMLDivElement>(null);
  const idPrefix = useId();

  // Transient toast auto-clear (docs/redesign/app-interface-spec.md §8.2) —
  // purely visual; the accessible `role="status"` live region below reads
  // `statusMessage` independently and is unaffected by this timeout.
  useEffect(() => {
    if (statusMessage === null) return;
    const timeout = window.setTimeout(() => setStatusMessage(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    setTab('summary');
    api
      .get<TenderDetailResponse>(`/api/org/tenders/${matchId}`)
      .then((next) => {
        if (!cancelled) setDetail(next);
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            'Could not load this tender. It may no longer be available to your organization.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  async function toggleSave(): Promise<void> {
    if (detail === null) return;
    const nextSaved = !detail.savedByYou;
    setDetail({ ...detail, savedByYou: nextSaved });
    try {
      await api.post(`/api/org/tenders/${matchId}/${nextSaved ? 'save' : 'unsave'}`);
      setStatusMessage(nextSaved ? 'Saved.' : 'Removed from saved.');
      // Keeps the feed card behind the sheet honest (lib/match-events.ts).
      publishMatchUpdate({ matchId, savedByYou: nextSaved });
    } catch {
      setDetail({ ...detail, savedByYou: !nextSaved });
      setStatusMessage('Could not update — please try again.');
    }
  }

  async function toggleIgnore(): Promise<void> {
    if (detail === null) return;
    const nextIgnored = !detail.ignoredByYou;
    setDetail({ ...detail, ignoredByYou: nextIgnored });
    try {
      await api.post(`/api/org/tenders/${matchId}/${nextIgnored ? 'ignore' : 'unignore'}`);
      setStatusMessage(nextIgnored ? 'Ignored.' : 'Removed from ignored.');
      publishMatchUpdate({ matchId, ignoredByYou: nextIgnored });
    } catch {
      setDetail({ ...detail, ignoredByYou: !nextIgnored });
      setStatusMessage('Could not update — please try again.');
    }
  }

  async function submitFeedback(verdict: 'useful' | 'not_useful'): Promise<void> {
    try {
      await api.post(`/api/org/tenders/${matchId}/feedback`, {
        verdict,
        ...(verdict === 'not_useful'
          ? { reasons, comment: comment.length > 0 ? comment : null }
          : {}),
      });
      setStatusMessage('Thanks — feedback recorded.');
      setShowNotUseful(false);
    } catch {
      setStatusMessage('Could not record feedback — please try again.');
    }
  }

  /** Roving tabs: Left/Right move and activate, Home/End jump to the ends. */
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

  if (error !== null) {
    return (
      <div className="sheet-body">
        <p role="alert" className="form-error">
          {error}
        </p>
        {onClose !== undefined && (
          <button type="button" className="btn-quiet" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="sheet-body">
        <div className="feed-skeleton-list" aria-hidden="true">
          <div className="feed-skeleton-card" />
          <div className="feed-skeleton-card" />
        </div>
        {/* The heading the dialog is labelled by must exist even while
            loading, or the sheet announces itself as unnamed. */}
        <h2 id={headingId} className="visually-hidden-status">
          Loading tender
        </h2>
      </div>
    );
  }

  const now = Date.now();
  const Heading = variant === 'page' ? 'h1' : 'h2';
  const sourceIsHttps = detail.notice.sourceUrl.startsWith('https://');

  return (
    <>
      {variant === 'page' && <title>{`${detail.lot.title} — BidMorrow`}</title>}

      <header className="sheet-head">
        <div className="sheet-head__id">
          <ScoreBadge score={detail.match.score} classification={detail.match.classification} />
          <span className="sheet-head__deadline num">
            {formatRelativeDeadline(detail.lot.deadlineAt, now)}
          </span>
        </div>
        {onClose !== undefined && (
          <button
            type="button"
            className="sheet-close"
            aria-label="Close tender detail"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </header>

      <Heading id={headingId} className="sheet-title">
        {detail.lot.title}
      </Heading>
      <p className="sheet-meta">
        {detail.buyerName ?? 'Buyer not published'}
        {detail.lot.lotNumber !== null ? ` · Lot ${detail.lot.lotNumber}` : ''} ·{' '}
        {formatOriginalValue(detail.lot.estimatedValueAmount, detail.lot.estimatedValueCurrency)}
      </p>

      <div
        className="sheet-tabs"
        role="tablist"
        aria-label="Tender detail sections"
        ref={tablistRef}
        onKeyDown={onTabKeyDown}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className="sheet-tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <div
          role="tabpanel"
          id={`${idPrefix}-panel-summary`}
          aria-labelledby={`${idPrefix}-tab-summary`}
          tabIndex={0}
          className="sheet-panel-body"
        >
          <dl className="detail-facts">
            <div>
              <dt>Deadline</dt>
              <dd>{formatRelativeDeadline(detail.lot.deadlineAt, now)}</dd>
            </div>
            <div>
              <dt>Value</dt>
              <dd>
                {formatOriginalValue(
                  detail.lot.estimatedValueAmount,
                  detail.lot.estimatedValueCurrency,
                )}
              </dd>
            </div>
            <div>
              <dt>Buyer</dt>
              <dd>{detail.buyerName ?? 'Not published'}</dd>
            </div>
            <div>
              <dt>Geography</dt>
              <dd>
                {detail.lot.geographies.length > 0
                  ? detail.lot.geographies
                      .map((g) => g.nutsCode ?? g.countryCode ?? 'Unknown')
                      .join(', ')
                  : 'Not published'}
              </dd>
            </div>
            <div>
              <dt>Contract nature</dt>
              <dd>{detail.lot.contractNature ?? 'Not published'}</dd>
            </div>
            <div>
              <dt>Procedure</dt>
              <dd>{detail.notice.procedureType ?? 'Not published'}</dd>
            </div>
            <div>
              <dt>CPV codes</dt>
              <dd>
                {detail.lot.cpvCodes
                  .map((c) => (c.isMain ? `${c.cpvCode} (main)` : c.cpvCode))
                  .join(', ')}
              </dd>
            </div>
            {detail.notice.languages.length > 0 && (
              <div>
                <dt>Source language(s)</dt>
                <dd>{detail.notice.languages.join(', ')}</dd>
              </div>
            )}
          </dl>

          {detail.lot.description !== null && (
            <section>
              <h3>Description</h3>
              <p className="notice-description">{detail.lot.description}</p>
            </section>
          )}

          {detail.riskFlags.length > 0 && (
            <section>
              <h3>Risk flags</h3>
              <ul className="risk-flags">
                {detail.riskFlags.map((flag, index) => (
                  <li key={`${flag.type}-${index}`} className="risk-flag">
                    <p className="risk-flag__headline">
                      ⚠ {flag.explanation} — {riskConfidenceLabel(flag.confidence)}
                    </p>
                    <p className="risk-flag__evidence">
                      Evidence: "{flag.evidence}" ({flag.sourceField})
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* SEC-P7-05: sourceUrl is untrusted TED-sourced data — only render an
              actual clickable link when it is a genuine https:// URL, never a
              javascript:/data: or other scheme, otherwise show it as plain text. */}
          {sourceIsHttps ? (
            <p>
              <a
                href={detail.notice.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="cta"
              >
                Open original TED notice <span aria-hidden="true">↗</span>
              </a>
            </p>
          ) : (
            <p>Original TED notice link unavailable ({detail.notice.sourceUrl})</p>
          )}
        </div>
      )}

      {tab === 'score' && (
        <div
          role="tabpanel"
          id={`${idPrefix}-panel-score`}
          aria-labelledby={`${idPrefix}-tab-score`}
          tabIndex={0}
          className="sheet-panel-body"
        >
          <section className="score-anatomy">
            <h3>Score breakdown</h3>
            {detail.explanationNote !== null && <p>{detail.explanationNote}</p>}
            {detail.components.length > 0 ? (
              <table>
                <caption>Score component breakdown</caption>
                <thead>
                  <tr>
                    <th scope="col">Component</th>
                    <th scope="col">Points</th>
                    <th scope="col">Status</th>
                    <th scope="col">Explanation</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.components.map((component) => (
                    <tr key={component.componentKey}>
                      <th scope="row">{componentLabel(component.componentKey)}</th>
                      <td className="num">
                        {/* Native <progress>, never an inline `style` width — CSP is
                            `style-src 'self'` with no unsafe-inline; the fill is
                            styled entirely via ::-webkit-progress-value/
                            ::-moz-progress-bar in styles.css. */}
                        <progress
                          className="score-bar score-bar--inline"
                          value={component.points}
                          max={component.maxPoints > 0 ? component.maxPoints : 1}
                          aria-hidden="true"
                        />
                        {component.points} / {component.maxPoints}
                      </td>
                      <td>{componentStatusLabel(component.status)}</td>
                      <td>{component.explanation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>No score breakdown is available for this match.</p>
            )}
          </section>
        </div>
      )}

      <p role="status" aria-live="polite" className="visually-hidden-status">
        {statusMessage}
      </p>
      {statusMessage !== null && (
        <div className="app-toast" aria-hidden="true">
          {statusMessage}
        </div>
      )}

      {/* Actions apply to the tender, not to a tab, so they sit outside the
          panels and stay reachable from either one. */}
      <div className="tender-detail__actions">
        <button
          type="button"
          className="btn-quiet"
          aria-pressed={detail.savedByYou}
          onClick={() => void toggleSave()}
        >
          {detail.savedByYou ? 'Saved' : 'Save'}
        </button>
        <button
          type="button"
          className="btn-quiet"
          aria-pressed={detail.ignoredByYou}
          onClick={() => void toggleIgnore()}
        >
          {detail.ignoredByYou ? 'Ignored' : 'Ignore'}
        </button>
        <button type="button" className="btn-quiet" onClick={() => void submitFeedback('useful')}>
          Useful
        </button>
        <button
          type="button"
          className="btn-quiet"
          aria-expanded={showNotUseful}
          onClick={() => setShowNotUseful((v) => !v)}
        >
          Not useful
        </button>
      </div>

      {showNotUseful && (
        <form
          className="feedback-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitFeedback('not_useful');
          }}
        >
          <fieldset className="field-group">
            <legend>Why isn't this useful?</legend>
            {(Object.keys(FEEDBACK_REASON_LABELS) as FeedbackReason[]).map((reason) => (
              <label key={reason} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={reasons.includes(reason)}
                  onChange={() =>
                    setReasons((rs) =>
                      rs.includes(reason) ? rs.filter((r) => r !== reason) : [...rs, reason],
                    )
                  }
                />
                {FEEDBACK_REASON_LABELS[reason]}
              </label>
            ))}
          </fieldset>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-comment`}>
              Additional comment (optional, max 500 characters)
            </label>
            <textarea
              id={`${idPrefix}-comment`}
              maxLength={500}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </div>
          <button className="cta" type="submit">
            Submit feedback
          </button>
        </form>
      )}

      <p className="ted-attribution">
        Source of procurement notices: Tenders Electronic Daily (TED), Publications Office of the
        European Union.
      </p>
    </>
  );
}
