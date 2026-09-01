# HUMAN_DECISION_BLOCKERS

Genuinely human-required decisions, credentials, and console actions.
Claude must NEVER invent values for anything listed here. All implementation
proceeds with mocks / test-mode configuration until these are provided.

Status legend: `OPEN` (needs human), `PROVIDED` (done), `DEFERRED` (not needed yet).

---

## 🚀 LAUNCHED 2026-08-30 (owner instruction; a day ahead of the 08-31 date)

`prelaunch=false`, `ingestion_paused=false`, `founding_plan_open=true` in
production D1; live Paddle config deployed; registrations + checkout open.
~~Still owed after launch: the live €0 checkout test + lifecycle~~ **DONE
2026-08-30 17:20Z** — checkout, webhooks, D1, entitlement, plan change,
scheduled + immediate cancel all verified; `BMTEST100` archived. Still
open: F-06 staging credentials in CI, sandbox checkout branding (4b),
live checkout logo/brand colour. Everything below is history.

## ⏳ AWAITING OWNER — production deploy of PRs #132 + #133 (2026-09-01)

**What:** the hourly fetch-retry drain fix for post-launch incident #1
(empty production feed: 150/151 notices render-pending on 09-01, the
retry queue never converged). Details: ADR-0008 Amendment A5,
`IMPLEMENTATION_LEDGER.md` § Current phase.

**State:** #132 (the drain) merged 19:10 UTC and #133 (the three owner
fixes: reset-password confirmation, digest entitlement gate, em-dash-free
page copy) merged 19:49 UTC; both auto-deployed to staging, both green.
**Production still runs the 08-30 build** — the standing rule (item 2c) is
that a production deploy is dispatched only on the owner's explicit
instruction.

**Owner action:** say "deploy to production" (or dispatch the production
deploy workflow yourself; `main` at `3c08100` carries both). Optional follow-up, also owner's
call because it writes production data: set the 150 pending rows'
`next_attempt_at = now` so the first `:40` drain after deploy picks them
up instead of waiting for 2026-09-02 05:09.

## OPEN — `entitlement_enforced` in production (2026-09-01, issue #3)

**Decision needed: set `entitlement_enforced = true` in production D1.**

Owner reported that a cancelled subscription still receives daily digests.
The code path is now correct at both the enqueue and the send step
(`apps/worker/src/digest.ts`), but every entitlement gate in the product,
the digest and the feed's 402 alike, is wrapped in the
`entitlement_enforced` flag. Production `feature_flags` currently holds only
`founding_plan_open`, `ingestion_paused` and `prelaunch`. With no
`entitlement_enforced` row the flag reads `false`, so billing state gates
nothing and the digests continue. Claude will not flip a production flag.

Blast radius, measured in production on 2026-09-01: one active
organization, which is the canceled launch-test one; zero organizations with
digests enabled and no subscription. So turning it on today stops digests
and feed access for that one organization and affects nothing else. It also
ends V1-pilot mode: from then on any manually provisioned organization with
no `subscriptions` row is treated as unentitled.

Immediate alternative if the flag flip should wait: turn off that
organization's digest preference, which stops the mail without touching
billing enforcement.

## OPEN ITEMS SNAPSHOT — 2026-08-16 (production launch checklist)

Everything below is detailed in the numbered items further down; this is
the consolidated to-do. Nothing else blocks launch on the owner side.

1. **`production` GitHub environment secrets** (repo → Settings →
   Environments → production): `CLOUDFLARE_API_TOKEN` +
   `CLOUDFLARE_ACCOUNT_ID` (item 1), LIVE `PADDLE_API_KEY` +
   `PADDLE_WEBHOOK_SECRET` + `PADDLE_PRICE_FOUNDING_MONTHLY` +
   `PADDLE_PRICE_STANDARD_MONTHLY` (item 4, Paddle since 2026-08-25),
   production `RESEND_API_KEY` (item 3.2). Variables: `ADMIN_EMAILS`;
   `EMAIL_FROM` after item 2.3; `PADDLE_CLIENT_TOKEN` (`live_…`) +
   `PADDLE_ENVIRONMENT=production` (item 4).
   (`BETTER_AUTH_SECRET` already set ✓.) **STATUS 2026-08-30** (from `gh
secret/variable list -e production`): everything is set EXCEPT the live
   `PADDLE_API_KEY` and `PADDLE_WEBHOOK_SECRET` — those two are the last
   owner inputs before the production deploy (item 4c).
