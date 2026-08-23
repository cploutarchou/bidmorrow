import { useId, type ReactElement } from 'react';
import { Link, useParams } from 'react-router';
import { TenderDetailContent } from '../../components/TenderDetailContent';

/**
 * Full-page tender detail — what a shared link, a bookmark or a refresh
 * lands on.
 *
 * Opening the same tender from the feed renders `TenderSheet` over the feed
 * instead (App.tsx). Both surfaces render the SAME `TenderDetailContent`, so
 * there is no second copy of the detail to drift out of step; this file only
 * supplies the page frame and the way back.
 */
export function TenderDetail(): ReactElement {
  const { matchId } = useParams<{ matchId: string }>();
  const headingId = useId();

  if (matchId === undefined) {
    return (
      <p role="alert" className="form-error">
        No tender was specified.
      </p>
    );
  }

  return (
    <article className="tender-detail">
      <Link className="tender-detail__breadcrumb" to="/app">
        ← Feed
      </Link>
      <TenderDetailContent matchId={matchId} variant="page" headingId={headingId} />
    </article>
  );
}
