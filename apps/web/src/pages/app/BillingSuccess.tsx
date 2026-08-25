import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import { formatMinorUnitsAsCurrency } from '../../lib/format';
import { fetchBillingStatus, pollForSubscription, type BillingStatus } from '../../lib/billing';

/**
 * Post-checkout confirmation (`/app/billing/success`).
 *
 * The Paddle checkout overlay's `successUrl` points here (lib/paddle.ts).
 * Before this page existed the redirect landed on Settings with an unread
 * `?checkout=success`, where a cold `GET /api/billing/status` could render
 * "No active subscription." to someone who had just paid.
 *
 * Why this polls instead of just saying "thanks":
 *
 * The subscription row is written ONLY by the Paddle webhook
 * (packages/billing/src/webhook.ts), which re-fetches the subscription
 * before its D1 upsert. Paddle redirects the browser in parallel
 * with delivering that webhook, and delivery is at-least-once with no ordering
 * guarantee — so on first paint the row legitimately may not exist yet.
 *
 * Two rules follow, and both are load-bearing:
 *
 * 1. Arriving at this URL is NOT proof of payment — anyone can navigate here.
 *    The confirmation, including the plan and price shown, is read from
 *    `GET /api/billing/status`, never inferred from the redirect.
 * 2. Not-yet-activated is never presented as failure. If the webhook is slow,
 *    the honest statement is that activation hasn't landed yet.
 */

type State =
  { kind: 'checking' } | { kind: 'confirmed'; status: BillingStatus } | { kind: 'not-yet' };

export function BillingSuccess(): ReactElement {
  const [state, setState] = useState<State>({ kind: 'checking' });
  // Effects run twice under StrictMode in development; this keeps the poll
  // loop single-flighted so the second mount doesn't double the requests.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;

    void pollForSubscription({
      fetchStatus: fetchBillingStatus,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      isCancelled: () => cancelled,
    }).then((outcome) => {
      if (outcome.kind === 'confirmed') setState({ kind: 'confirmed', status: outcome.status });
      else if (outcome.kind === 'not-yet') setState({ kind: 'not-yet' });
      // 'cancelled' means the page unmounted — leave state alone.
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="billing-success">
      <title>Subscription — BidMorrow</title>
      {state.kind === 'checking' && <Checking />}
      {state.kind === 'confirmed' && <Confirmed status={state.status} />}
      {state.kind === 'not-yet' && <NotYet />}
    </div>
  );
}

function Checking(): ReactElement {
  return (
    <>
      <h1>Completing your subscription</h1>
      <p aria-live="polite">
        We're waiting for the payment confirmation to reach BidMorrow. This usually takes a few
        seconds.
      </p>
      <div className="feed-skeleton-list" aria-hidden="true">
        <div className="feed-skeleton-card" />
      </div>
    </>
  );
}

function Confirmed({ status }: { status: BillingStatus }): ReactElement {
  // Non-null by construction — `confirmed` is only set when the row exists.
  const subscription = status.subscription;
  if (subscription === null) return <NotYet />;
  const planLabel = subscription.plan === 'founding' ? 'Founding' : 'Standard';
  const price = `${formatMinorUnitsAsCurrency(
    subscription.price.amountMinorUnits,
    subscription.price.currency,
  )} / ${subscription.price.interval}${subscription.price.taxInclusive ? ' incl. VAT' : ''}`;

  return (
    <>
      <h1>{status.entitlement.active ? "You're subscribed" : 'Subscription recorded'}</h1>
      <div className="billing-plan-card">
        <div className="billing-plan-card__row">
          <span className="billing-plan-card__plan">{planLabel} plan</span>
          <span>{price}</span>
        </div>
      </div>
      {!status.entitlement.active && (
        <p className="hint">
          Your feed and digest aren't active yet: {status.entitlement.reason.replace(/_/g, ' ')}.
          Manage this in billing settings.
        </p>
      )}
      {/* Completing checkout does not trigger a matching run — ingestion and
          matching are daily, so promising results now would be untrue. This
          matches the feed's own empty state. */}
      <p>Ingestion and matching run daily, so your first matches appear after the next run.</p>
      <p className="billing-success__actions">
        <Link className="cta" to="/app">
          Go to your feed
        </Link>
        <Link to="/app/settings#billing">Billing settings</Link>
      </p>
    </>
  );
}

function NotYet(): ReactElement {
  return (
    <>
      <h1>Still activating</h1>
      <p aria-live="polite">
        Your subscription hasn't finished activating yet. If your payment went through this normally
        resolves on its own within a minute or two — there's nothing you need to do.
      </p>
      <p>
        If billing settings still shows no subscription after that, contact{' '}
        <a href="mailto:support@bidmorrow.com">support@bidmorrow.com</a> and we'll sort it out.
      </p>
      <p className="billing-success__actions">
        <Link className="cta" to="/app/settings#billing">
          Check billing settings
        </Link>
        <Link to="/app">Go to your feed</Link>
      </p>
    </>
  );
}
