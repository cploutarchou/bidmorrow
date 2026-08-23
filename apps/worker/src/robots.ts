/**
 * robots.txt body, per environment.
 *
 * This is Worker-served rather than a static file in `apps/web/public/`
 * because the same built assets deploy to every environment: a static file
 * would publish the production rules — and the production `Sitemap:` line —
 * on staging.bidmorrow.com, leaving staging crawlable and competing with
 * production for the same content.
 *
 * Production rules follow docs/redesign/seo-content-strategy.md §5:
 *
 * - `/app`, `/onboarding` and `/api` are disallowed for crawl-budget hygiene.
 *   The first two also render a `noindex` meta (components/NoIndex.tsx),
 *   because `Disallow` only stops crawling — a URL discovered elsewhere can
 *   still be listed without it.
 * - `/admin` is deliberately ABSENT, diverging from the §5 draft. The admin
 *   plane's isolation control is 404 cloaking (docs/threat-model.md C11: the
 *   server 404s every non-allowlisted caller and the SPA renders the same
 *   NotFound as any unknown URL). robots.txt is the most-fetched file on any
 *   site, so naming `/admin` there advertises exactly the path the rest of
 *   the system refuses to confirm. Nothing is lost by omitting it: by the
 *   reasoning above, `Disallow` was never what kept `/admin` out of the
 *   index — its `noindex` is, and that still ships.
 * - The auth routes are deliberately NOT disallowed. A page has to stay
 *   crawlable for its `noindex` to be read at all; disallowing them would
 *   preserve exactly the listing we are trying to prevent.
 * - No crawler-specific rules and no `Crawl-delay` (ignored by Google). No
 *   AI-crawler blocks — that is an owner decision, not an SEO one.
 *
 * Every non-production environment gets a blanket `Disallow: /`.
 *
 * IMPORTANT — this file is not the whole staging story. The zone has
 * Cloudflare's managed robots.txt turned on, which PREPENDS its own
 * `User-agent: *` / `Allow: /` group to whatever this Worker returns
 * (observed live, site-health run 32633482361). Crawlers merge groups
 * sharing a user-agent, and `Allow: /` against `Disallow: /` is a
 * same-length tie that resolves to the least restrictive rule — so the
 * blanket Disallow below does NOT by itself keep staging out of an index.
 * What does is the `X-Robots-Tag: noindex, nofollow` header injected into
 * `_headers` by the staging deploy workflow, which no robots.txt merge can
 * weaken. The blanket rule stays because it still states the intent and is
 * honoured by parsers that take the first matching group.
 *
 * The production rules are unaffected: `/app`, `/onboarding` and `/api` are
 * longer paths than `/`, so under longest-match precedence they beat
 * Cloudflare's `Allow: /` outright.
 */
export function robotsTxt(appEnv: string): string {
  if (appEnv !== 'production') {
    return 'User-agent: *\nDisallow: /\n';
  }
  return [
    'User-agent: *',
    'Disallow: /app',
    'Disallow: /onboarding',
    'Disallow: /api',
    '',
    'Sitemap: https://bidmorrow.com/sitemap.xml',
    '',
  ].join('\n');
}
