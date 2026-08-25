# Navigation & admin entry — UX/UI spec (2026-08-26)

Owner request: "navigation buttons are missing; an administrator who logs in
must see an Admin button; improve the UI and the admin area."

## 1. UX audit (what is actually wrong today)

| #   | Finding                                                                                                                                                                     | Evidence                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| N1  | The app header has only **Feed** and **Settings**. The Saved shelf, Billing and the Admin surface are all reachable only by knowing a URL or a tab.                         | `components/AppShell.tsx` nav list                                               |
| N2  | An admin has **no entry point** to `/admin`. The client never learns whether the signed-in user is an operator (`auth-context` exposes id/email/name only).                 | `lib/auth-context.tsx`; `AdminGate` probes only after you already typed `/admin` |
| N3  | The admin shell is a **dead end**: no link back to the customer app, no sign-out, no indication of who is signed in.                                                        | `components/admin/AdminShell.tsx` header actions = ops pills + theme             |
| N4  | The marketing header shows **Log in / Sign up** to a user who already has a session — the "Open app" path is missing after the digest email lands you on `/pricing` or `/`. | `components/MarketingLayout.tsx`                                                 |
| N5  | The Feed's Saved/Ignored shelves have **no URL**; a nav link, a bookmark or a digest deep-link cannot land on them.                                                         | `pages/app/Feed.tsx` `useState<Tab>('today')`                                    |
| N6  | Admin rail is a flat list of ten links with no grouping; on-call readers scan it every time.                                                                                | `ADMIN_NAV`                                                                      |
| N7  | The sign-out error renders **outside** the header as a stray paragraph.                                                                                                     | `AppShell.tsx`                                                                   |

## 2. Navigation model (decision)

Customer app header — one primary nav, ≤5 items, plus an account cluster:

```
[Logo BidMorrow_]   Feed   Saved   Settings   Billing   [Admin]      ☾  (CP) Log out
```

- **Feed** → `/app` (current for `/app` and `/app/tenders/*`).
- **Saved** → `/app?view=saved` — the Feed reads `?view=` (`today|strong|
worth_reviewing|possible|saved|ignored`) and writes it back with
  `replace` on tab change, so shelves become linkable. Invalid → `today`.
- **Settings** → `/app/settings`; **Billing** → `/app/settings#billing`
  (Settings already has section ids; it scrolls to the hash once loaded).
- **Admin** → `/admin`, rendered **only** when `GET /api/account/me` says
  `isAdmin: true`. Visually distinct (outlined amber-ish "ops" pill, shield
  icon) so an operator never confuses the customer surface with the
  audited one. Purely a discoverability affordance — the server's 404
  cloak and per-request authorization are unchanged.
- Account cluster: theme toggle, initials chip (now carries the email as
  its accessible name via `title`/`aria-label`), **Log out**.
- Mobile (≤40rem): row 1 wordmark + account cluster, row 2 the full-width
  segmented strip; 5 items still fit at 390px (each ≥ 44px tall, labels at
  0.8rem, horizontal scroll as the safety net).

Marketing header — when a session exists, the auth actions become a single
**Open app** CTA (desktop and menu panel). No admin link on marketing pages.

Admin shell:

- Header actions gain **← Open app** (link to `/app`), the signed-in email
  (mono, quiet), and **Log out**; the ops pills stay.
- Rail is grouped: **Overview** (Dashboard) · **Customers** (Organizations,
  Users, Subscriptions) · **Pipeline** (Ingestion, Matching, Digest) ·
  **Governance** (Support, Audit, Flags). Group labels are `<p>` captions,
  not links; counts stay as quiet mono figures.
- Mobile keeps the horizontal strip; group captions collapse.

## 3. Server contract

`GET /api/account/me` (session required, IP-rate-limited like the rest of
`/api/account/*`):

```json
{ "user": { "id": "…", "email": "…", "name": "…|null" }, "isAdmin": true }
```

`isAdmin` = email ∈ `ADMIN_EMAILS` (same parser as `requireInternalAdmin`,
exported as `isInternalAdminEmail`). Returning `false` to a non-admin
discloses nothing beyond "a role called admin exists"; the admin routes
themselves keep 404-cloaking. Not audited (it is not an admin action).

Client: `useAuth()` gains `isAdmin: boolean` (default `false`; fetched
after a session resolves; any failure → `false`, never blocks render).

## 4. UI notes

- Nav link language unchanged (`.app-nav-list a` pill + underline current
  state). New `.app-nav-admin` modifier: 1px `--sig-caution` outline,
  caution tint on hover/current, shield glyph — signals "you are leaving
  the customer surface".
- Account chip gets `role="img"` + `aria-label="Signed in as …"`; sign-out
  error moves into the header cluster as a live region.
- Admin rail: captions in `--font-num`, 0.66rem, letter-spaced, `--ink-3`;
  first caption has no top margin; links unchanged. Header gets a
  `.admin-header__who` mono email and a quiet link/button pair.
- All targets ≥ 44px on touch; focus rings inherit base.css.

## 5. Out of scope

Role model beyond the env allowlist (org-level roles in nav), a dropdown
account menu, and any change to server authorization.
