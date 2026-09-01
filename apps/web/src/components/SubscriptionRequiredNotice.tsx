import type { ReactElement } from 'react';
import { Link } from 'react-router';

/**
 * Fix for F17 (docs/redesign/ux-strategy.md §5.4): the feed's 402
 * `subscription_required` response is a designed paywall state, never the
 * generic "Could not load your feed" error. Reused by any future
 * entitlement-gated surface, kept presentational and reason-driven so it
 * never has to guess.
 */

/** Mirrors the reasons `getEntitlement` can return while inactive (packages/billing/src/entitlement.ts). */
export type InactiveReason = 'no_subscription' | 'past_due_expired' | 'paused' | 'canceled';

const LAPSED_REASONS: ReadonlySet<string> = new Set(['past_due_expired', 'paused', 'canceled']);

export function SubscriptionRequiredNotice({
  reason,
  foundingAvailable,
}: {
  reason: string;
  foundingAvailable: boolean | null;
}): ReactElement {
  const isLapsed = LAPSED_REASONS.has(reason);

  return (
    <section className="subscribe-required glass" aria-labelledby="subscribe-required-h">
      <h2 id="subscribe-required-h">
        {isLapsed
          ? 'Your subscription has lapsed. Reactivate to restore your feed.'
          : 'Your profile is ready. A subscription activates your feed.'}
      </h2>
      <p>
        A subscription activates your scored feed and daily digest email. Pricing is flat and
        monthly, with no usage-based fees.
      </p>
      <div className="subscribe-required__price-row">
        {!isLapsed && foundingAvailable === true && (
          <span className="subscribe-required__price">
            Founding - €29/mo incl. VAT, limited spots
          </span>
        )}
        <span className="subscribe-required__price">Standard - €49/mo incl. VAT</span>
      </div>
      <div className="subscribe-required__actions">
        <Link className="btn-solar" to="/app/settings#billing">
          {isLapsed ? 'Reactivate your subscription' : 'Subscribe now'}
        </Link>
        <Link className="btn-quiet" to="/app/settings#matching-profile">
          Review your profile settings
        </Link>
      </div>
    </section>
  );
}