2. **Production deploy gating — RESOLVED 2026-08-16 (with a plan-limit
   discovery)**: the owner HAS GitHub Pro, which enforces the `main`
   branch **ruleset** (PR + green `checks`/`secret-scan`, no force-push)
   on this private repo — but environment **Required reviewers** turned
   out to need GitHub **Enterprise** on private repos (the section
   simply doesn't render on the owner's environment page; Pro is not
   enough — an earlier note here claiming Pro suffices was wrong).
   Adopted gate instead: (a) production environment "Deployment
   branches" set to **Protected branches only** (owner console action —
   deploys only ever run ruleset-protected main), (b) deploy-production
   requires a typed `confirm: deploy-production` dispatch input, and
   (c) standing convention: Claude never dispatches a production deploy
   without an explicit owner instruction.
3. ~~Branch protection~~ DONE — enforced by the imported `main-protection`
   ruleset (Pro covers rulesets on private repos).
4. **Resend domain verification** — ~~verification~~ **VERIFIED
   2026-08-16** (owner screenshot: bidmorrow.com Verified in Resend,
   DKIM + SPF-send + tracking CNAME all green; "Enable Receiving"
   correctly OFF — inbound mail is item 5's Cloudflare Email Routing,
   not Resend). ~~REMAINING~~ **ALL DONE 2026-08-16** (owner confirmed):
   production `RESEND_API_KEY` created + stored, `EMAIL_FROM` variable
   set in BOTH `staging` and `production` environments. Both
   environments redeployed the same evening to push the new values —
   real signup-verification + digest email is LIVE.
5. **Paddle live account** (detailed in item 4 below — REPLACES the former Stripe item —
   ADR-0011, 2026-08-25): get the live Paddle seller account approved,
   website approval for `bidmorrow.com`, live catalog, live notification
   destination for `https://bidmorrow.com/api/webhooks/paddle` (can be
   done BEFORE the first deploy — the URL is fixed), live client token,
   default payment link. **Paddle's approval takes days — start now.**
   **2026-08-30: live catalog, destination and client token CREATED and
   wired into `production` (item 4c); remaining = seller verification,
   website approval, default payment link, API key + webhook secret.**
   Plus, for staging: copy the sandbox API key + webhook secret into the
   `staging` GitHub environment (item 4a).
6. **Legal inputs** (item 7): ~~postal address + privacy email~~ DECIDED
   2026-08-16 (email-only contact, implemented). ~~VAT approach~~
   RE-DECIDED 2026-08-25 (ADR-0011), AMENDED 2026-08-26: Paddle is
   Merchant of Record and collects VAT itself; prices are
   **tax-INCLUSIVE** (`tax_mode: internal`) — the customer pays exactly
   €29/€49 and Paddle carves their country's VAT out of that amount. The
   2026-08-25 tax-exclusive ("+ VAT") choice is superseded. Owner still
   needs no VAT registration. Terms/privacy copy names Paddle as the
   seller — owner to review the wording once.
7. ~~**Test-mode Stripe webhook URL update**~~ DONE 2026-08-16 — now
   OBSOLETE: after the Paddle PR merges, **delete** the Stripe test-mode
   webhook endpoint, the Stripe products/prices and the four `STRIPE_*`
   GitHub secrets in both environments (item 4d).

Then launch = dispatch the **Deploy production** workflow (Actions tab)
and approve it; it bootstraps prod D1/queues/R2, migrates, deploys,
attaches bidmorrow.com, pushes secrets, and smoke-tests. Production
comes up with ingestion paused — unpausing is the final deliberate step.

---

## 1. Cloudflare account & deployment credentials — PROVIDED (2026-08-15)

**Provided**: the Cloudflare account is connected to the Claude session via
the Cloudflare MCP connector (verified with read-only listing: account
reachable, no D1/Workers resources exist yet). Claude can create/manage
D1, R2, and KV resources through this connector when the deployment phases
need them; resources will be created in their owning phases, not before.

**Also provided 2026-08-15**: scoped CI API token created (per
docs/setup-guide.md § 2a) and stored together with `CLOUDFLARE_ACCOUNT_ID`
in the GitHub **`staging` environment** secrets — deploy workflows must
declare `environment: staging` / `environment: production` to read them.
A `production` GitHub environment also exists.

**Workers Paid plan ($5/mo) purchased 2026-08-15** (dashboard shows
"Current plan: Paid") — Queues available.

