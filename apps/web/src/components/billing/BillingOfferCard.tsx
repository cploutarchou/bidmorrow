import type { ReactElement } from 'react';
import { Check, Sparkles } from 'lucide-react';

/**
 * What a subscription actually does, drawn from docs/product-scope.md's V1
 * scope (§4 deterministic matching engine, §5 customer feed + full
 * explanation, §7 daily digest) — no invented numbers, nothing this build
 * can't back up.
 */
const VALUE_BULLETS: readonly string[] = [
  'Every EU tender in your CPV scope scored against your matching profile — not just listed',
  'One daily digest email, only on days something clears the floor you set',
  'Each match comes with the reasons behind the score, never a bare number',
  'Cancel any time — access continues to the end of your billing period',
];

/**
 * The "no subscription" offer card (`billing.subscription === null`). The
 * first `foundingCap` customers are offered the €29 founding price
 * automatically — one button, no choice to get wrong; Standard (€49)
 * appears only once the founding spots are gone. Both are server-enforced
 * (`packages/billing` checkout.ts) — this component only renders whichever
 * one `foundingAvailable` says is live.
 */
export function BillingOfferCard({
  foundingAvailable,
  foundingRemaining,
  foundingCap,
  billingBusy,
  prelaunchLocked,
  onSubscribe,
}: {
  foundingAvailable: boolean;
  foundingRemaining: number;
  foundingCap: number;
  billingBusy: boolean;
  /** Pre-launch: new checkouts are refused server-side (403
   * `subscriptions_closed`) — show the honest state instead of a button
   * that can only fail. Internal admins keep the buttons: the server lets
   * them through so live checkout can be tested before go-live. */
  prelaunchLocked: boolean;
  onSubscribe: (plan: 'founding' | 'standard') => void;
}): ReactElement {
  const price = foundingAvailable ? '€29' : '€49';

  return (
    <div className="billing-offer-card">
      <p className="billing-offer-card__eyebrow">No active subscription.</p>

      <div className="billing-offer-card__plan">
        <div className="billing-offer-card__price-row">
          <span className="billing-offer-card__price">{price}</span>
          <span className="billing-offer-card__price-suffix">/mo incl. VAT</span>
          {foundingAvailable && (
            <span className="billing-offer-card__badge">
              <Sparkles aria-hidden="true" size={13} strokeWidth={2.4} />
              Founding price
            </span>
          )}
        </div>

        <ul className="billing-offer-card__bullets">
          {VALUE_BULLETS.map((bullet) => (
            <li key={bullet}>
              <Check aria-hidden="true" size={16} strokeWidth={2.6} />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>

        <p className="hint">
          Founding price is locked in for the life of your subscription — it never migrates to the
          standard price later. Prices include VAT — what you see is what you pay.
        </p>

        {prelaunchLocked ? (
          <p className="hint">
            Subscriptions open at launch, at the end of August. Your account and profile are ready —
            nothing to do until then.
          </p>
        ) : (
          <div className="billing-offer-card__cta">
            {foundingAvailable ? (
              <>
                <button
                  className="cta"
                  type="button"
                  disabled={billingBusy}
                  onClick={() => onSubscribe('founding')}
                >
                  Subscribe — €29/mo incl. VAT (founding price)
                </button>
                <p className="billing-offer-card__spots" aria-live="polite">
                  <span className="billing-offer-card__spots-dot" aria-hidden="true" />
                  {foundingRemaining} of {foundingCap} founding spots left — €29/mo for the life of
                  your subscription, instead of €49.
                </p>
              </>
            ) : (
              <button
                className="cta"
                type="button"
                disabled={billingBusy}
                onClick={() => onSubscribe('standard')}
              >
                Subscribe — Standard (€49/mo incl. VAT)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
