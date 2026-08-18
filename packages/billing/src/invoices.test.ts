/**
 * Unit tests for `listInvoicesForOrganization` (`GET /api/billing/invoices`)
 * against a stubbed Stripe client (no network) and a mocked
 * `@bidmorrow/db` repository layer (no D1) — same split as
 * cancellation.test.ts/reactivation.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Subscription } from '@bidmorrow/db';
import type { OrganizationId } from '@bidmorrow/domain';
import type Stripe from 'stripe';

const getSubscription = vi.fn();

vi.mock('@bidmorrow/db', () => ({
  getSubscription: (...args: unknown[]) => getSubscription(...args),
}));

const { listInvoicesForOrganization, INVOICE_LIST_LIMIT } = await import('./invoices');

const ORG_ID = 'org_test_01J0INVOICE' as OrganizationId;
const FAKE_DB = {} as never;

function subscriptionRow(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub_row_1',
    organizationId: ORG_ID,
    stripeCustomerId: 'cus_test',
    stripeSubscriptionId: 'sub_test',
    status: 'active',
    plan: 'standard',
    currentPeriodEndAt: 1_700_000_000_000,
    cancelAtPeriodEnd: 0,
    createdAt: 1_600_000_000_000,
    updatedAt: 1_600_000_000_000,
    ...overrides,
  } as Subscription;
}

function fakeInvoice(overrides: Partial<Stripe.Invoice> & { id: string }): Stripe.Invoice {
  return {
    number: 'INV-0001',
    status: 'paid',
    currency: 'eur',
    amount_due: 4900,
    amount_paid: 4900,
    created: 1_700_000_000,
    period_start: 1_697_408_000,
    period_end: 1_700_000_000,
    hosted_invoice_url: 'https://invoice.stripe.com/i/test',
    invoice_pdf: 'https://invoice.stripe.com/i/test/pdf',
    ...overrides,
  } as unknown as Stripe.Invoice;
}

describe('listInvoicesForOrganization', () => {
  beforeEach(() => {
    getSubscription.mockReset();
  });

  it('returns an empty list with hasBillingCustomer: false when the org has never checked out', async () => {
    getSubscription.mockResolvedValue(null);
    const list = vi.fn();
    const stripe = { invoices: { list } };

    const result = await listInvoicesForOrganization(
      { db: FAKE_DB, stripe },
      { organizationId: ORG_ID },
    );

    expect(result).toEqual({ invoices: [], hasBillingCustomer: false });
    expect(list).not.toHaveBeenCalled();
  });

  it('lists invoices using the SERVER-STORED stripeCustomerId, bounded by INVOICE_LIST_LIMIT', async () => {
    getSubscription.mockResolvedValue(subscriptionRow({ stripeCustomerId: 'cus_from_db' }));
    const list = vi.fn().mockResolvedValue({
      object: 'list',
      data: [fakeInvoice({ id: 'in_1' })],
      has_more: false,
      url: '/v1/invoices',
    });
    const stripe = { invoices: { list } };

    const result = await listInvoicesForOrganization(
      { db: FAKE_DB, stripe },
      { organizationId: ORG_ID },
    );

    expect(list).toHaveBeenCalledWith({ customer: 'cus_from_db', limit: INVOICE_LIST_LIMIT });
    expect(result.hasBillingCustomer).toBe(true);
    expect(result.invoices).toEqual([
      {
        id: 'in_1',
        number: 'INV-0001',
        status: 'paid',
        currency: 'eur',
        amountDue: 4900,
        amountPaid: 4900,
        createdAt: 1_700_000_000_000,
        periodStartAt: 1_697_408_000_000,
        periodEndAt: 1_700_000_000_000,
        hostedInvoiceUrl: 'https://invoice.stripe.com/i/test',
        invoicePdf: 'https://invoice.stripe.com/i/test/pdf',
      },
    ]);
  });

  it('maps null hosted_invoice_url/invoice_pdf/number/status through without throwing', async () => {
    getSubscription.mockResolvedValue(subscriptionRow());
    const list = vi.fn().mockResolvedValue({
      object: 'list',
      data: [
        fakeInvoice({
          id: 'in_2',
          number: null,
          status: null,
          hosted_invoice_url: null,
          invoice_pdf: null,
        }),
      ],
      has_more: false,
      url: '/v1/invoices',
    });
    const stripe = { invoices: { list } };

    const result = await listInvoicesForOrganization(
      { db: FAKE_DB, stripe },
      { organizationId: ORG_ID },
    );

    expect(result.invoices[0]).toMatchObject({
      number: null,
      status: null,
      hostedInvoiceUrl: null,
      invoicePdf: null,
    });
  });

  it('propagates a Stripe API error to the caller rather than swallowing it', async () => {
    getSubscription.mockResolvedValue(subscriptionRow());
    const stripeError = new Error('stripe: rate limited');
    const stripe = { invoices: { list: vi.fn().mockRejectedValue(stripeError) } };

    await expect(
      listInvoicesForOrganization({ db: FAKE_DB, stripe }, { organizationId: ORG_ID }),
    ).rejects.toThrow('stripe: rate limited');
  });
});
