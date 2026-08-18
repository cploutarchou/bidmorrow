/**
 * @bidmorrow/analytics — minimal first-party product events.
 *
 * Phase 2 skeleton: this package owns only the event-name vocabulary for the
 * `product_events` table (docs/data-model.md §10). Recording lands in a later
 * phase. Names are lower_snake, derived from the V1 product surface in
 * docs/product-scope.md (account, onboarding, feed, feedback, digest,
 * billing) plus the examples documented in docs/data-model.md
 * (`feed_viewed`, `digest_opened`, `match_expanded`).
 */

export const PACKAGE = '@bidmorrow/analytics';

export const PRODUCT_EVENT_NAMES = [
  'signup_completed',
  'email_verified',
  'onboarding_completed',
  'feed_viewed',
  'match_expanded',
  'tender_saved',
  'tender_ignored',
  'feedback_submitted',
  'digest_opened',
  'checkout_started',
  'checkout_completed',
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];
