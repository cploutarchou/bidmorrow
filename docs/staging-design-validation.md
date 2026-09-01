# Staging validation: website visual upgrade (2026-09-01)

Phase 7 of `docs/design-redesign-plan.md`. The development sandbox cannot
reach `staging.bidmorrow.com` (egress policy), so everything below was
produced by GitHub Actions runs against staging and read from their logs
and artifacts.

## Deployment

- Environment: the existing staging Worker + static assets, deployed by
  `deploy-staging.yml` on push to `main` (no new infrastructure).
- Pull request: #134 (squash-merged; commit recorded below).
- Deploy run: pending.

## Commit

Pending (the squash commit on `main`).

## Test results

- CI on the PR head: secret-scan and the full checks job (format, lint,
  typecheck, unit, D1 and worker suites, build verification).
- Local Playwright (marketing, accessibility, keyboard): 41 passed on the
  final build.
- Staging smoke: `deploy-staging.yml`'s own post-deploy checks.

## Visual verification

`design-review.yml` (label `staging`): screenshots of every public route
at 375 / 390 / 430 / 768 / 1024 / 1280 / 1440 / 1920 in light and dark,
with the capture script's console-error and horizontal-overflow checks.
Pending.

## Performance

Lighthouse (five baseline pairs) from the same workflow run. Pending.

## Known issues

Pending.
