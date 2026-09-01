import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { confirmationMatches } from '../../lib/admin-confirm';

/**
 * Dangerous-action confirmation control shared by every admin mutation
 * (suspend/unsuspend, pause/resume, scope/backfill, recompute, flag update).
 *
 * Two-phase (prototype's arm→confirm strip, audit minor closed 2026-08-24):
 * the resting state is a single action button; clicking it ARMS the control,
 * expanding an in-flow strip that states the consequence, requires the exact
 * confirm string the API contract demands (see apps/worker/src/routes/
 * admin.ts CONFIRMATION PATTERN doc comment), and offers Cancel. Focus moves
 * into the input on arm and back to the arm button on cancel. In-flow, not
 * the prototype's `position: sticky`, which needs a page-level pending state
 * machine this app deliberately does not have (see the admin-bodies note in
 * docs/redesign/template-conversion-audit.md).
 *
 * Not a security boundary: the server independently requires the same
 * literal in the request body and would reject a mismatch regardless.
 */
export function ConfirmAction({
  label,
  confirmText,
  busy = false,
  onConfirm,
  variant = 'default',
  consequence,
}: {
  label: string;
  confirmText: string;
  busy?: boolean;
  onConfirm: () => void;
  variant?: 'default' | 'danger';
  /** One honest sentence stating what confirming actually does. */
  consequence?: string;
}): ReactElement {
  const [armed, setArmed] = useState(false);
  const [typed, setTyped] = useState('');
  const inputId = useId();
  const armButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = confirmationMatches(confirmText, typed);

  // Focus follows the phase change: into the input on arm, back to the arm
  // button on cancel, never dropped to <body>.
  useEffect(() => {
    if (armed) inputRef.current?.focus();
    else armButtonRef.current?.focus({ preventScroll: true });
  }, [armed]);

  if (!armed) {
    return (
      <button
        ref={armButtonRef}
        type="button"
        className={variant === 'danger' ? 'danger' : ''}
        disabled={busy}
        onClick={() => setArmed(true)}
      >
        {label}
      </button>
    );
  }

  return (
    <div
      className={
        variant === 'danger'
          ? 'admin-confirm admin-confirm--armed admin-confirm--danger'
          : 'admin-confirm admin-confirm--armed'
      }
      role="group"
      aria-label={label}
    >
      {consequence !== undefined && <p className="admin-confirm__consequence">{consequence}</p>}
      <label htmlFor={inputId}>
        Type <code>{confirmText}</code> to confirm
      </label>
      <div className="admin-confirm__row">
        <input
          ref={inputRef}
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
            setArmed(false);
          }}
        >
          {busy ? 'Working…' : label}
        </button>
        <button
          type="button"
          className="btn-quiet"
          onClick={() => {
            setTyped('');
            setArmed(false);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
