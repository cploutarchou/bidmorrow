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
 * - `/app`, `/admin`, `/onboarding` and `/api` are disallowed for crawl-budget
 *   hygiene. Each also renders a `noindex` meta (components/NoIndex.tsx),
 *   because `Disallow` only stops crawling — a URL discovered elsewhere can
 *   still be listed without it.
 * - The auth routes are deliberately NOT disallowed. A page has to stay
 *   crawlable for its `noindex` to be read at all; disallowing them would
 *   preserve exactly the listing we are trying to prevent.
 * - No crawler-specific rules and no `Crawl-delay` (ignored by Google). No
 *   AI-crawler blocks — that is an owner decision, not an SEO one.
 *
 * Every non-production environment gets a blanket `Disallow: /`.
 */
export function robotsTxt(appEnv: string): string {
  if (appEnv !== 'production') {
    return 'User-agent: *\nDisallow: /\n';
  }
  return [
    'User-agent: *',
    'Disallow: /app',
    'Disallow: /admin',
    'Disallow: /onboarding',
    'Disallow: /api',
    '',
    'Sitemap: https://bidmorrow.com/sitemap.xml',
    '',
  ].join('\n');
}
