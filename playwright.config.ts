import { defineConfig, devices } from '@playwright/test';

// Playwright E2E suite (Phase 12 stage A: critical-path + accessibility).
//
// NOT wired into the Phase 2 CI pipeline yet — Phase 12 stage B decides CI
// wiring; do not add a Playwright step to .github/workflows/ci.yml before
// then. Run locally via `pnpm test:e2e`.
export default defineConfig({
  testDir: 'tests/e2e',
  // The critical-path spec is a single, ordered signup->onboarding->feed
  // journey against one seeded worker; keep it single-worker so specs that
  // depend on earlier state (e.g. the mailbox, the created org) stay
  // deterministic rather than racing another spec file's writes.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:8787',
    // Emulate reduced motion for deterministic runs. The app honors
    // `prefers-reduced-motion` (styles.css) by switching `scroll-behavior`
    // from smooth to auto; without this, Playwright's programmatic
    // scroll-into-view races the smooth-scroll animation on long pages
    // (e.g. the 51-keyword Settings form) and reports the target as
    // "not stable"/"outside of the viewport" until it times out. Real
    // users click what they see, so this is a harness-stability fix, not a
    // change to shipped behavior — and it also exercises the reduced-motion
    // code path.
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Prefer a preinstalled Chromium when the environment provides one
        // (sandboxed dev containers set PLAYWRIGHT_CHROMIUM_PATH or ship
        // /opt/pw-browsers/chromium at a revision that may not match this
        // @playwright/test version's expected download). In CI/local runs
        // without one, Playwright resolves its own installed browser.
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH !== undefined
          ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
          : {}),
      },
    },
    {
      // Mobile pass (audit testing minor): the same Chromium at a phone
      // viewport with touch, scoped to the public pages and the auth
      // screens — the surfaces an anonymous visitor or brand-new customer
      // actually hits from a phone. The authenticated specs stay
      // desktop-only on purpose: they are a single ordered journey against
      // seeded worker state, and running that flow twice per run would
      // double the suite's longest leg for surfaces the ICP uses at a desk.
      // `devices['iPhone 12']` normally implies mobile Safari; branded
      // `defaultBrowserType: 'chromium'` keeps the preinstalled-Chromium
      // override usable in the sandbox, at the cost of engine fidelity —
      // this project tests LAYOUT at 390px, not WebKit behavior.
      name: 'mobile-chromium',
      testMatch: /(marketing|auth-session|accessibility)\.spec\.ts/,
      grepInvert: /authenticated pages/,
      use: {
        ...devices['iPhone 12'],
        defaultBrowserType: 'chromium',
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH !== undefined
          ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
          : {}),
      },
    },
  ],
  webServer: {
    // scripts/e2e-webserver.sh: builds the web SPA, writes a fresh
    // apps/worker/.dev.vars (E2E_TEST_HOOKS=true, see that script's header),
    // resets local D1 state, applies migrations + scripts/seed-demo.sql,
    // then starts `wrangler dev` on :8787 (serves /api/* and the built SPA).
    command: 'bash scripts/e2e-webserver.sh',
    port: 8787,
    // Building + migrating + seeding + wrangler dev cold start can take a
    // while — generous timeout so a slow (but working) sandbox never
    // false-fails the readiness probe.
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
