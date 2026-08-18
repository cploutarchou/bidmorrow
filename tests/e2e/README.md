# End-to-end tests (Playwright)

This directory is a **scaffold only**. The actual E2E suites arrive in
**Phase 12** and are **not part of the Phase 2 CI pipeline** — do not add a
Playwright step to `.github/workflows/ci.yml` before then.

## What exists now

- `playwright.config.ts` at the repo root: single chromium project,
  `testDir: tests/e2e`, and a `webServer` entry that starts the app via
  `pnpm dev` on port 8787 (reusing an already-running dev server locally).
- `@playwright/test` pinned in root `devDependencies`.

## Running (once suites exist, Phase 12)

```sh
pnpm exec playwright test
```

In the sandboxed dev environment, browsers are preinstalled under
`/opt/pw-browsers` (Chromium at `/opt/pw-browsers/chromium`) — configure
`launchOptions.executablePath` or `PLAYWRIGHT_BROWSERS_PATH` instead of
running `playwright install`.

## Conventions (for Phase 12 authors)

- Specs live here as `*.spec.ts`, named after the user journey they cover
  (e.g. `signup-onboarding.spec.ts`, `digest-settings.spec.ts`).
- E2E tests exercise the real Worker (wrangler dev) end to end; anything that
  can be covered by a unit or worker-integration test should be.
