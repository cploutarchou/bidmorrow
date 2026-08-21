---
name: launch-mode
description: Operate the pre-launch gate (registrations + new subscriptions closed in production until the end-of-August launch) — check status, preview the countdown, verify the gates, and execute the go-live flag flip. Use when asked about launch state, to open/close signups, or on launch day.
---

# Launch mode (pre-launch gate + go-live)

## How it works (implemented 2026-08-21)

Two admin-editable feature flags (`packages/config/src/feature-flags.ts`,
managed in the internal admin → Flags with the `UPDATE_FLAG` typed
confirmation; every change writes an audit event):

| Flag          | Shape                         | Absent default                                                                 | Effect                                                                                                                                           |
| ------------- | ----------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prelaunch`   | JSON boolean                  | **environment-aware**: `true` on `APP_ENV === 'production'`, `false` elsewhere | While true: `POST /api/auth/sign-up/email` → 403 `signups_closed`; `POST /api/billing/checkout` → 403 `subscriptions_closed`; countdown UI shows |
| `launch_date` | JSON string, ISO-8601 instant | `2026-08-31T21:00:00Z` (midnight Aug 31 → Sep 1, Cyprus)                       | The instant the public countdown counts to                                                                                                       |

Resolution lives in `apps/worker/src/prelaunch.ts` (pure resolver +
tests in `prelaunch.test.ts`). The SPA reads
`GET /api/public-config` → `{ prelaunch, launchDate }` (unauthenticated,
secret-free, 60s cache; `apps/web/src/lib/public-config.ts`) and renders:

- a site-wide launch banner + countdown (`components/LaunchCountdown.tsx`,
  `MarketingLayout.tsx`) on every marketing page,
- the "Registrations open at launch" card on `/signup`
  (`pages/auth/Signup.tsx`),
- the "Subscriptions open at launch" note replacing the Subscribe CTAs in
  Settings → billing (`pages/app/Settings.tsx`).

NOT gated (deliberately): log-in, verification, password reset, every
existing-account flow, the billing portal/cancel, and admin.

## Status check

```bash
curl -s https://bidmorrow.com/api/public-config          # production
curl -s https://staging.bidmorrow.com/api/public-config  # staging
```

`{"prelaunch":true,...}` in production = closed (expected until launch);
staging should normally report `false`.

## Preview the countdown on staging

Admin → Flags → set `prelaunch` to `true` on STAGING (typed confirmation
`UPDATE_FLAG`). Flip back to `false` when done — E2E signup flows on
staging need it open.

## Go-live (launch day) — the whole flip, no deploy

1. In the PRODUCTION admin → Flags, set `prelaunch` to `false`
   (`UPDATE_FLAG` typed confirmation; audit event records who/when).
2. Verify: `curl -s https://bidmorrow.com/api/public-config` returns
   `"prelaunch":false`; create-account page shows the form; the launch
   banner is gone (allow up to 60s for the public-config cache).
3. Sanity: a real signup → verification email → login works in
   production.
4. Remember the REST of go-live is separate: un-pausing production
   ingestion (`ingestion_paused` flag) and the held Phase 13/14 pipeline
   (see IMPLEMENTATION_LEDGER.md).

## Emergency re-close

Set `prelaunch` back to `"true"` in production admin → Flags. Takes
effect immediately server-side (the 60s public-config cache only delays
the banner, not the gates).

## Rules

- Never flip production flags without an explicit owner instruction.
- The absent-flag default is environment-aware BY DESIGN — do not "seed"
  `prelaunch` in production unless overriding the default; absence
  already means closed there.
- Any change to gate behavior needs `apps/worker/src/prelaunch.test.ts`
  updated and the full gates + E2E green (see run-quality-gates skill).
