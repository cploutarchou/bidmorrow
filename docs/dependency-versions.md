# Dependency & Platform Version Register

Verified against official sources on **2026-08-14** (npm registry for
versions; official docs for behavior). Re-verify via the verify-current-docs
skill before relying on any entry older than ~1 month.

## Pinned application dependencies (Phase 2 targets)

| Package                         | Version                 | Notes                                                                                                                                                        |
| ------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| typescript                      | 5.9.x pin               | npm latest is 7.0.2 (native-compiler era); we pin the mature 5.x line until the Vite/Vitest plugin ecosystem is verified on TS7 (revisit Phase 12)           |
| pnpm                            | 11.x                    | workspace manager                                                                                                                                            |
| hono                            | 4.13.x                  | built-in secure-headers/csrf/cors middleware; validation via @hono/zod-validator 0.9.x                                                                       |
| react / react-dom               | 19.2.x                  |                                                                                                                                                              |
| vite                            | 8.2.x                   | Vite 8 is current stable                                                                                                                                     |
| vitest                          | 4.1.x                   | Vitest 5 is RC — do not adopt                                                                                                                                |
| @cloudflare/vitest-pool-workers | 0.21.x                  | peer vitest ^4.1.0; Vite-plugin architecture (`cloudflareTest()`); D1 migrations in tests via readD1Migrations/applyD1Migrations; per-file storage isolation |
| @playwright/test                | 1.62.x                  |                                                                                                                                                              |
| wrangler                        | 4.x (4.123.0)           | wrangler.jsonc recommended config format; `migrations_pattern` supports Drizzle nested layout                                                                |
| drizzle-orm / drizzle-kit       | 0.45.2 / 0.31.10        | 1.0 at rc.4 — pin 0.45.x, revisit after 1.0 stable                                                                                                           |
| better-auth                     | 1.6.29                  | 1.7 at rc — pin stable; no beta/RC auth (project rule)                                                                                                       |
| @better-auth/drizzle-adapter    | 1.6.x                   | official adapter package (moved out of better-auth core path); peer drizzle-orm ^0.45.2                                                                      |
| stripe                          | 22.x                    | pinned API version 2026-07-29.dahlia; Workers requires `constructEventAsync` (SubtleCrypto)                                                                  |
| resend                          | 6.x                     | fetch-based; Workers-compatible; batch ≤100/call; default rate limit 2 req/s                                                                                 |
| zod                             | 4.x (verify at install) | validation at API boundary                                                                                                                                   |

## Platform facts (Cloudflare, verified 2026-08-14)

- Workers Paid $5/mo: 10M req + 30M CPU-ms/mo; static asset requests free/unlimited.
- **D1**: max **10 GB/database (paid)**; $5 plan includes 25B row reads, 50M row
  writes, 5 GB storage/mo; 1,000 queries per invocation; 100 KB max statement.
- **D1 Time Travel**: 30-day retention (paid), free, always-on.
  Bookmark: `wrangler d1 time-travel info <DB>`; restore:
  `wrangler d1 time-travel restore <DB> --bookmark=<B>`.
- **Queues**: at-least-once delivery (consumers must be idempotent); paid plan
  1M ops/mo included then $0.40/M; msg ≤128 KB; batch ≤100; DLQ support;
  free tier exists (10k ops/day) but we run on paid anyway.
- **Cron Triggers**: 250/account (paid). Cron/queue invocations get up to
  15 min CPU.
- **Workers Static Assets** is the recommended SPA hosting (Pages is
  maintenance-mode for new projects): `assets.not_found_handling:
"single-page-application"`, `run_worker_first: ["/api/*"]`.
- **Native rate-limiting binding**: GA since 2025-09; `[[ratelimits]]` with
  `simple = { limit, period: 10|60 }`; per-colo best-effort; no extra cost.
- **Workflows**: GA but bills per-step since ~2026-08 — not used (ADR-0006).
- **R2**: free tier 10 GB + 1M Class A + 10M Class B per month; lifecycle
  rules supported (age-based deletion / IA transition).

## Stripe facts

- Current API version: `2026-07-29.dahlia`; monthly dated versions,
  biannual named majors.
- Subscription webhook set (verify wording again in Phase 9):
  `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.paid`, `invoice.payment_failed`.
- Ordering NOT guaranteed; at-least-once delivery → dedupe on event ID +
  re-fetch object state from the API instead of trusting payload order.

## Better Auth facts

- Cookie sessions, DB session table, 7-day expiry / 1-day updateAge defaults.
- CSRF: origin-header validation against `trustedOrigins` (token-less) +
  Fetch Metadata; never disable.
- Email verification + password reset built in, with anti-enumeration
  (uniform responses).
- Organization plugin is first-party in core — used for org modeling.
- Rate limiting built-in; storage must be `"database"` or secondary storage
  on Workers (in-memory default is unusable there).
