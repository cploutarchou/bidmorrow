/**
 * Stripe client factory — Workers-compatible (no Node built-ins).
 *
 * Facts verified directly from the INSTALLED `stripe@22.5.0` SDK type
 * declarations (`node_modules/.pnpm/stripe@22.5.0/node_modules/stripe/esm/
 * *.d.ts` — docs.stripe.com was unreachable from this environment, egress
 * blocked by the proxy, same restriction hit in earlier phases for other
 * external docs hosts; recorded here and in docs/dependency-versions.md):
 *
 * - `Stripe.API_VERSION` / the `UserProvidedConfig.apiVersion` default is
 *   `"2026-07-29.dahlia"` (`esm/apiVersion.d.ts`), matching
 *   docs/dependency-versions.md's already-recorded pin exactly — pinned
 *   explicitly below anyway so an SDK upgrade can never silently move it.
 * - `Stripe.createFetchHttpClient()` (static method, `esm/stripe.core.d.ts`)
 *   returns an `HttpClientInterface` backed by the global `fetch`
 *   (`esm/net/FetchHttpClient.d.ts`) — no Node `http`/`https` module, safe
 *   on Workers. Passed via the constructor's `httpClient` option.
 * - `Stripe.createSubtleCryptoProvider()` (static method,
 *   `esm/platform/PlatformFunctions.d.ts`) returns a `CryptoProvider` backed
 *   by Web Crypto `SubtleCrypto` (`esm/crypto/SubtleCryptoProvider.d.ts`,
 *   "This only supports asynchronous operations") — required for
 *   `webhooks.constructEventAsync` on Workers (no Node `crypto` module
 *   there either); see webhook.ts.
 * - The package also ships a dedicated `workerd`/`worker` export condition
 *   (`stripe.esm.worker.js`, see package.json `exports`) that defaults its
 *   INTERNAL platform functions to the Web-safe implementations already —
 *   `httpClient` is passed explicitly here, and the `cryptoProvider` is
 *   defaulted explicitly at the verification call site
 *   (`verifyStripeWebhookEvent`, webhook.ts), so behavior is identical and
 *   deterministic under every resolution condition (plain Node for this
 *   package's own unit tests, `workerd` for the real Worker and its D1
 *   integration tests), not dependent on which build a bundler picks.
 *
 * Constructed once per request (Workers has no persistent process-level
 * state to safely cache a client across isolates) — cheap, no network call
 * happens at construction time.
 */
import Stripe from 'stripe';

/** Pinned per docs/dependency-versions.md — verified against the installed SDK above. */
export const STRIPE_API_VERSION = '2026-07-29.dahlia' satisfies Stripe.LatestApiVersion;

export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  });
}
