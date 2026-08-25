/**
 * Typed billing errors. Callers (apps/worker routes) branch on `instanceof`
 * rather than sniffing messages, mirroring packages/db/src/repositories/
 * errors.ts's style.
 */

/** The organization already has a non-canceled subscription (docs/product-scope.md: 1:1). */
export class SubscriptionAlreadyExistsError extends Error {
  readonly code = 'SUBSCRIPTION_ALREADY_EXISTS' as const;

  constructor(readonly organizationId: string) {
    super(`organization ${organizationId} already has a subscription`);
    this.name = 'SubscriptionAlreadyExistsError';
  }
}

/** The founding plan is not open (flag off) or its seat cap is reached. */
export class FoundingPlanUnavailableError extends Error {
  readonly code = 'FOUNDING_PLAN_UNAVAILABLE' as const;

  constructor(readonly reason: 'flag_closed' | 'cap_reached') {
    super(`founding plan unavailable: ${reason}`);
    this.name = 'FoundingPlanUnavailableError';
  }
}

/** Portal/invoice requested for an organization with no Paddle customer on file yet. */
export class NoBillingCustomerError extends Error {
  readonly code = 'NO_BILLING_CUSTOMER' as const;

  constructor(readonly organizationId: string) {
    super(`organization ${organizationId} has no billing customer yet`);
    this.name = 'NoBillingCustomerError';
  }
}