- Workers requires `nodejs_compat` compatibility flag (AsyncLocalStorage).
- With the Drizzle adapter, auth schema is CLI-generated
  (`npx @better-auth/cli generate`) then migrated via drizzle-kit/wrangler —
  programmatic `getMigrations` does NOT work with the Drizzle adapter.

## TED / eForms / CPV / NUTS

See docs/ted-data-source.md (research recorded separately).

## Known imminent majors (watchlist)

Drizzle 1.0 (rc.4) · Better Auth 1.7 (rc.6) · Vitest 5 (rc.1) · TS 7 native.
None adopted pre-stable; revisit at Phase 12.

## Website redesign — M0.1 Strata design-system foundation (2026-08-17)

Verified via the npm registry (`npm view <pkg> version`, per the
verify-current-docs skill's approved source list) plus direct inspection of
the installed package contents (README, shipped CSS, `dist/` source) —
`fontsource.org`/`lucide.dev` doc pages were not reachable from this
environment (no outbound web-fetch tool available to this session), so API
syntax was confirmed empirically against the actual published package
output rather than the docs site. Record superseded if a future session can
cross-check against the live docs.

| Package                               | Version | Role                                                                                                  | License |
| ------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------- | ------- |
| `lucide-react`                        | 1.31.0  | dependency — runtime UI icon components (not yet used in any component this chunk; available for M1+) | ISC     |
| `@fontsource/sora`                    | 5.3.0   | devDependency — source of the vendored display-face woff2 (static 700 cut)                            | OFL-1.1 |
| `@fontsource/hanken-grotesk`          | 5.3.0   | devDependency — source of the vendored body-face woff2s (static 400 + 700 cuts)                       | OFL-1.1 |
| `@fontsource-variable/jetbrains-mono` | 5.3.0   | devDependency — source of the vendored mono-face woff2 (variable wght axis)                           | OFL-1.1 |

Rationale: `lucide-react` — tree-shakable per-icon ESM, verified empirically
(grepped the published dist) to contain zero runtime `<style>`-element
injection, so it is clean under `style-src 'self'`; ISC license; React 19
peer range confirmed in its `package.json`
(`"react": "^16.5.1 || ^17.0.0 || ^18.0.0 || ^19.0.0"`); named-export
pattern confirmed by reading `dist/esm/lucide-react.mjs` directly
(`import { IconName } from 'lucide-react'`). No icon is wired into a
component yet — M0.1 only installs and records it per
`docs/redesign/dependency-evaluation.md` item 1.

Fonts — the three `@fontsource*` packages are **devDependencies only**:
none of their JS/CSS is imported at runtime (their wholesale per-weight CSS
is explicitly not used, per `docs/redesign/dependency-evaluation.md` item
2). Instead, the specific woff2 files needed are copied once into
`apps/web/src/assets/fonts/` (vendored, committed) and referenced by
hand-written `@font-face` rules in `apps/web/src/styles.css`, imported via
ordinary Vite-relative `url()` paths (processed by Vite's CSS asset
pipeline — hashed in `pnpm build` output). The npm packages remain
installed so the exact source version + OFL-1.1 license text
(`apps/web/src/assets/fonts/LICENSE-*.txt`, copied from each package) stay
traceable to a real, auditable upstream release rather than a hand-typed
copy.

**Font payload — measured (2026-08-17), not estimated:**

| File shipped                                                                              | Face / weights covered                                                                                                                                     | Bytes                   |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `sora-latin-700.woff2` (from `@fontsource/sora` `700.css`)                                | Sora, static 700 cut, declared `font-weight: 600 700` (covers h1–h4 @600 and the wordmark/price-amount @700 with one file)                                 | 15,128                  |
| `hanken-grotesk-latin-400.woff2` (from `@fontsource/hanken-grotesk` `400.css`)            | Hanken Grotesk, static 400 cut, declared `font-weight: 400` (body copy)                                                                                    | 13,460                  |
| `hanken-grotesk-latin-700.woff2` (from `@fontsource/hanken-grotesk` `700.css`)            | Hanken Grotesk, static 700 cut, declared `font-weight: 500 700` (covers nav-link @500, label/heading @600, and button @700 with one file)                  | 13,844                  |
| `jetbrains-mono-latin-wght.woff2` (from `@fontsource-variable/jetbrains-mono` `wght.css`) | JetBrains Mono, variable wght axis, declared `font-weight: 100 800` (exact 400/500/700 — chip labels, score readouts, deadlines all need distinct weights) | 40,404                  |
| **Total**                                                                                 |                                                                                                                                                            | **82,836 B ≈ 80.89 KB** |

Budget: ≤90KB (requirements.md §Decisions log, 2026-08-17 Strata approval).
**80.89 KB ships, 9.11 KB (≈10%) under budget.**

Trimming decisions (why these specific files, not the alternatives also
measured):

- Display (Sora) and body (Hanken Grotesk) each ship **static single-weight
  cuts with a `font-weight` range descriptor** rather than a full variable
  file: a static cut is smaller per-weight, and declaring e.g.
  `font-weight: 500 700` on the 700 cut makes the browser use that face for
  any of 500/600/700 without triggering synthetic (fake) bold — the
  trade-off is that those three weights render visually identical (all at
  the 700 cut's boldness) instead of three distinct weights. Measured:
  two static cuts (400 + range 500-700) = 27,304 B vs. the full variable
  file = 34,704 B — static duo is 7,400 B cheaper. Applied the same
  reasoning to Sora (single 700 cut covering 600 + 700) since Sora is only
  ever used at those two weights.
- Mono (JetBrains Mono) ships the **variable axis file instead of static
  cuts**: measured the opposite way around — two static cuts (400 + range
  500-700, 43,076 B) cost _more_ than the single variable file (40,404 B)
  **and** the variable file gives exact 400/500/700 weights with no
  collapsing. Since the mono face carries the score numerals (the
  product's single most important on-page number) and chip labels where a
  visible 500-vs-700 distinction matters most, exact weights were
  prioritized here — and it was free to do so.
- `latin-ext` subset files, italics, and weights 100–300/800–900 are not
  shipped (not used by the approved mockup; English-only launch — re-add
  `latin-ext` at i18n activation per
  `docs/redesign/dependency-evaluation.md` item 2).
- Full measured alternative-combination comparison performed before
  settling on the above (all combinations use woff2 only, no woff
  fallback — no supported target browser needs it):
  - All-static (Sora 700 + Hanken 400+700 + Mono 400+700range): 85,508 B ≈
    83.50 KB — fits, but loses mono weight fidelity for no size benefit
    over the variable-mono option. Rejected in favor of the shipped combo.
  - All-variable (Sora Variable + Hanken Grotesk Variable + JetBrains Mono
    Variable): 33,652 + 34,704 + 40,404 = 108,760 B ≈ 106.21 KB — **over
    budget**, rejected outright.
  - Hanken variable instead of static duo (full body-weight fidelity) +
    Sora static 700 + Mono variable: 34,704 + 15,128 + 40,404 = 90,236 B ≈
    88.12 KB — fits with only 1.88 KB headroom; rejected as too fragile
    (near-zero margin for the copy/spacing work still to come in M1–M3) in
    favor of the shipped 80.89 KB combination.

## Website redesign — Control Room re-skin (2026-08-18): fonts removed

Superseding the M0.1 Strata font section above: the owner switched the
approved design direction to Direction B "Control Room" (2026-08-18
decision log, `.claude/skills/website-redesign/requirements.md`), which
specifies system font stacks only (`-apple-system` sans, `ui-monospace`
mono) — **no webfonts**. Removed in this change:

- devDependencies `@fontsource/sora`, `@fontsource/hanken-grotesk`,
  `@fontsource-variable/jetbrains-mono` (`apps/web/package.json`; lockfile
  updated via `pnpm install`).
- The vendored `apps/web/src/assets/fonts/` directory (four `.woff2` files
  - three `LICENSE-*.txt` files, ~80.89 KB) and the hand-written
    `@font-face` rules that referenced them in `apps/web/src/styles.css`.

Font payload after removal: **0 B** (system stacks ship nothing over the
wire). The 80.89 KB budget analysis above is retained for the historical
record but no longer applies — there is no font budget to track while the
Control Room design ships zero custom fonts.

## Unverified / to re-check when network allows

- Resend pricing tiers (free 3k/mo, $20/50k figures from secondary sources).
- Stripe webhook-set page wording (verified via snippets + stripe-node source).

## TED notice-XML download route (2026-08-18)

- The anonymous `ted.europa.eu/<lang>/notice/<id>/xml` front-end switched to
  asynchronous rendering (HTTP 202 + empty body first, cached XML later) —
  verified live via the `ted-diagnose` workflow (runs 32131289081,
  32131832286, 32132169652). `docs/ted-data-source.md` carries the full
  behavior record; `TedClient`/`runIngestionWindow` implement 202-aware
  requeue cycling.
- `GET api.ted.europa.eu/v3/notices/{publication-number}/xml` is the
  authenticated alternative (`400 Missing Authorization header` without a
  key — verified in the same runs). The client ships `Authorization:
Bearer <TED_API_KEY>`; **UNVERIFIED against the live API** until the owner
  stores `TED_API_KEY` (HUMAN_DECISION_BLOCKERS item 9) and the
  `ted-key-verify` workflow is dispatched — do not enable the key in any
  environment before that run confirms the header shape (update
  `packages/ted/src/client.ts` first if only the raw-key shape works).
