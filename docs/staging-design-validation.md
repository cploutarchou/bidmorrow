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
- Follow-up deploy (the accessibility fix found by this validation, PR
  #135 squash-merged as `7e13eea`): `Deploy staging` run 126
  (33568361977), 22:52:17 to 22:53:24 UTC, the same steps, all green.

## Commit

`adad0c2917fc0eed8cb42f77e11e1f2e2a6e7c9f` on `main`: "design:
decision-engine hero, product frames, layout-shift fixes, motion and
polish (#134)", followed by `7e13eea4fae6bdd8b596b9061c0df15a70ca03a3`:
"a11y: contrast-safe hero entrances; staging validation evidence;
design-review workflow hardening (#135)", the commit that went to
production. Previous production ref (for rollback): `3c08100`.

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

`design-review.yml` run 3 (33564742786, 22:09–22:20 UTC, from a GitHub
runner against `https://staging.bidmorrow.com`): every public route
(Home, How it works, Methodology, Sample verdicts, Cybersecurity tenders,
Pricing, Pilot, Contact, Privacy, Terms, Refunds, Login, Signup, Forgot
password) captured full-page at 390 / 768 / 1440 in light and dark, 84
captures. The capture script's checks: **no console errors, no
horizontal overflow on any route at any width**. The same script had
failed run 1 (33562293252) on 168 console messages that turned out to be
Cloudflare's zone-level Web Analytics beacon being refused by the site's
own CSP on every page; those are now reported separately (see Known
issues) and are not site errors. Run 4 repeats the capture at 390 / 1440
and pushes the images to a scratch branch for a frame-by-frame look at the
hero, stepper, pricing and FAQ on staging (the sandbox cannot download
workflow artifacts).

## Performance

Lighthouse 12 from the same run (GitHub runner, real network, mobile
emulation with simulated throttling unless noted):

| Page                     | Perf | A11y | BP  | SEO\* | LCP   | CLS   | TBT    |
| ------------------------ | ---- | ---- | --- | ----- | ----- | ----- | ------ |
| Home (mobile)            | 84   | 100  | 93  | 58    | 2.5 s | 0.001 | 400 ms |
| Home (desktop)           | 100  | 96   | 93  | 58    | 0.6 s | 0.001 | 0 ms   |
| Pricing (mobile)         | 97   | 100  | 93  | 58    | 2.2 s | 0     | 30 ms  |
| How it works (mobile)    | 92   | 100  | 93  | 58    | 3.0 s | 0     | 20 ms  |
| Sample verdicts (mobile) | 92   | 100  | 93  | 58    | 2.9 s | 0     | 110 ms |

After the fix merged (#135, `main` `7e13eea`, `Deploy staging` run 126),
run 5 (33568475343, 22:53–23:00 UTC, 390 px, both themes, 28 captures,
no console errors, no overflow) measured:

| Page                     | Perf | A11y | BP  | SEO\* | LCP   | CLS   | TBT    |
| ------------------------ | ---- | ---- | --- | ----- | ----- | ----- | ------ |
| Home (mobile)            | 87   | 100  | 93  | 58    | 2.6 s | 0.001 | 300 ms |
| Home (desktop)           | 100  | 100  | 93  | 58    | 0.6 s | 0.001 | 0 ms   |
| Pricing (mobile)         | 97   | 100  | 93  | 58    | 2.2 s | 0     | 30 ms  |
| How it works (mobile)    | 92   | 100  | 93  | 58    | 3.1 s | 0     | 30 ms  |
| Sample verdicts (mobile) | 91   | 100  | 93  | 58    | 3.0 s | 0     | 120 ms |

Accessibility is 100 on every pair with no failing audit; this is the
table of record for the production gate.

\* SEO 58 is staging's own `noindex` (`X-Robots-Tag` and `Disallow: /`),
by design; production is crawlable. Best practices 93 on every page is
the "errors logged to console" audit catching the CSP-blocked Cloudflare
beacon (Known issues). Layout shift is 0 or 0.001 everywhere, against
0.158 (Home) and 0.706 (Pricing, How it works) before the upgrade; Home
mobile's blocking time is the SPA's script execution on a throttled CPU,
not the visuals. The single 96 (Home desktop in run 3, Home mobile in
run 4) is the hero's mid-entrance opacity, fixed before the production
deploy (Known issues).

## Known issues

- **Cloudflare Web Analytics beacon blocked by the CSP** (staging and
  production alike, pre-existing, not introduced by this upgrade): the
  zone injects `static.cloudflareinsights.com/beacon.min.js` and an
  inline loader into every HTML response and `script-src 'self'
https://cdn.paddle.com` refuses both, so every page logs two CSP
  violations and the beacon never runs. Owner decision recorded in
  `HUMAN_DECISION_BLOCKERS.md` (recommended: switch the automatic
  injection off at the zone). Cost today: Lighthouse best practices 93
  instead of 100 and console noise; no functional impact.
- Home (mobile) performance 84: blocking time from the SPA's own
  JavaScript at 4× CPU throttling; the design work did not add script
  (the hero's loop is CSS) and the entry chunk is smaller than before.
  Application-level follow-up, outside this upgrade's scope.
- Accessibility 96 on one Home pair per run (desktop in run 3, mobile
  in run 4): the audit's axe pass sampled the hero mid-entrance, when the
  engine head and the eight rows sat at 35% opacity for up to 1.6 s of
  every scene, and failed colour contrast on that text (19 nodes in run
  4's mobile report, none anywhere else on the page). Fixed before the
  production deploy: hero entrances no longer use opacity on text (wipe,
  slide, border and mark animations instead), verified with axe
  colour-contrast passes at nine offsets after load at both widths.
