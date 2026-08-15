import { useEffect, useState, type ReactElement } from 'react';
import { useParams } from 'react-router';
import { api } from '../../lib/api';
import {
  componentStatusLabel,
  formatOriginalValue,
  formatRelativeDeadline,
  riskConfidenceLabel,
} from '../../lib/format';
import { ScoreBadge } from '../../components/ScoreBadge';
import {
  FEEDBACK_REASON_LABELS,
  type FeedbackReason,
  type TenderDetailResponse,
} from '../../lib/types';

export function TenderDetail(): ReactElement {
  const { matchId } = useParams<{ matchId: string }>();
  const [detail, setDetail] = useState<TenderDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showNotUseful, setShowNotUseful] = useState(false);
  const [reasons, setReasons] = useState<FeedbackReason[]>([]);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (matchId === undefined) return;
    api
      .get<TenderDetailResponse>(`/api/org/tenders/${matchId}`)
      .then(setDetail)
      .catch(() =>
        setError('Could not load this tender. It may no longer be available to your organization.'),
      );
  }, [matchId]);

  async function toggleSave(): Promise<void> {
    if (detail === null || matchId === undefined) return;
    const nextSaved = !detail.savedByYou;
    setDetail({ ...detail, savedByYou: nextSaved });
    try {
      await api.post(`/api/org/tenders/${matchId}/${nextSaved ? 'save' : 'unsave'}`);
      setStatusMessage(nextSaved ? 'Saved.' : 'Removed from saved.');
    } catch {
      setDetail({ ...detail, savedByYou: !nextSaved });
      setStatusMessage('Could not update — please try again.');
    }
  }

  async function toggleIgnore(): Promise<void> {
    if (detail === null || matchId === undefined) return;
    const nextIgnored = !detail.ignoredByYou;
    setDetail({ ...detail, ignoredByYou: nextIgnored });
    try {
      await api.post(`/api/org/tenders/${matchId}/${nextIgnored ? 'ignore' : 'unignore'}`);
      setStatusMessage(nextIgnored ? 'Ignored.' : 'Removed from ignored.');
    } catch {
      setDetail({ ...detail, ignoredByYou: !nextIgnored });
      setStatusMessage('Could not update — please try again.');
    }
  }

  async function submitFeedback(verdict: 'useful' | 'not_useful'): Promise<void> {
    if (matchId === undefined) return;
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

  if (error !== null) {
    return (
      <p role="alert" className="form-error">
        {error}
      </p>
    );
  }

  if (detail === null) {
    return <p>Loading…</p>;
  }

  const now = Date.now();

  return (
    <article className="tender-detail">
      <title>{`${detail.lot.title} — BidMorrow`}</title>
      <ScoreBadge score={detail.match.score} classification={detail.match.classification} />
      <h1>{detail.lot.title}</h1>
      {detail.lot.lotNumber !== null && <p>Lot {detail.lot.lotNumber}</p>}
      <dl className="detail-facts">
        <div>
          <dt>Buyer</dt>
          <dd>{detail.buyerName ?? 'Not published'}</dd>
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
          <dt>Deadline</dt>
          <dd>{formatRelativeDeadline(detail.lot.deadlineAt, now)}</dd>
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
          <h2>Description</h2>
          <p className="notice-description">{detail.lot.description}</p>
        </section>
      )}

      <section>
        <h2>Score breakdown</h2>
        {detail.explanationNote !== null && <p>{detail.explanationNote}</p>}
        {detail.components.length > 0 && (
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
                  <th scope="row">{component.componentKey}</th>
                  <td>
                    {component.points} / {component.maxPoints}
                  </td>
                  <td>{componentStatusLabel(component.status)}</td>
                  <td>{component.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {detail.riskFlags.length > 0 && (
        <section>
          <h2>Risk flags</h2>
          <ul>
            {detail.riskFlags.map((flag, index) => (
              <li key={`${flag.type}-${index}`}>
                ⚠ {flag.explanation} — {riskConfidenceLabel(flag.confidence)}
                <br />
                <em>
                  Evidence: "{flag.evidence}" ({flag.sourceField})
                </em>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p role="status" aria-live="polite" className="visually-hidden-status">
        {statusMessage}
      </p>

      <div className="tender-detail__actions">
        <button type="button" aria-pressed={detail.savedByYou} onClick={() => void toggleSave()}>
          {detail.savedByYou ? 'Saved' : 'Save'}
        </button>
        <button
          type="button"
          aria-pressed={detail.ignoredByYou}
          onClick={() => void toggleIgnore()}
        >
          {detail.ignoredByYou ? 'Ignored' : 'Ignore'}
        </button>
        <button type="button" onClick={() => void submitFeedback('useful')}>
          Useful
        </button>
        <button type="button" onClick={() => setShowNotUseful((v) => !v)}>
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
          <fieldset>
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
            <label htmlFor="feedback-comment">
              Additional comment (optional, max 500 characters)
            </label>
            <textarea
              id="feedback-comment"
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

      <p>
        <a href={detail.notice.sourceUrl} target="_blank" rel="noopener noreferrer" className="cta">
          Open original TED notice
        </a>
      </p>
      <p className="ted-attribution">
        Source of procurement notices: Tenders Electronic Daily (TED), Publications Office of the
        European Union.
      </p>
    </article>
  );
}
