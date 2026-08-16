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
