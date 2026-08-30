import type { ReactElement } from 'react';
import { ConfirmAction } from '../ConfirmAction';
import {
  formatCalendarDate,
  formatMinorUnitsAsCurrency,
  paymentStateLabel,
  paymentStateTone,
} from '../../lib/format';
import { BillingInvoiceTable } from './BillingInvoiceTable';
import type { ActiveSubscription, InvoicesState } from './types';

/**
 * Plan card + cancel/reactivate controls + payment/print actions + invoice
 * history for an organization WITH a subscription (`billing.subscription !==
 * null`). Extracted from Settings.tsx (formerly the local
 * `BillingActiveSubscription` helper) — same props, same handlers, same
 * `POST /api/billing/*` call sites; only the presentation moved.
 */
export function BillingSubscriptionCard({
  subscription,
  entitlementActive,
  entitlementReason,
  billingBusy,
  cancelBusy,
  cancelError,
  reactivateBusy,
  reactivateError,
  reactivateNeedsCheckout,
  knownNonOwner,
  invoicesState,
  onManagePayment,
  onCancel,
  onReactivate,
  onStartCheckout,
}: {
  subscription: ActiveSubscription;
  entitlementActive: boolean;
  entitlementReason: string;
  billingBusy: boolean;
  cancelBusy: boolean;
  cancelError: string | null;
  reactivateBusy: boolean;
  reactivateError: string | null;
  reactivateNeedsCheckout: boolean;
  knownNonOwner: boolean;
  invoicesState: InvoicesState;
  onManagePayment: () => void;
  onCancel: () => void;
  onReactivate: () => void;
  onStartCheckout: () => void;
}): ReactElement {
  const overdue = subscription.paymentState === 'past_due';
  const paused = subscription.paymentState === 'paused';
  const planLabel = subscription.plan === 'founding' ? 'Founding' : 'Standard';
  const tone = paymentStateTone(subscription.paymentState);

  return (
    <>
      <div className="billing-plan-card billing-plan-card--active">
        <div className="billing-plan-card__row">
          <span className="billing-plan-card__plan">{planLabel} plan</span>
          <span className="billing-plan-card__price">
            {formatMinorUnitsAsCurrency(
              subscription.price.amountMinorUnits,
              subscription.price.currency,
            )}{' '}
            / {subscription.price.interval}
            {subscription.price.taxInclusive ? ' incl. VAT' : ''}
          </span>
          <span className={`billing-status-badge billing-status-badge--${tone}`}>
            {paymentStateLabel(subscription.paymentState)}
          </span>
        </div>
        <p>
          {subscription.cancelAtPeriodEnd
            ? `Cancels on ${formatCalendarDate(subscription.currentPeriodEndAt)} — access continues until then.`
            : `Renews on ${formatCalendarDate(subscription.currentPeriodEndAt)}.`}
        </p>
        {!entitlementActive && (
          <p className="hint">
            Feed and digest are currently paused: {entitlementReason.replace(/_/g, ' ')}.
          </p>
        )}
        {overdue && (
          <div className="billing-overdue-notice" role="alert">
            <p>
              We couldn't process your last payment — your subscription is past due. Update your
              payment details to keep your feed and digest active.
            </p>
            {!knownNonOwner && (
              <button
                className="cta no-print"
                type="button"
                disabled={billingBusy}
                onClick={onManagePayment}
              >
                Fix payment details
              </button>
            )}
          </div>
        )}
      </div>

      {paused && (
        <p className="hint" role="status">
          Your subscription is paused — nothing is billed and the feed is off. Resume it from Manage
          payment details.
        </p>
      )}

      {!subscription.cancelAtPeriodEnd ? (
        <div className="billing-cancel-panel">
          <h3>Cancel subscription</h3>
          <p className="hint">
            Canceling takes effect at the end of your current billing period (
            {formatCalendarDate(subscription.currentPeriodEndAt)}) — you keep full access until
            then, and nothing is charged again after that date.
          </p>
          {cancelError !== null && (
            <p role="alert" className="form-error">
              {cancelError}
            </p>
          )}
          {knownNonOwner ? (
            <p className="hint">Only the organization owner can cancel billing.</p>
          ) : (
            <ConfirmAction
              label="Cancel subscription"
              confirmText="CANCEL_SUBSCRIPTION"
              variant="danger"
              busy={cancelBusy}
              onConfirm={onCancel}
            />
          )}
        </div>
      ) : (
        <div className="billing-cancel-panel">
          <h3>Subscription ending</h3>
          <p>
            Cancels on <strong>{formatCalendarDate(subscription.currentPeriodEndAt)}</strong> —
            access continues until then.
          </p>
          {reactivateError !== null && (
            <p role="alert" className="form-error">
              {reactivateError}
            </p>
          )}
          {knownNonOwner ? (
            <p className="hint">Only the organization owner can reactivate billing.</p>
          ) : reactivateNeedsCheckout ? (
            <div className="button-row">
              <p className="hint">This subscription has already ended.</p>
              <button
                className="cta"
                type="button"
                disabled={billingBusy}
                onClick={onStartCheckout}
              >
                Start a new subscription
              </button>
            </div>
          ) : (
            <button className="cta" type="button" disabled={reactivateBusy} onClick={onReactivate}>
              {reactivateBusy ? 'Working…' : 'Keep my subscription'}
            </button>
          )}
        </div>
      )}

      <div className="button-row">
        {!knownNonOwner && (
          <button
            className="btn-quiet"
            type="button"
            disabled={billingBusy}
            onClick={onManagePayment}
          >
            Manage payment details
          </button>
        )}
        <button className="btn-quiet no-print" type="button" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <BillingInvoiceTable state={invoicesState} />
    </>
  );
}
