import { describe, expect, it } from 'vitest';

import { PACKAGE, SUBSCRIPTION_STATUSES } from './index';
import type { SubscriptionStatus } from './index';

describe('@bidmorrow/billing', () => {
  it('exports its package name', () => {
    expect(PACKAGE).toBe('@bidmorrow/billing');
  });

  it("mirrors Paddle's subscription.status vocabulary (docs/data-model.md §9 CHECK)", () => {
    expect(SUBSCRIPTION_STATUSES).toEqual(['trialing', 'active', 'past_due', 'paused', 'canceled']);
    expect(new Set(SUBSCRIPTION_STATUSES).size).toBe(SUBSCRIPTION_STATUSES.length);

    const entitled: readonly SubscriptionStatus[] = ['trialing', 'active'];
    for (const status of entitled) {
      expect(SUBSCRIPTION_STATUSES).toContain(status);
    }
  });
});
