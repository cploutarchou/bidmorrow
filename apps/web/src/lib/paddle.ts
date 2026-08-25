/**
 * Paddle.js loader + overlay checkout (ADR-0011). The SPA never chooses
 * items or prices: the server creates a Paddle transaction
 * (`POST /api/billing/checkout`) and this module only opens the overlay
 * for that transaction id. Provisioning is webhook-driven — landing on the
 * success URL is never treated as proof of payment (BillingSuccess.tsx).
 *
 * `initializePaddle` downloads Paddle.js from cdn.paddle.com (allowed by
 * the CSP in apps/worker/src/index.ts and apps/web/public/_headers).
 */
import { initializePaddle, type Paddle, type PaddleEventData } from '@paddle/paddle-js';
import { getPublicConfig } from './public-config';

let instance: Promise<Paddle | null> | null = null;
let onClosed: (() => void) | null = null;

/**
 * Lazy singleton. Resolves `null` when billing is not configured (public
 * config carries no `paddle` block) or Paddle.js fails to load — callers
 * show the honest not-configured state rather than a broken button.
 */
export function loadPaddle(): Promise<Paddle | null> {
  instance ??= (async () => {
    const config = await getPublicConfig();
    if (config.paddle === null) return null;
    try {
      const paddle = await initializePaddle({
        token: config.paddle.clientToken,
        environment: config.paddle.environment,
        eventCallback: handleEvent,
      });
      if (paddle === undefined) {
        // Don't memoise a transient load failure — the next click retries.
        instance = null;
        return null;
      }
      return paddle;
    } catch {
      instance = null;
      return null;
    }
  })();
  return instance;
}

let pendingSuccessUrl: string | null = null;

function handleEvent(event: PaddleEventData): void {
  if (event.name === 'checkout.completed' && pendingSuccessUrl !== null) {
    // Paddle redirects to `successUrl` itself; this is belt-and-braces for
    // browsers/blockers that swallow the overlay's own navigation.
    window.location.assign(pendingSuccessUrl);
  } else if (event.name === 'checkout.closed') {
    onClosed?.();
  }
}

export interface OpenCheckoutArgs {
  readonly transactionId: string;
  readonly customerEmail: string;
  readonly successUrl: string;
  /** Fired when the customer dismisses the overlay without paying. */
  readonly onClosed?: () => void;
}

/** `false` when Paddle is not configured/loadable; `true` once the overlay is opened. */
export async function openCheckout(args: OpenCheckoutArgs): Promise<boolean> {
  const paddle = await loadPaddle();
  if (paddle === null) return false;
  pendingSuccessUrl = args.successUrl;
  onClosed = args.onClosed ?? null;
  paddle.Checkout.open({
    transactionId: args.transactionId,
    customer: { email: args.customerEmail },
    settings: {
      displayMode: 'overlay',
      variant: 'one-page',
      theme: 'dark',
      successUrl: args.successUrl,
      allowLogout: false,
      showAddDiscounts: false,
    },
  });
  return true;
}
