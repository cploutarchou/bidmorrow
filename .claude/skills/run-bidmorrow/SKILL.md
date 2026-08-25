---
name: run-bidmorrow
description: Build, launch, drive and screenshot the BidMorrow app locally — the marketing site AND the authenticated product (feed, tender detail, onboarding, settings). Use to run or start the app, reproduce a UI bug, take a screenshot, check a change in the real running app rather than in tests, or call internal package code directly.
---

# Run BidMorrow

BidMorrow is one deployable unit: a Hono Worker (`apps/worker`) that serves
`/api/*` **and** the built React SPA (`apps/web`) as Workers Static Assets.
There is no separate frontend server — everything is `http://127.0.0.1:8787`.

Almost everything interesting is behind auth (signup → email verification →
a 5-step onboarding wizard → a scoring pass). Reaching the feed by hand is
tedious and easy to get wrong, so this skill ships a driver that does it:

**`.claude/skills/run-bidmorrow/driver.mjs`** — starts the stack, creates a
real onboarded account through the real UI, and then screenshots / dumps /
pokes any route with that session.

All paths and commands below are relative to the repo root.

## Prerequisites

Node 22+ and pnpm (via corepack) are the only hard requirements. Verified here:

```bash
node -v          # v24.19.0
corepack enable
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile
```

**Do not run `npx playwright install`.** It is not needed and costs ~150 MB of
download. The driver uses the system Chrome already present at
`/usr/bin/google-chrome`. If your Chrome is elsewhere:

```bash
export PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome
```

`playwright.config.ts` honours the same variable, so the repo's own E2E suite
works with the system browser too.

No apt packages were needed — headless Chrome ran as-is.

## Run (agent path)

One command takes you from a clean checkout to screenshots of every surface:

```bash
node .claude/skills/run-bidmorrow/driver.mjs smoke
```

That runs `up` → `bootstrap` → screenshots `/`, `/pricing`, `/how-it-works`,
`/app`, `/app/settings`, then asserts the feed actually has scored tender
cards. Takes ~30 s on a warm checkout. Real output:

```
[driver] signing up + onboarding "Smoke Co" through the real UI (takes ~30-60s)...
[driver] onboarded account: smoke-co-1787608250016-1@example.test
[driver] / -> /home/chris/workspace/bidmorrow/.run-state/shots/home.png
[driver] /app -> /home/chris/workspace/bidmorrow/.run-state/shots/app.png
[driver] feed shows 3 tender card(s)
[driver] smoke OK
```

Everything lands in `.run-state/` (gitignored): `shots/`, `server.log`,
`server.pid`, `storage.json` (the browser session), `account.json`.

### Individual commands

```bash
node .claude/skills/run-bidmorrow/driver.mjs up        # start stack on :8787
node .claude/skills/run-bidmorrow/driver.mjs status
node .claude/skills/run-bidmorrow/driver.mjs down      # stop it

node .claude/skills/run-bidmorrow/driver.mjs bootstrap "Acme Cyber"
node .claude/skills/run-bidmorrow/driver.mjs whoami

node .claude/skills/run-bidmorrow/driver.mjs shot /app
node .claude/skills/run-bidmorrow/driver.mjs shotfull /pricing pricing-full.png
node .claude/skills/run-bidmorrow/driver.mjs text /pricing
node .claude/skills/run-bidmorrow/driver.mjs console /app     # console + pageerror + failed requests

node .claude/skills/run-bidmorrow/driver.mjs api GET '/api/org/feed?tab=today'
node .claude/skills/run-bidmorrow/driver.mjs score-now         # re-run the scoring engine
```

`bootstrap` only has to run once per stack; the session is reused from
`.run-state/storage.json`. Re-running `up` after a `down` **wipes local D1**
(the underlying script resets `.wrangler/state`), so a cold `up` also deletes
the saved session/account — `smoke` re-bootstraps automatically; after a
manual `up`, run `bootstrap` again.

