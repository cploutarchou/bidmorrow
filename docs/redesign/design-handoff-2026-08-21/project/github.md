repo: cploutarchou/bidmorrow
branch: main
path: apps/web

## Last sync

date: 2026-08-20T11:26:00Z

- Read the two surfaces that had never been prototyped: `pages/auth/*` (+ `lib/auth-context.tsx`, `lib/post-auth-route.ts`) and the whole `/admin/*` subtree (`components/admin/*`, `pages/admin/*`, `lib/admin-api.ts`, `lib/admin-types.ts`, `lib/admin-scope.ts`, `lib/admin-date-range.ts`). No upstream changes needed to existing screens.

### Updated in this project

- Marketing pages built (`BidMorrow Marketing.dc.html`): three pages behind one nav — how-it-works (five steps, each with its own animated diagram in the homepage's motion vocabulary: profile chips, TED scan, score bars, feed sort, digest week), methodology, built from Methodology.tsx and the copy.ts statements it renders (the 100-point component split with each component's published missing-data policy — CPV fit exempt because a CPV code is mandatory on every notice — the four component verdicts, the classification tiers, risk flags with their confirmed/possible labelling and the eight detected categories, the CPV pre-filter disclosure with what it buys and costs, the five hard exclusions, and the scoped-not-exhaustive CPV coverage), and pricing (founding €29 highlighted against standard €49, with a twelve-month price-hold comparison). Copy is written for the marketing surface rather than lifted from the repo components; the facts — plan prices, founding price retained for the life of the subscription, component maximums, tier bands, exclusion rules, CPV scope — follow the source.
- The five prototypes now link as one product: homepage log-in and pilot CTAs open the auth prototype, homepage footer opens the marketing pages (`#pricing` deep-links the pricing page), and a successful login opens the file its resolved destination names — onboarding for an incomplete profile, the client area for a complete one.

- Auth prototype built (`BidMorrow Auth.dc.html`): log in, create account, verify email, forgot password, new password — plus the real post-auth routing rule (a safe saved destination wins, otherwise an incomplete profile goes to onboarding and a complete one to the feed), the unverified-login refusal with resend, the neutral reset confirmation that never reveals whether an account exists, and the missing-token and expired-link states. An account simulator switches between new / onboarded / unverified / wrong-password / saved-destination.
- Admin CRM prototype built (`BidMorrow Admin.dc.html`): all ten sections from `AdminShell` — dashboard health and usage, organizations + organization detail, users, subscriptions, ingestion, matching, digest, support notes, audit, flags. Every mutation goes through one typed-confirmation strip carrying the exact API confirm literal (SUSPEND_ORGANIZATION, PAUSE_INGESTION, UPDATE_INGESTION_SCOPE, RUN_BACKFILL, RECOMPUTE_MATCHES, PAUSE_DIGEST, UPDATE_FLAG) and appends a real audit event visible in the Audit section; pause states show in the header pills. Client-side bounds mirror the server validators: CPV scope (≥1 family, ≤20, 2–8 chars, 2-letter countries), backfill window (ISO dates, ≤31 days), recompute caps (100 notice / 500 lot IDs), JSON-literal flag values. Ops state persists in `localStorage`.
- Ingestion covers everything its page owns: runs (clicking a run opens its errors), the bounded fetch-retry queue with pending/recovered/abandoned counts, per-run error records with expandable detail JSON, and the notice debug lookup (versions with their lots, R2 snapshot keys and deletions). Backfill is bounded to 90 days, matching MAX_BACKFILL_DAYS.
- Digest covers runs, email failures (to, kind, provider, error, created) and a preview showing subject, text alternative and the raw HTML source as escaped text — never injected as markup, per the repo-wide ban on dangerouslySetInnerHTML.
- Ingestion runs distinguish genuine fetch failures from render-pending skips, and the dashboard reports an unmeasured database size as unmeasured rather than zero — both faithful to the real DTOs.

## Screen map

| Screen | Repo files |
| --- | --- |
| Theme tokens | apps/web/src/styles.css (`:root`, lines 23–126) |
| Client area prototype (feed, detail sheet, pipeline, insights) | apps/web/src/pages/app/Feed.tsx, components/TenderCard.tsx, components/AppShell.tsx, components/ScoreBadge.tsx, components/Logo.tsx, copy.ts, lib/types.ts, lib/format.ts |
| Client area — settings | apps/web/src/pages/app/Settings.tsx, pages/app/Onboarding.tsx, lib/onboarding-types.ts, lib/onboarding-reference-data.ts, lib/onboarding-scope.ts |
| Onboarding prototype | apps/web/src/pages/app/Onboarding.tsx, packages/domain/src/presets.ts, data/cpv-suggestions.ts, lib/onboarding-reference-data.ts, lib/onboarding-scope.ts |
| Marketing pages (how it works, methodology, pricing) | apps/web/src/pages/marketing/HowItWorks.tsx, pages/marketing/Pricing.tsx, docs/matching-engine.md |
| Marketing homepage | apps/web/src/copy.ts, lib/format.ts, docs/matching-engine.md, pages/marketing/Home.tsx, pages/marketing/Pricing.tsx, pages/marketing/HowItWorks.tsx |
| Admin CRM prototype (10 sections) | apps/web/src/components/admin/AdminShell.tsx, AdminGate.tsx, ConfirmAction.tsx, Pager.tsx, pages/admin/Dashboard.tsx, Organizations.tsx, OrganizationDetail.tsx, Users.tsx, Subscriptions.tsx, Ingestion.tsx, Matching.tsx, Digest.tsx, Support.tsx, Audit.tsx, Flags.tsx, lib/admin-api.ts, lib/admin-types.ts, lib/admin-scope.ts, lib/admin-date-range.ts, lib/admin-confirm.ts |
| Auth prototype (login, signup, verify, forgot, reset) | apps/web/src/pages/auth/AuthLayout.tsx, Login.tsx, Signup.tsx, ForgotPassword.tsx, ResetPassword.tsx, VerifyEmail.tsx, lib/auth-context.tsx, lib/post-auth-route.ts |

## Sync history

- 2026-08-20T09:12:00Z — upstream unchanged; homepage footer/step ink roles corrected.
- 2026-08-19T20:52:00Z — client area, onboarding and homepage prototypes built and reconciled with the real schema (settings fields, CPV suggestions, presets, score components, classification bands); Archivo type, geo detection, GA4 consent.
- 2026-08-19T17:59:53Z — linked the repo, read the theme layer only; no screens rebuilt.
