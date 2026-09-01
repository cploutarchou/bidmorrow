import { useId, useState, type ReactElement } from 'react';
import { confirmationMatches } from '../lib/admin-confirm';

/**
 * App-facing (non-admin) mirror of `components/admin/ConfirmAction.tsx`'s
 * typed-confirmation idiom: same exact-match gate (`confirmationMatches`,
 * shared, not duplicated), same disabled-until-match affordance and
 * `.admin-confirm` visual treatment (the class name predates this second
 * caller but styles a generic pattern, not admin-specific chrome). Kept as
 * its own component rather than importing the admin one directly, so
 * `pages/app/*` never depends on anything under `components/admin/`,
 * preserving the admin/app code-split boundary. Used by Settings' billing
 * "Cancel subscription" flow: `POST /api/billing/cancel` independently
 * requires the exact literal `CANCEL_SUBSCRIPTION` in the request body, so
 * this is a friction gate against a misclick, not the security boundary.
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