### REPL — for multi-step flows

```bash
printf 'goto /app\nclick link "Security operations centre consulting"\nurl\nss sheet\nquit\n' \
  | node .claude/skills/run-bidmorrow/driver.mjs repl
```

Or interactively: `node .claude/skills/run-bidmorrow/driver.mjs repl`, then
`help`. Commands: `goto`, `url`, `text [selector]`, `ss [name]`,
`ssfull [name]`, `click <role> "<name>"`, `fill "<label>" <value>`,
`count <selector>`, `eval <js>`, `size <w> <h>`, `quit`. Quote multi-word
arguments.

Verified transcript:

```
[repl] http://127.0.0.1:8787/app
[repl] clicked; now http://127.0.0.1:8787/app/tenders/01M0TW2T42MD6HVSEGY2P80M22
[repl] -> /home/chris/workspace/bidmorrow/.run-state/shots/sheet.png
```

## Direct invocation (no app, no browser)

Most PRs here touch `packages/*`. Plain `node` **cannot** import them — the
packages use extensionless relative imports (`./engine`) that only a bundler
resolves. Use Vitest as the runner, with the scratch test **inside the package
that owns the dependency** (there are no `@bidmorrow/*` links in the root
`node_modules`, so a file under `tests/` cannot import them by name):

```bash
cat > packages/matching/src/scratch.test.ts <<'EOF'
import { test } from 'vitest';
import { scoreLotForOrg, ENGINE_VERSION } from './index';

test('probe', () => {
  console.log('ENGINE_VERSION:', ENGINE_VERSION);
});
EOF
npx vitest run packages/matching/src/scratch.test.ts --disable-console-intercept
rm packages/matching/src/scratch.test.ts
```

`--disable-console-intercept` is required — without it Vitest 4 swallows
`console.log` and the test just prints "1 passed". `--silent=false` does _not_
bring it back.

## Run (human path)

`pnpm dev` runs bare `wrangler dev` — no SPA build, no migrations, no seed. On
a checkout that has never been built it does not start at all:

```
✘ [ERROR] The directory specified by the "assets.directory" field in your
  configuration file does not exist:
  /home/chris/workspace/bidmorrow/apps/web/dist
```

Prefer `driver.mjs up`, which runs
`scripts/e2e-webserver.sh` (build SPA → write `.dev.vars` → reset D1 → migrate
→ seed demo data → `wrangler dev --port 8787 --ip 127.0.0.1`) — the same
command `playwright.config.ts` uses, so local and E2E stacks are identical.

## Test

All verified green in this container:

```bash
pnpm test        # 74+19+9 files, 918 tests — ~2 min
                 # (root vitest, then worker + db suites under workerd)

PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/google-chrome pnpm test:e2e   # 87 passed, 3 skipped, 5.2 min
```

`pnpm test:e2e` reuses an already-running :8787 (`reuseExistingServer`), so it
is fine to leave the driver's stack up.

## Gotchas

- **`pkill -f wrangler` kills your own shell.** `pkill -f` matches full command
  lines including the shell running the pattern, so the command suicides (exit
  143/144) before signalling wrangler. Use `pkill -f '[w]rangler'`. `driver.mjs
down` does this correctly; be careful if you improvise.
- **`/api/health` does not exist** — it is `/api/health/live` (liveness) and
  `/api/health/ready` (DB + ingestion staleness). A polling loop on
  `/api/health` will 404 forever while the server is perfectly up.
- **Clicking a feed card opens a slide-over, not a page.** The card link carries
  `backgroundLocation` state, so the URL changes to `/app/tenders/<id>` while the
  feed stays behind a panel, and `document.title` stays "Feed — BidMorrow".
  `page.locator('h1').first()` returns the _feed's_ heading, not the tender's.
  To get the standalone full page, `goto` the tender URL directly.
