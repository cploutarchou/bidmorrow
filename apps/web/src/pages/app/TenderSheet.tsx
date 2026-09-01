import '../../styles/app.css';
import { useCallback, useId, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router';
import { DetailSheet } from '../../components/DetailSheet';
import { TenderDetailContent } from '../../components/TenderDetailContent';

/**
 * The `/app/tenders/:matchId` route as a slide-over, used when it was opened
 * from the feed (App.tsx renders this instead of the full page when the
 * navigation carried a `backgroundLocation`).
 *
 * Closing is `navigate(-1)` rather than a push to `/app`: the sheet was
 * reached by a push, so going back both restores the exact feed state
 * underneath (scroll position, loaded pages, active tab) and leaves no
 * dead entry in the history for Back to land on afterwards.
 */
export function TenderSheet(): ReactElement | null {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const headingId = useId();

  const close = useCallback(() => {
    void navigate(-1);
  }, [navigate]);

  if (matchId === undefined) return null;

  return (
    <DetailSheet onClose={close} labelledBy={headingId}>
      <TenderDetailContent
        matchId={matchId}
        variant="sheet"
        headingId={headingId}
        onClose={close}
      />
    </DetailSheet>
  );
}
