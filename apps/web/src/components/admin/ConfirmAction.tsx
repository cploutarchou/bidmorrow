import { useId, useState, type ReactElement } from 'react';
import { confirmationMatches } from '../../lib/admin-confirm';

/**
 * Dangerous-action confirmation control shared by every admin mutation
 * (suspend/unsuspend, pause/resume, scope/backfill, recompute, flag update)
 * — renders the exact confirm string the API contract requires (see
 * apps/worker/src/routes/admin.ts CONFIRMATION PATTERN doc comment) and
 * disables the action button until the typed text matches exactly. Not a
 * security boundary — the server independently requires the same literal in
 * the request body and would reject a mismatch regardless.
 */
export function ConfirmAction({
  label,
  confirmText,
  busy = false,
  onConfirm,
  variant = 'default',
}: {
  label: string;
  confirmText: string;
  busy?: boolean;
  onConfirm: () => void;
  variant?: 'default' | 'danger';
}): ReactElement {
  const [typed, setTyped] = useState('');
  const inputId = useId();
  const matches = confirmationMatches(confirmText, typed);

  return (
    <div className="admin-confirm">
      <label htmlFor={inputId}>
        Type <code>{confirmText}</code> to confirm
      </label>
      <div className="admin-confirm__row">
        <input
          id={inputId}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
        />
        <button
          type="button"
          className={variant === 'danger' ? 'danger' : ''}
          disabled={!matches || busy}
          onClick={() => {
            onConfirm();
            setTyped('');
          }}
        >
          {busy ? 'Working…' : label}
        </button>
      </div>
    </div>
  );
}