~~One remaining console action: enable R2 once~~ **DONE 2026-08-16**
(owner enabled R2 in the dashboard; the staging deploy then created the
bucket itself). **Item 1 fully PROVIDED for staging.** For production:
confirm `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` are also set in
the GitHub **`production` environment** secrets (same token is fine, or
mint a second one with identical scopes per docs/setup-guide.md § 2a).

## 2. Domain & DNS for bidmorrow.com — PARTIALLY PROVIDED (2026-08-15)

Needed for: production URLs and email deliverability (Phases 8/13).

**Provided**: bidmorrow.com DNS is on Cloudflare, on the account connected
to Claude via the MCP connector. Staging serves on the
`staging.bidmorrow.com` custom domain since 2026-08-16 (owner request;
attached automatically at deploy, no console action — but see snapshot
item 7 — historical; that endpoint is now the Paddle destination, item 4).

Still human-required / deferred to Phase 13:

1. ~~Confirm bidmorrow.com registration and move DNS to Cloudflare.~~ DONE.
2. App custom-domain attach (`bidmorrow.com` → Worker) happens at
   production deploy time via wrangler routes (`custom_domain: true`).
   **OPEN console action (found at first production deploy 2026-08-16,
   API error 100117)**: the zone has pre-existing address records on the
   apex — Cloudflare refuses to overwrite them. Dashboard →
   bidmorrow.com → DNS → Records: **delete the A / AAAA / CNAME
   record(s) whose name is `bidmorrow.com`** (root/apex). Keep TXT and
   MX records — they don't conflict. Then re-run "Deploy production".
   ~~DONE 2026-08-16~~ — domain attached on deploy run #2.

   ~~OPEN console action #2~~ **DONE 2026-08-16** (owner disabled the
   challenge; deploy run #5 green — bidmorrow.com LIVE). Original
   finding kept for the record: the zone served a **Managed Challenge**
   (`cf-mitigated:
challenge`, "Just a moment…" interstitial) on EVERY request — this
   blocks health checks, the billing webhook endpoint, and the SPA's own
   API fetches. Dashboard → bidmorrow.com → **Security**: turn **Bot
   Fight Mode OFF** (it challenges all non-browser clients and cannot
   be scoped/bypassed on Free), ensure **Security Level is not "I'm
   Under Attack"**, and disable any Quick-Start one-click feature whose
   action is "challenge". The Worker already enforces its own rate
   limiting + security headers (docs/security.md); zone-level
   challenges must stay off the app origin.

3. Email authentication (required before any digest email is sent to customers —
   deliverability depends on it):
   - Add the SPF, DKIM and DMARC records that Resend displays under
     Resend → Domains → Add Domain → bidmorrow.com. Exact values are
     account-specific; copy them from the Resend console.
   - Recommended DMARC starting policy: `v=DMARC1; p=none; rua=mailto:postmaster@bidmorrow.com`
     then tighten to `p=quarantine` after monitoring.

## 3. Resend account — PARTIALLY PROVIDED (2026-08-15)

Needed for: real email sending (Phase 8+). Local/test uses a mock provider.

**Provided**: Resend account created; `RESEND_API_KEY` stored in the GitHub
`staging` environment secrets.

Still human-required:

1. Verify domain bidmorrow.com in Resend (SPF/DKIM/DMARC records into the
   Cloudflare zone — see item 2.3). Unconfirmed as of 2026-08-15.
