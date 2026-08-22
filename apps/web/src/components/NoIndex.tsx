import type { ReactElement } from 'react';

/**
 * `noindex` for surfaces that must never appear in search results: the auth
 * screens, the customer app shell, onboarding, the internal admin shell, and
 * the 404 page (docs/redesign/seo-content-strategy.md §3).
 *
 * robots.txt additionally disallows `/app`, `/admin` and `/onboarding`, but
 * `Disallow` only stops crawling — it does not stop a discovered URL being
 * listed. This meta is what actually keeps them out of the index, so both
 * layers exist deliberately.
 *
 * The auth routes are deliberately NOT disallowed in robots.txt: a page has to
 * be crawlable for its `noindex` to be read at all.
 *
 * On `NotFound` this is doubly correct — that page is also the admin cloak
 * (components/admin/AdminGate.tsx renders it for non-admins), so it must never
 * be indexed under an `/admin/*` URL.
 */
export function NoIndex(): ReactElement {
  return <meta name="robots" content="noindex" />;
}
