/**
 * Unit tests for `listInvoicesForOrganization` / `getInvoicePdfForOrganization`
 * (`GET /api/billing/invoices[/:id/pdf]`) against a stubbed Paddle
 * transactions client (no network) and a mocked `@bidmorrow/db` repository
 * layer (no D1) — same split as cancellation.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Subscription } from '@bidmorrow/db';
import type { OrganizationId } from '@bidmorrow/domain';

import { PaddleApiError, type PaddleTransaction } from './paddle-client';

const getSubscription = vi.fn();

vi.mock('@bidmorrow/db', () => ({
  getSubscription: (...args: unknown[]) => getSubscription(...args),
}));

const {
  INVOICE_LIST_LIMIT,
  INVOICE_TRANSACTION_STATUSES,
  getInvoicePdfForOrganization,
  listInvoicesForOrganization,
  toInvoiceSummary,
} = await import('./invoices');
const { NoBillingCustomerError } = await import('./errors');

const ORG_ID = 'org_test_01J0INVOICE' as OrganizationId;
const FAKE_DB = {} as never;

function subscriptionRow(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub_row_1',
    organizationId: ORG_ID,
    billingCustomerId: 'ctm_test',
    billingSubscriptionId: 'sub_test',
    status: 'active',
    plan: 'standard',
    currentPeriodEndAt: 1_700_000_000_000,
    cancelAtPeriodEnd: 0,
    createdAt: 1_600_000_000_000,
    updatedAt: 1_600_000_000_000,
    ...overrides,
  } as Subscription;
}

function fakeTransaction(overrides: Partial<PaddleTransaction> = {}): PaddleTransaction {
  return {
    id: 'txn_01test',
    status: 'completed',
    customer_id: 'ctm_test',
    subscription_id: 'sub_test',
    invoice_number: '1234-00001',
    currency_code: 'EUR',
    created_at: '2026-08-01T10:00:00.000Z',
    billed_at: '2026-08-02T10:00:00.000Z',
    billing_period: { starts_at: '2026-08-02T00:00:00.000Z', ends_at: '2026-09-02T00:00:00.000Z' },
    details: {
      totals: {
        subtotal: '4900',
        tax: '931',
        total: '5831',
        grand_total: '5831',
        currency_code: 'EUR',
      },
    },
    ...overrides,
  };
}

function fakeTransactions(
  opts: {
    list?: readonly PaddleTransaction[] | Error;
    get?: PaddleTransaction | Error;
    invoice?: { url: string } | Error;
  } = {},
) {
  const list = vi.fn(async () => {
    if (opts.list instanceof Error) throw opts.list;
    return { data: opts.list ?? [], meta: {} };
  });
  const get = vi.fn(async () => {
    if (opts.get instanceof Error) throw opts.get;
    return opts.get ?? fakeTransaction();
  });
  const invoice = vi.fn(async () => {
    if (opts.invoice instanceof Error) throw opts.invoice;
    return opts.invoice ?? { url: 'https://sandbox-api.paddle.com/invoice.pdf' };
  });
  return { paddle: { transactions: { list, get, invoice } }, list, get, invoice };
}

describe('toInvoiceSummary', () => {
  it('maps a completed transaction: minor units from grand_total, paid, invoice available', () => {
    expect(toInvoiceSummary(fakeTransaction())).toEqual({
      id: 'txn_01test',
      number: '1234-00001',
      status: 'completed',
      currency: 'eur',
      amountDue: 5831,
      amountPaid: 5831,
      createdAt: Date.parse('2026-08-02T10:00:00.000Z'),
      periodStartAt: Date.parse('2026-08-02T00:00:00.000Z'),
      periodEndAt: Date.parse('2026-09-02T00:00:00.000Z'),
      hasInvoice: true,
    });
  });

  it('reports amountPaid 0 for a billed/past_due transaction', () => {
    expect(toInvoiceSummary(fakeTransaction({ status: 'past_due' }))).toMatchObject({
      amountDue: 5831,
      amountPaid: 0,
    });
    expect(toInvoiceSummary(fakeTransaction({ status: 'billed' })).amountPaid).toBe(0);
    expect(toInvoiceSummary(fakeTransaction({ status: 'paid' })).amountPaid).toBe(5831);
  });

  it('has no invoice when Paddle has not issued an invoice number', () => {
    expect(toInvoiceSummary(fakeTransaction({ invoice_number: null }))).toMatchObject({
      number: null,
      hasInvoice: false,
    });
  });

  it('falls back to created_at when billed_at is null, and null periods pass through', () => {
    const summary = toInvoiceSummary(
      fakeTransaction({ billed_at: null, billing_period: null, details: null }),
    );
    expect(summary.createdAt).toBe(Date.parse('2026-08-01T10:00:00.000Z'));
    expect(summary.periodStartAt).toBeNull();
    expect(summary.periodEndAt).toBeNull();
    expect(summary.amountDue).toBe(0);
    expect(summary.currency).toBe('eur');
  });
});

describe('listInvoicesForOrganization', () => {
  beforeEach(() => {
    getSubscription.mockReset();
  });

  it('returns an empty list with hasBillingCustomer: false before any Paddle call', async () => {
    getSubscription.mockResolvedValue(null);
    const { paddle, list } = fakeTransactions();
    const result = await listInvoicesForOrganization(
      { db: FAKE_DB, paddle },
      { organizationId: ORG_ID },
    );
    expect(result).toEqual({ invoices: [], hasBillingCustomer: false });
    expect(list).not.toHaveBeenCalled();
  });

  it('lists by the SERVER-STORED customer id with the bounded, explicit query', async () => {
    getSubscription.mockResolvedValue(subscriptionRow({ billingCustomerId: 'ctm_server' }));
    const { paddle, list } = fakeTransactions({ list: [fakeTransaction()] });
    const result = await listInvoicesForOrganization(
      { db: FAKE_DB, paddle },
      { organizationId: ORG_ID },
    );
    expect(list).toHaveBeenCalledWith({
      customer_id: 'ctm_server',
      status: INVOICE_TRANSACTION_STATUSES,
      per_page: INVOICE_LIST_LIMIT,
      order_by: 'billed_at[DESC]',
    });
    expect(INVOICE_LIST_LIMIT).toBeLessThanOrEqual(30);
    expect(result.hasBillingCustomer).toBe(true);
    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0]).toMatchObject({ id: 'txn_01test', amountDue: 5831 });
  });

  it('propagates a Paddle API error', async () => {
    getSubscription.mockResolvedValue(subscriptionRow());
    const { paddle } = fakeTransactions({ list: new Error('paddle down') });
    await expect(
      listInvoicesForOrganization({ db: FAKE_DB, paddle }, { organizationId: ORG_ID }),
    ).rejects.toThrow('paddle down');
  });
});

describe('getInvoicePdfForOrganization', () => {
  beforeEach(() => {
    getSubscription.mockReset();
  });

  it('throws NoBillingCustomerError when the org has no row, without calling Paddle', async () => {
    getSubscription.mockResolvedValue(null);
    const { paddle, get, invoice } = fakeTransactions();
    await expect(
      getInvoicePdfForOrganization(
        { db: FAKE_DB, paddle },
        { organizationId: ORG_ID, transactionId: 'txn_01test' },
      ),
    ).rejects.toBeInstanceOf(NoBillingCustomerError);
    expect(get).not.toHaveBeenCalled();
    expect(invoice).not.toHaveBeenCalled();
  });

  it('returns not_found (and never fetches the PDF) when the transaction belongs to another customer', async () => {
    getSubscription.mockResolvedValue(subscriptionRow({ billingCustomerId: 'ctm_mine' }));
    const { paddle, invoice } = fakeTransactions({
      get: fakeTransaction({ customer_id: 'ctm_someone_else' }),
    });
    const outcome = await getInvoicePdfForOrganization(
      { db: FAKE_DB, paddle },
      { organizationId: ORG_ID, transactionId: 'txn_01test' },
    );
    expect(outcome).toEqual({ kind: 'not_found' });
    expect(invoice).not.toHaveBeenCalled();
  });

  it('maps a Paddle 404 on the transaction lookup to not_found — indistinguishable from a foreign id (SEC-PDL-03)', async () => {
    getSubscription.mockResolvedValue(subscriptionRow());
    const { paddle, invoice } = fakeTransactions({
      get: new PaddleApiError(404, 'entity_not_found', 'req_1', 'transaction not found'),
    });
    expect(
      await getInvoicePdfForOrganization(
        { db: FAKE_DB, paddle },
        { organizationId: ORG_ID, transactionId: 'txn_01missing' },
      ),
    ).toEqual({ kind: 'not_found' });
    expect(invoice).not.toHaveBeenCalled();
  });

  it('still propagates non-404 provider errors on the transaction lookup', async () => {
    getSubscription.mockResolvedValue(subscriptionRow());
    const { paddle } = fakeTransactions({
      get: new PaddleApiError(500, null, null, 'paddle down'),
    });
    await expect(
      getInvoicePdfForOrganization(
        { db: FAKE_DB, paddle },
        { organizationId: ORG_ID, transactionId: 'txn_01test' },
      ),
    ).rejects.toBeInstanceOf(PaddleApiError);
  });

  it('returns not_found for a transaction with no customer', async () => {
    getSubscription.mockResolvedValue(subscriptionRow());
    const { paddle } = fakeTransactions({ get: fakeTransaction({ customer_id: null }) });
    expect(
      await getInvoicePdfForOrganization(
        { db: FAKE_DB, paddle },
        { organizationId: ORG_ID, transactionId: 'txn_01test' },
      ),
    ).toEqual({ kind: 'not_found' });
  });

  it('returns no_invoice when no invoice number has been issued', async () => {
    getSubscription.mockResolvedValue(subscriptionRow());
    const { paddle, invoice } = fakeTransactions({
      get: fakeTransaction({ invoice_number: null }),
    });
    expect(
      await getInvoicePdfForOrganization(
        { db: FAKE_DB, paddle },
        { organizationId: ORG_ID, transactionId: 'txn_01test' },
      ),
    ).toEqual({ kind: 'no_invoice' });
    expect(invoice).not.toHaveBeenCalled();
  });

  it('rejects a non-https URL from the provider (defense in depth)', async () => {
    getSubscription.mockResolvedValue(subscriptionRow());
    const { paddle } = fakeTransactions({ invoice: { url: 'javascript:alert(1)' } });
    expect(
      await getInvoicePdfForOrganization(
        { db: FAKE_DB, paddle },
        { organizationId: ORG_ID, transactionId: 'txn_01test' },
      ),
    ).toEqual({ kind: 'no_invoice' });
  });

  it('returns the https PDF url for the org’s own invoice', async () => {
    getSubscription.mockResolvedValue(subscriptionRow());
    const { paddle, get, invoice } = fakeTransactions({
      invoice: { url: 'https://paddle.example/invoice.pdf' },
    });
    expect(
      await getInvoicePdfForOrganization(
        { db: FAKE_DB, paddle },
        { organizationId: ORG_ID, transactionId: 'txn_01test' },
      ),
    ).toEqual({ kind: 'url', url: 'https://paddle.example/invoice.pdf' });
    expect(get).toHaveBeenCalledWith('txn_01test');
    expect(invoice).toHaveBeenCalledWith('txn_01test');
  });

  it('propagates a Paddle API error', async () => {
    getSubscription.mockResolvedValue(subscriptionRow());
    const { paddle } = fakeTransactions({ get: new Error('paddle down') });
    await expect(
      getInvoicePdfForOrganization(
        { db: FAKE_DB, paddle },
        { organizationId: ORG_ID, transactionId: 'txn_01test' },
      ),
    ).rejects.toThrow('paddle down');
  });
});