- **The slide-over animates.** Screenshotting <500 ms after the click catches it
  half-transparent, mid-slide. The driver waits for networkidle + 800 ms.
- **The cookie consent banner covers the bottom ~100 px** of every marketing
  screenshot and intercepts clicks near it. The driver dismisses it ("Reject
  all") on every navigation.
- **Ready is "stale" on a fresh stack** — `/api/health/ready` returns
  `{"status":"ok", "stale":true, "lastSuccessfulIngestionAt":null}` because no
  ingestion has ever run locally. That is expected, not a broken stack.
- **`score-now` reports `matchesWritten: 0` on a second run.** It is idempotent —
  the matches already exist and get counted as `matchesSkipped`. An empty feed
  after bootstrap is the real failure signal, not this number.
- **`/api/org/feed` requires `?tab=`.** Bare, it 400s with a ZodError listing
  the valid values (`today|strong|worth_reviewing|possible|saved|ignored`).
- **Test hooks are double-gated.** `/api/test/mailbox`, `/api/test/score-now`
  and `/api/test/entitlement-enforced` 404 unless `APP_ENV=local|test` **and**
  `E2E_TEST_HOOKS=true`. `scripts/e2e-write-dev-vars.mjs` (run by `up`)
  regenerates `apps/worker/.dev.vars` with those set; it overwrites any
  `.dev.vars` you were keeping.
- **`up` destroys local D1.** `scripts/e2e-webserver.sh` does `rm -rf
apps/worker/.wrangler/state` for a deterministic seed. Never point any of this
  at staging/production; `scripts/seed-demo.sql` is local-only fake data.
- **Settings/billing looks broken locally but isn't.** With no `PADDLE_*` values in
  `.dev.vars`, `/app/settings` honestly renders "No active subscription." and
  "Billing is not available right now". That is the designed unconfigured
  state, not a bug to chase.
- **The driver is covered by the repo's own gates.** `pnpm format:check` and
  `pnpm lint` include `.claude/`, so run Prettier on `driver.mjs` after editing
  it. `eslint.config.js` allows node globals + `console` for
  `.claude/skills/**/*.mjs`, same block as `scripts/**/*.mjs`.
- **The driver reuses `tests/e2e/helpers.ts` on purpose.** Node 22+/24 strips
  the TypeScript natively and Playwright's `expect` works outside the test
  runner, so onboarding steps live in exactly one place. If onboarding changes
  and the E2E suite is updated, the driver follows automatically.

## Troubleshooting

| Symptom                                                             | Fix                                                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Cannot find package '@playwright/test'`                            | The script must live inside the repo (root `node_modules` resolution). Don't run driver copies from `/tmp`.                                      |
| `Cannot find module '.../packages/matching/src/engine'`             | You tried plain `node` on a package. Use the Vitest scratch-test path above.                                                                     |
| `Cannot find package '@bidmorrow/matching'` from a file in `tests/` | Root `node_modules` has no workspace links. Put the scratch test inside a package that depends on it.                                            |
| Chrome fails to launch / sandbox error                              | The driver passes `--no-sandbox --disable-dev-shm-usage`. Keep them for containers.                                                              |
| `[driver] stack did not become live within 180s`                    | `tail -40 .run-state/server.log`. Usually a port clash — `node driver.mjs down`, then retry.                                                     |
| Port 8787 still busy after `down`                                   | `pkill -f '[w]orkerd'` (bracket form, see Gotchas).                                                                                              |
| `no bootstrapped account`                                           | `node .claude/skills/run-bidmorrow/driver.mjs bootstrap`.                                                                                        |
| Feed empty after bootstrap                                          | `node driver.mjs score-now`, then `shot /app`. If still empty, the org has no CPV preferences — the wizard's step 3 must save at least one code. |
| Vitest scratch test prints nothing                                  | Add `--disable-console-intercept`.                                                                                                               |
