# Staging validation: website visual upgrade (2026-09-01)

Phase 7 of `docs/design-redesign-plan.md`. The development sandbox cannot
reach `staging.bidmorrow.com` (egress policy), so everything below was
produced by GitHub Actions runs against staging and read from their logs
and artifacts.

## Deployment

- Environment: the existing staging Worker + static assets, deployed by
  `deploy-staging.yml` on push to `main` (no new infrastructure).
- Pull request: #134, squash-merged 2026-09-01 21:38 UTC after CI (secret
  scan + the full checks job) passed on the head e3f72c8.
- Deploy run: `Deploy staging` run 124 (33562159261), started 21:38:21 UTC,
  succeeded at 21:39:23 UTC. Steps: checkout, install, queues and R2
  bucket ensured (idempotent), D1 migrations applied (nothing new; no
  schema change in this PR), foreign-key enforcement verified,
  `ingestion_paused` seed (idempotent), web SPA build, staging assets
  marked `noindex`, Worker deployed, runtime secrets pushed, smoke tests
  passed.

## Commit

`adad0c2917fc0eed8cb42f77e11e1f2e2a6e7c9f` on `main`: "design:
decision-engine hero, product frames, layout-shift fixes, motion and
polish (#134)". Previous production ref (for rollback): `3c08100`.

## Test results

- CI on the PR head (run 33561743655): secret-scan and the checks job
  (format, lint, typecheck, unit, D1 and worker suites, build
  verification) both succeeded; the same on the preceding code-only head
  f988c2a (run 33561444621).
- Local Playwright (marketing, accessibility, keyboard): 41 passed on the
  final build, chromium and mobile-chromium.
- Staging smoke: `deploy-staging.yml`'s post-deploy health checks passed
  (step 15 of run 124).
- `site-health.yml` run 7 (33562304005, 21:40 UTC, from a GitHub
  runner): `/api/health/live` and `/api/health/ready` 200 on staging
  (`db: ok`, last successful ingestion 20:43 UTC, `stale: false`);
  security headers unchanged (CSP with the documented Paddle allowances,
  HSTS, COOP/CORP, `nosniff`, no-referrer, permissions policy);
  `robots.txt` on staging still `Disallow: /` under Cloudflare's managed
  block, production still allows with `/app`, `/onboarding`, `/api`
  disallowed and the sitemap line; `sitemap.xml` 200 on both;
  `X-Robots-Tag: noindex, nofollow` on staging and absent on production;
  the share image on staging is the new 77,109-byte PNG (production still
  serves the previous 52,718-byte card until the production deploy).

## Visual verification

`design-review.yml` (label `staging`): screenshots of every public route
at 375 / 390 / 430 / 768 / 1024 / 1280 / 1440 / 1920 in light and dark,
with the capture script's console-error and horizontal-overflow checks.
Pending.

## Performance

Lighthouse (five baseline pairs) from the same workflow run. Pending.

## Known issues

Pending.