2. A second, separate API key for production (never reuse staging's).
3. Confirm sending addresses (suggested): `verify@bidmorrow.com` /
   `digest@bidmorrow.com`, support inbox `support@bidmorrow.com`.

## 4. Paddle account & catalog — SANDBOX DONE, OWNER STEPS OPEN (2026-08-25)

**Decision 2026-08-25 (ADR-0011): Paddle Billing replaces Stripe.** Paddle
is Merchant of Record — the legal seller that charges and remits EU VAT and
issues invoices — which removes the sole-trader VAT problem that item 7
had parked. The earlier note here recommending "stay on Stripe as
Individual" is superseded; the billing package was rewritten for Paddle
(sandbox now, live later — owner decision the same day). Prices are
**tax-INCLUSIVE** (`tax_mode: internal`, owner decision 2026-08-26
superseding the 2026-08-25 tax-exclusive choice): the customer pays
exactly €29/€49, VAT included. Every price created from here on — sandbox
and live — must be `internal`; see 4b and 4c.

**DONE (Claude, via the Paddle MCP, sandbox account):**

- Products `pro_01m0wx38mqz3gm6r2ytx6qakq4` (BidMorrow Founding) /
  `pro_01m0wx38tjejcm7tvx35paz8rp` (BidMorrow Standard), tax category
  `saas`.
- Prices `pri_01m0wx38ymack0vxmqvtadddg9` (€29/month) /
  `pri_01m0wx39a5dkx4fpr7pexbwv6b` (€49/month), EUR, `tax_mode: external`,
  quantity locked to 1.
- Notification destination `ntfset_01m0wx39g6qmk4m1bmf39mpa4d` →
  `https://staging.bidmorrow.com/api/webhooks/paddle`, the eight
  `subscription.*` events, simulator traffic allowed.
- Client-side token `ctkn_01m0wx39m4rv1qen7ez4bk08vx` =
  `test_71e5894f9d1a1e0d7f52b651ba5` (public by design).

**OPEN — owner actions (docs/setup-guide.md §4 has the click paths):**

- ~~**4a. Staging secrets/vars**~~ **DONE — confirmed 2026-08-29 from
  evidence, not from memory.** This item was still written as an open owner
  action; the 2026-08-26 staging verification (recorded in the ledger)
  proves it was already done: `/api/public-config` exposed
  `paddle: {clientToken: test_…, environment: sandbox}`, and a
  `subscription_creation` scenario from the sandbox simulator was ACCEPTED
  by signature verification — which is only possible if the staging
  `PADDLE_WEBHOOK_SECRET` matches the notification destination. The price
  ids and `PADDLE_API_KEY` are exercised by the same deploy. Kept here for
  the record: secrets `PADDLE_API_KEY` / `PADDLE_WEBHOOK_SECRET`,
  `PADDLE_PRICE_FOUNDING_MONTHLY` = `pri_01m0wx38ymack0vxmqvtadddg9`,
  `PADDLE_PRICE_STANDARD_MONTHLY` = `pri_01m0wx39a5dkx4fpr7pexbwv6b`;
  variables `PADDLE_CLIENT_TOKEN` = `test_71e5894f9d1a1e0d7f52b651ba5`,
  `PADDLE_ENVIRONMENT` = `sandbox`. Claude never sees the API key or the
  webhook secret.
- **4b. Sandbox dashboard settings** (not settable by API): Checkout →
  Checkout settings → **Default payment link** =
  `https://staging.bidmorrow.com/app/settings`; Checkout → Website
  approval → add `staging.bidmorrow.com` (auto-approved in sandbox).
  Without the default payment link Paddle.js shows "Something went wrong".
  **Done 2026-08-26** (domain approved, payment link set).
  - ~~**Tax mode → inclusive** on both prices~~ **DONE 2026-08-29 (owner
    confirmed).** Both sandbox prices set to tax mode "Inclusive" (API name
    `internal`), matching the 2026-08-26 decision that €29/€49 include VAT.
    **Not independently verified from the session that recorded this**: no
    Paddle MCP is connected here and the API key is a GitHub secret that
    never enters the repo, so this rests on the owner's confirmation. The
    code side was already correct (`PlanPrice.taxInclusive: true`) and the
    copy says "incl. VAT" everywhere. **The confirming test is a real
    sandbox checkout on staging**: open the overlay from Settings and check
    the total reads €29 with VAT carved out of it, not €29 + VAT added on
    top. That is the one observation that distinguishes `internal` from
    `external`, and it is still owed — it was already deferred once (4a/4b),
    so nothing has yet exercised the inclusive path end to end.
    **2026-08-30: the tax mode itself is now VERIFIED by API via the
    reconnected sandbox MCP — both prices `internal`. The end-to-end €29
    checkout is still owed; the only completed sandbox transaction predates
    the switch and totals €58.31.**

  **2026-08-30: the `paddle-sandbox` MCP key is rejected by Paddle ("You
  aren't permitted to perform this request") — the sandbox API key was
  rotated after 2026-08-25 and the MCP still holds the old one. Re-issue a
  sandbox key with read scope for the MCP if API-side sandbox verification
  is wanted; the tax mode still rests on the owner's confirmation.**

  Still open in the sandbox dashboard:
  - **Checkout branding** to match the site: Checkout → Checkout settings
    → upload the BidMorrow logo and set the brand colour (the site's teal
    button colour); code already opens the overlay with the light theme.
    Repeat both in the LIVE account under 4c.

- **4c. LIVE account — CATALOG + DESTINATION + TOKEN DONE 2026-08-30 (Claude,
  via the `paddle-live` MCP); seller/website approval + two secrets still
  OWNER.** Created in the live account: products
  `pro_01m19e8qdsyrezm8z9zf9bazc3` (Founding) /
  `pro_01m19e8qk2cffzy8dp0m99b8tz` (Standard), tax category `saas`; prices
  `pri_01m19e8qpvnd6kttmjr2dndpkd` (€29/month) /
  `pri_01m19e8qv0810gaeg1z2s27cv8` (€49/month), EUR, **`tax_mode:
internal`**, quantity locked to 1; notification destination
  `ntfset_01m19e8r12sx7j9m31s4ef4j56` →
  `https://bidmorrow.com/api/webhooks/paddle`, the eight `subscription.*`
  events, `traffic_source: all`; client-side token
  `ctkn_01m19e8r53epwzj5048b14m92b` = `live_0437a850a828f5dc3b74fcb3603`
  (public by design). **Inclusive tax verified by API** (`transactions.preview`
  on the live prices): DE → subtotal €24.37 + VAT €4.63 = **€29.00**; CY →
  €41.18 + €7.82 = **€49.00**. `production` GitHub environment set the same
  day: secrets `PADDLE_PRICE_FOUNDING_MONTHLY` / `PADDLE_PRICE_STANDARD_MONTHLY`
  (the ids above), variables `PADDLE_CLIENT_TOKEN` = `live_…` above,
  `PADDLE_ENVIRONMENT` = `production`; `ADMIN_EMAILS` was already there.
  **STILL OWNER (dashboard-only, no API):** (1) seller verification —
  asynchronous, Paddle approves in days; (2) Checkout → Website approval →
  submit `bidmorrow.com` (the `checkout-domains` API is read-only — the
  live list is currently empty); (3) Checkout settings → Default payment
  link `https://bidmorrow.com/app/settings` + logo/brand colour; (4)
  Developer tools → Authentication → new API key → `production` secret
  `PADDLE_API_KEY`; (5) Developer tools → Notifications → "BidMorrow
  production" destination → copy its secret → `production` secret
  `PADDLE_WEBHOOK_SECRET`. Claude never sees (4) or (5). Until (1)+(2) are
  approved, live checkouts fail even with everything else in place.
  **2026-08-30 (later) — pricing verified, domain still missing.**
  `transactions.preview` on the live prices for DE, FR, CY, IE, SE, CH,
  GB, US: Founding total **€29.00** and Standard total **€49.00** in every
  case, VAT carved out inside (US: €0 tax, still €29/€49). Founding cap:
  production `feature_flags` has NO `founding_cap` row → code default 100
  (`DEFAULT_FOUNDING_CAP`), so the first 100 subscriptions get €29 and the
  server selects the €49 price after that. **Website approval: the owner
  reports submitting `bidmorrow.com`, but the live `checkout-domains`
  list still returns `estimatedTotal: 0`** (the same key sees the
  destination, so this is not a read-scope issue). Re-check in the LIVE
  dashboard (vendors.paddle.com, not sandbox) → Checkout → Website
  approval. Also seen: production `ingestion_paused = true` (seeded) —
  flip at go-live.
  **2026-08-30 15:05Z — `bidmorrow.com` checkout domain APPROVED**
  (`chedom_01m19hgp8m27c2empnnf432zk7`, Apple Pay verified) and the
  production deploy (run 33318306885) is live with the full Paddle
  production config. Remaining in the live dashboard: default payment link
  `https://bidmorrow.com/app/settings` + logo/brand colour, and whatever
  seller-verification steps Paddle still shows as pending.
  Original instructions kept below for reference: sign up at https://vendors.paddle.com and complete seller
  verification (individual seller is fine); website approval for
  `bidmorrow.com` (Paddle reviews for public pricing, terms naming Paddle
  as Merchant of Record, privacy and refund policy — the redesigned pages
  cover this); recreate the two products/prices exactly (EUR, monthly,
  **tax mode "Inclusive"** — API name `internal`, per the 2026-08-26
  owner decision; creating them `external` would charge €29/€49 + VAT
  while every page says "incl. VAT"); live notification destination for
  `https://bidmorrow.com/api/webhooks/paddle` with the same event set;
  live client token; default payment link
  `https://bidmorrow.com/app/settings`. Then the `production` GitHub
  environment: the four secrets with live values, `PADDLE_CLIENT_TOKEN` =
  `live_…`, `PADDLE_ENVIRONMENT` = `production`. Sandbox and live are
  never mixed. Claude can create the live catalog/destination through the
  `paddle-live` MCP once the owner authorises it with write scope.
- **4d. Decommission Stripe** — ~~GitHub secrets~~ **DONE 2026-08-30**:
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_FOUNDING_MONTHLY`,
  `STRIPE_PRICE_STANDARD_MONTHLY` deleted from BOTH `staging` and
  `production` (verified: `gh secret list` shows none; the only code
  mention is a logger redaction test using the name as a sample). STILL
  OWNER: in the Stripe dashboard delete the test-mode webhook endpoint and
  products and revoke the test key.

## 5. Auth secret — PROVIDED (2026-08-15)

`BETTER_AUTH_SECRET` set by the owner in BOTH the `staging` and
`production` GitHub environments; owner confirmed 2026-08-15 the two
values are different. Local dev uses a checked-in-nowhere `.env` value the
developer generates.

## 6. Admin allowlist — PROVIDED (2026-08-15)

`ADMIN_EMAILS` = `cploutarchou@gmail.com`, set as a GitHub `staging`
environment variable by the owner. Repeat in the `production` environment
at production-deploy time.

## 7. Business / legal information — PARTIALLY PROVIDED (2026-08-15)

Needed for: terms, privacy policy, Paddle seller account, invoices.

**Decided by owner**: operate as an **Individual / sole trader** using a
personal tax ID (no registered company) — Paddle accepts individual
sellers; Paddle itself is the Merchant of Record on every invoice.

**Decided by owner 2026-08-16**: the terms/privacy pages publish **no
postal address** — contact is **email-only** (`support@bidmorrow.com` for
terms/general, `privacy@bidmorrow.com` for data requests). Implemented in
Terms.tsx/Privacy.tsx the same day. Known trade-off (owner informed): some
EU member states' e-commerce rules (strictest: German-style Impressum)
expect an address; can be added later with a one-line edit if ever needed.
~~⚠️ Consequence: item 2's email-forwarding test is now REQUIRED~~
**DONE 2026-08-16** (owner confirmed): Cloudflare Email Routing set up —
support@/privacy@bidmorrow.com route to the owner's Gmail; Cloudflare's
MX records installed (Resend's send/DKIM records unaffected). ~~**The
owner-side launch checklist is now EMPTY** — every numbered item in the
snapshot above is closed.~~ **NO LONGER TRUE (corrected 2026-08-29):**
that sentence described the checklist as it stood on 2026-08-16. The
2026-08-25 move to Paddle (ADR-0011) reopened it — snapshot items 1, 5
and 7 and item 4's sub-steps 4a/4b/4c/4d are OPEN and on the launch path.
Read the snapshot at the top of this file, not this line, for current
owner state.

**VAT — SUPERSEDED 2026-08-25 by ADR-0011 (Paddle as Merchant of
Record)**. History: on 2026-08-16 the owner decided "no VAT at launch"
because a Cyprus sole trader with no VAT registration cannot collect it
(Stripe Tax stalled on exactly that). With Paddle the question dissolves:
Paddle is the seller, computes VAT for the buyer's country at checkout,
collects and remits it, and issues the invoice — the owner needs no VAT
registration and no threshold monitoring for subscription revenue.
Owner decision 2026-08-26 (superseding the 2026-08-25 tax-exclusive
choice): prices are **tax-inclusive** (`tax_mode: internal`) — customers
pay exactly €29/€49 and Paddle carves out their country's VAT share (an
EU B2B customer under reverse charge has no VAT share, so BidMorrow nets
the full amount less Paddle's fee). Copy on pricing/terms says "incl.
VAT" and names Paddle as Merchant of Record. Owner's own income tax on Paddle
payouts remains their/their accountant's matter.

## 8. GitHub settings — PARTIALLY PROVIDED (2026-08-15)

1. ~~Rename default branch to `main`~~ DONE (renamed from `master`;
   ci.yml trigger updated the same day). ~~Branch protection~~ DONE
   2026-08-16: owner imported the `main-protection` ruleset (PR + green
   `checks`/`secret-scan` required, approvals 0, force-push/deletion
   blocked).
2. ~~Create a GitHub "production" environment~~ DONE — Required
   reviewers: NOT AVAILABLE (needs GitHub Enterprise on private repos;
   an earlier note here claiming this was done was wrong — see snapshot
   item 2 above for the full story). Adopted gate instead (2026-08-16):
   environment restricted to protected branches only + typed
   `confirm: deploy-production` workflow input validated in-job +
   convention that Claude never dispatches production deploys without
   explicit owner instruction. Accepted residual: any repo-write
   principal can technically dispatch a production deploy — recorded in
   docs/threat-model.md §5.

## 9. TED developer API key — CLOSED 2026-08-18 (key NOT needed)

**Resolution: no owner action remains.** Probing the live v3 API with the
owner's (paired, working) key and reading the API's own OpenAPI spec
(`ted-api-probe` runs 32152093521 / 32155040026) proved
`api.ted.europa.eu` offers **no endpoint that returns a published
notice's XML** — its surface is eSender submission plus search. The
"authenticated download route" this item was opened for never existed
(`400 Missing Authorization header` came from a gateway filter answering
before routing). Ingestion's supported path is the anonymous front-end
URL with 202-aware render-cycling (shipped in PR #51), which needs no
credentials. The client/env/deploy wiring for `TED_API_KEY` has been
removed; the GitHub environment secrets and the already-pushed staging
worker secret are unused and harmless — the owner MAY delete them at
leisure (repo → Settings → Environments; `wrangler secret delete
TED_API_KEY` for the worker copy) but nothing depends on it.

Archive of the original analysis (for the record):

TED changed the anonymous notice-XML front-end (`ted.europa.eu/<lang>/notice/<id>/xml`)
to asynchronous rendering: HTTP 202 + empty body on first request for every
client, 200 + XML only once the render is cached (diagnosed live, CI runs
32131289081 / 32131832286 — this broke the first non-empty staging ingest,
2026-08-18 05:00 UTC). ~~An **authenticated** notice-XML endpoint exists on
the API host, which is the robust, officially supported route.~~ (Disproved
— see resolution above.)

~~Owner action: register at https://developer.ted.europa.eu/home, create an
API key, and add it as secret **`TED_API_KEY`** in BOTH the `staging` and
`production` GitHub environments (repo → Settings → Environments).~~
**DONE 2026-08-18** (owner confirmed; deploy-staging run 32135278377 pushed
the key to the staging Worker). Do NOT paste the key in chat/issues —
GitHub environment secrets only.

~~Remaining owner action: eNotices2 pairing login.~~ **DONE 2026-08-18**
(owner logged in; the key then authenticated — which is exactly what let
the probe prove the endpoint doesn't exist; see resolution above).

---

## 10. GA4 analytics — measurement ID + CSP allowlist decision — OPEN (2026-08-21)

The 2026-08-21 handoff redesign shipped the full GDPR cookie-consent UI
(banner + preferences dialog + footer controls; keys
`bm_consent_categories` / `bm_analytics_consent`, no pre-ticks, nothing
non-essential before an explicit choice). Actually LOADING Google
Analytics 4 needs two owner decisions Claude must not make:

1. A real GA4 measurement ID (the prototype ships `G-XXXXXXXXXX` and
   deliberately refuses to load with a placeholder).
2. A CSP change: `script-src`/`connect-src` are `'self'` today; GA4 needs
   `https://www.googletagmanager.com` (+ region `google-analytics.com`
   endpoints) allowlisted — a security-posture decision (docs/security.md
   C3), and a cost/privacy call.

Until both are provided, consent is recorded but no third-party script
ever loads (`apps/web/src/lib/consent.ts` documents this). Not launch-
blocking — V1 explicitly ships without analytics SaaS (see "Not blockers"
below); this item exists so the consent UI's analytics toggle is honest
the day analytics is turned on.

---

## 11. Go-live flag flip — end-of-August launch — OPEN (2026-08-21)

Pre-launch mode shipped 2026-08-21 (owner instruction): production keeps
REGISTRATIONS and NEW SUBSCRIPTIONS closed by default (`prelaunch` flag,
environment-aware default — absent = closed on production, open on
staging/local), with a public countdown to `launch_date` (default
2026-08-31T21:00:00Z, end of August, Cyprus midnight). Log-in and every
existing-account flow stay open.

**Owner action on launch day** (procedure of record:
`.claude/skills/launch-mode/SKILL.md`, or run `/launch-mode`):

1. Production admin → Flags → set `prelaunch` to `false` (UPDATE_FLAG
   typed confirmation; audited).
2. Verify `https://bidmorrow.com/api/public-config` returns
   `"prelaunch":false` and a real signup works.
3. Separately: the ingestion un-pause + Phase 13/14 pipeline (item above)
   remains its own go-live decision.

---

## 12. `www.bidmorrow.com` had no DNS record — CLOSED (2026-08-22)

External probe (site-health run 32563373663, 2026-08-22 08:51 UTC) confirmed
`bidmorrow.com` and `staging.bidmorrow.com` serving 200 with healthy
`/api/health/*`, but `www.bidmorrow.com` does not resolve at all — any
visitor typing `www.` gets a browser DNS error.

**Fix chosen (owner instruction 2026-08-22, "can you fix it also"):**
a dedicated redirect worker, `apps/www-redirect` — deploying it attaches
`www.bidmorrow.com` as a Workers custom domain, which makes wrangler
create the zone DNS record + certificate itself (the proven mechanism
that attached the apex and staging domains; the deploy token has these
zone permissions, so no dashboard access is needed after all). The worker
301s every request to `https://bidmorrow.com`, preserving path and query
— a second custom domain on the MAIN worker was rejected because assets
serve before worker code for non-API paths, which would expose the SPA on
a duplicate origin instead of redirecting.

Deploy: `.github/workflows/deploy-www-redirect.yml` (typed confirmation
`deploy-www-redirect`, production environment, built-in 301 smoke test).

**CLOSED 2026-08-22 09:34 UTC**: deploy run 32565287435 green in 53s —
custom domain attached, DNS + certificate provisioned, and the smoke test
verified `301` with exact `location` for both `/` and `/pricing?x=1`
("www redirect smoke tests passed" in the job log). Independently
confirmed by a site-health probe re-run after the deploy. No owner action
remains for this item.

---

## ~~OPEN~~ CLOSED 2026-08-23 19:26 UTC — delete the `ted-fixture-raw` scratch branch

`.github/workflows/ted-fixture-fetch.yml` force-pushes the raw TED
download to a transient branch `ted-fixture-raw`, and its own header says
the branch is "transient raw material… deleted afterwards". The fixture
refresh of 2026-08-23 (run 32646377636) is finished — the seven notices
that were wanted are sanitized and committed under
`tests/fixtures/ted/1.13/` — so the branch has served its purpose and now
holds 40 UNSANITIZED real notices, including the contact details of named
natural persons in their original form.

The session cannot delete it: pushes from here are scoped to the working
branch, and `git push origin :ted-fixture-raw` returns HTTP 403 (the same
limit already recorded for tag pushes in the ledger's Notes).

Owner action: delete the branch (GitHub UI → Branches → delete, or
`git push origin --delete ted-fixture-raw`). Re-dispatching the workflow
recreates it at any time, so nothing is lost.

**CLOSED without owner action needed after all** (owner asked the session
to handle it, 2026-08-23): the fixture-fetch workflow gained a
`delete_raw_branch` cleanup mode whose CI token — the same one that
force-pushes the branch — deletes it. Dispatch run 32661239581 succeeded
and `git ls-remote` confirms the ref is gone. Future refreshes end by
re-dispatching the workflow with `delete_raw_branch: true`, so this never
needs to be a manual step again.

---

## 13. Excluded tenders in the customer feed — OPEN (2026-08-24, non-urgent)

**Decision needed:** should customers ever SEE tenders their own exclusion
rules removed? Today they never appear (deliberate: the feed enumeration
in docs/product-scope.md has no excluded surfacing, and "skip the rest" is
the headline promise). The design prototype disagrees — its settings copy
says "Excluded tenders still appear under Possible with the rule that
tripped them", and the Theme Spec defines an EXCLUDED card chip.

The 2026-08-24 product review ruled keep-hidden the correct V1 default and
the prototype's model out of scope without an explicit owner trade-off.
Real gap acknowledged: a wrongly-firing exclusion rule (e.g. an over-broad
phrase) is invisible to the customer. Recommended shape IF you want it:
a per-rule "N tenders excluded, last 30 days" count in Settings with
drill-down — not excluded rows in the feed.

Options: (a) keep hidden (default, no work); (b) per-rule counts in
Settings (recommended if anything); (c) prototype's model (excluded rows
under Possible). Not launch-blocking. Say the word and the chosen shape
gets built.

---

## Not blockers (deliberately)

- **TED API: public, no credential required** — reinstated 2026-08-18
  after item 9's investigation closed full-circle: search is anonymous and
  the notice-XML front-end (with render-cycling) is the only content
  route; no key exists that helps.
- LLM keys: no production LLM usage in V1 by design.
- Analytics/monitoring SaaS: none used in V1.
