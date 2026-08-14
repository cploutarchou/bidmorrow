import { defineConfig, devices } from '@playwright/test';

// Playwright E2E scaffold — configuration only.
//
// Actual E2E suites arrive in Phase 12 (see tests/e2e/README.md). This config
// is NOT wired into the Phase 2 CI pipeline; do not add a Playwright step to
// .github/workflows/ci.yml before Phase 12.
export default defineConfig({
  testDir: 'tests/e2e',
  use: {
    baseURL: 'http://127.0.0.1:8787',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // In the sandboxed dev environment, Chromium is preinstalled at
        // /opt/pw-browsers/chromium — point Playwright at it via
        //   launchOptions: { executablePath: '/opt/pw-browsers/chromium' }
        // (or set PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers) instead of
        // downloading browsers with `playwright install`.
      },
    },
  ],
  webServer: {
    // `pnpm dev` starts the worker (wrangler dev) which serves the SPA and
    // API on port 8787.
    command: 'pnpm dev',
    port: 8787,
    reuseExistingServer: !process.env.CI,
  },
});
