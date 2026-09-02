# BidMorrow — Threat Model (V1)

Lightweight STRIDE-per-asset threat model for BidMorrow, an EU procurement
bid/no-bid SaaS. Companion to docs/product-scope.md and docs/architecture.md.

**Stack assumptions**: modular monolith on Cloudflare Workers; Hono API;
React/Vite SPA (Workers Static Assets); Cloudflare D1 via Drizzle ORM; Better
Auth cookie sessions; Cloudflare Queues + Cron Triggers; R2 (private) for raw
TED snapshots; Paddle Billing (Merchant of Record: checkout overlay, customer portal, webhooks — ADR-0011); Resend for email. Multi-tenant:
organizations own all customer data. Roles: ORGANIZATION_OWNER, MEMBER,
INTERNAL_ADMIN. **No LLM in the production path.** All TED procurement content
is untrusted external input rendered in the customer UI.

Ratings: Likelihood/Impact as H/M/L, judged for a small pre-launch SaaS whose
crown jewels are customer relevance profiles (competitive intelligence about
what tenders a company pursues) and account/billing integrity.

---

## 1. Assets inventory

| #   | Asset                                                                                     | Where it lives                               | Sensitivity                                                                                              | Primary threats (STRIDE)                           |
| --- | ----------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| A1  | User credentials & sessions                                                               | D1 (Better Auth tables), session cookies     | High                                                                                                     | Spoofing, Elevation                                |
| A2  | Organization profiles (capabilities, CPV prefs, keywords, exclusions, certifications)     | D1                                           | High — reveals a customer's bidding strategy                                                             | Info disclosure, Tampering                         |
| A3  | Match results, feedback, saved/ignored state                                              | D1                                           | High — same competitive signal as A2                                                                     | Info disclosure                                    |
| A4  | TED notices & lots (parsed)                                                               | D1                                           | Low (public data) but integrity-critical: it drives scores and is rendered in UI                         | Tampering, DoS                                     |
| A5  | Raw TED snapshots                                                                         | R2 private bucket                            | Low/Medium (audit trail for score reproducibility)                                                       | Tampering, Info disclosure                         |
| A6  | Billing state & entitlements                                                              | D1 (subscriptions), Paddle (source of truth) | High                                                                                                     | Tampering, Spoofing, Repudiation                   |
| A7  | Secrets (Paddle API key, webhook secret, Resend key, BETTER_AUTH_SECRET, CF API token)    | Wrangler secrets / CI secrets                | Critical                                                                                                 | Info disclosure, Elevation                         |
| A8  | Internal admin surface (flags, ingestion scope, match trace, pause switches)              | Worker routes gated by INTERNAL_ADMIN        | Critical                                                                                                 | Elevation, Tampering, Repudiation                  |
| A9  | Email sending capability (verification, reset, digests)                                   | Resend + Queues                              | Medium — abuse burns domain reputation                                                                   | Spoofing, DoS                                      |
| A10 | Availability of ingestion/scoring/digest pipeline                                         | Queues, Cron, Worker CPU/D1 quotas           | Medium                                                                                                   | DoS                                                |
| A11 | Audit log                                                                                 | D1 append-only table                         | High (forensics; must not be tamperable via app paths)                                                   | Tampering, Repudiation                             |
| A12 | Organization deletion/purge lifecycle (soft-delete → 30-day grace → hard purge/tombstone) | D1 (`organizations.status`, org-purge job)   | High — the boundary that decides when A2/A3 stop existing vs. when they become permanently unrecoverable | Tampering, Elevation, DoS (of the deletion itself) |

## 2. Trust boundaries

```
                 UNTRUSTED INTERNET
 ┌────────────┐  ┌────────────┐  ┌──────────────────────────┐
 │  Browsers  │  │ TED OJ API │  │ Paddle / Resend webhooks │
 │ (customers,│  │ (public,   │  │ & callbacks              │
 │ attackers) │  │ untrusted  │  └──────────┬───────────────┘
 └─────┬──────┘  │  content)  │             │
       │ TB1     └─────┬──────┘             │ TB3 (signature
       │ HTTPS +       │ TB2 (fetch by      │  verification +
       │ cookies +     │  Cron/Queue        │  event-ID
       │ zod at API    │  consumer; zod     │  idempotency)
       │ boundary      │  parse + sanitize) │
═══════╪═══════════════╪════════════════════╪═════════════════
       ▼               ▼                    ▼
 ┌─────────────────────────────────────────────────────────┐
 │           CLOUDFLARE WORKER (modular monolith)          │
 │  Hono API ── authn (Better Auth) ── authz (repository   │
 │  layer: every query requires organizationId)            │
 │  ┌───────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐  │
 │  │ ingestion │ │ matching │ │  digests  │ │ billing  │  │
 │  └───────────┘ └──────────┘ └───────────┘ └──────────┘  │
 │        TB4: customer routes vs INTERNAL_ADMIN routes    │
 └───────┬───────────────┬──────────────┬─────────┬────────┘
         │ TB5 (bindings only — no public endpoints)       │
         ▼               ▼              ▼         ▼
 ┌────────────┐  ┌──────────────┐  ┌────────┐  ┌────────────┐
 │ D1 (multi- │  │ R2 (private  │  │ Queues │  │  outbound: │
 │ tenant DB) │  │ snapshots)   │  │ + Cron │  │ Paddle API,│
 └────────────┘  └──────────────┘  └────────┘  │ Resend API │
                                               └────────────┘
```

- **TB1** Browser → API: authenticated, rate-limited, zod-validated.
- **TB2** TED → ingestion: public data, adversarial by assumption. Content is
  data, never code; parsed with strict schemas, stored as text, rendered escaped.
- **TB3** Paddle/Resend → webhooks: unauthenticated internet endpoints; trust is
  established solely by signature verification (Paddle: HMAC-SHA256 over
  `ts:rawBody` with the notification destination's secret, C9).
- **TB4** Customer plane vs admin plane inside one Worker: enforced by role
  checks + email allowlist (`ADMIN_EMAILS`), not by URL obscurity.
- **TB5** Worker → D1/R2/Queues via Workers bindings only; no credentialed
  network path exists from the internet to the datastores.

## 3. Mandatory control set (referenced as C1–C11 below)

| ID  | Control                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Strict input validation: zod schemas at the API boundary (every route body/query/param) and at the TED ingestion parse boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| C2  | Safe output encoding: React default escaping; `dangerouslySetInnerHTML` banned for any source-derived data (lint rule)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| C3  | Content-Security-Policy: no `unsafe-inline`/`unsafe-eval` SCRIPT, the only external script origin is `https://cdn.paddle.com` (Paddle.js, ADR-0011); styles allow the Paddle CDNs + inline (styles only); see docs/security.md C3 for the full list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| C4  | Security headers: HSTS, X-Content-Type-Options, X-Frame-Options/frame-ancestors, Referrer-Policy, Permissions-Policy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| C5  | Secure cookies: HttpOnly, Secure, SameSite=Lax, session cookie never readable by JS. **Correction (2026-08-15 review):** BidMorrow ships exactly ONE session cookie (Better Auth's default `session` cookie/table) shared by customer and INTERNAL_ADMIN routes alike — there is no separate admin cookie, and no `SameSite=Strict` override exists anywhere in `packages/auth`/`apps/worker` (verified: `advanced.database`/`session`/`account`/`verification` config in `packages/auth/src/index.ts` sets no `cookies`/`sameSite` option, so Better Auth's own default — `Lax` — applies uniformly). Prior versions of this document incorrectly claimed admin routes used `SameSite=Strict`; the actual admin-plane isolation control is C11 (email allowlist + 404 cloaking), not a cookie attribute |
| C6  | Server-side authorization: repository layer where every tenant-scoped query **requires** `organizationId` from the session (not from the request); role checks per route                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| C7  | Rate/abuse protection: per-IP and per-account limits on auth endpoints, API write endpoints, and email-triggering endpoints; Cloudflare WAF/bot rules in front                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| C8  | Audit logs: append-only records for auth events, admin actions, billing transitions, profile changes (actor, org, action, timestamp)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| C9  | Paddle webhook signature verification + event-ID idempotency table                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| C10 | Secret isolation: wrangler secrets per environment, never in code/vars/logs; test vs live keys never mixed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| C11 | Least privilege: scoped CF API token for CI (no Global API Key), read-only credentials for reviewer agents, `ADMIN_EMAILS` allowlist, R2 bucket private with no public access                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

---

## 4. Threat catalog (STRIDE per asset)

Format per threat: context — affected assets/entry points — Likelihood/Impact — mitigations.

### 4.1 Identity & sessions (A1) — Spoofing / Elevation

**T1. Account takeover.** An attacker who controls a customer account reads the
org's entire bidding strategy (A2/A3) and can sabotage matching by editing
preferences. Entry points: login, password reset, email-change flows.
**L: M / I: H.** Mitigations: Better Auth with mandatory email verification;
password reset tokens single-use, short-lived, delivered only to the verified
address; reset never reveals account existence; session invalidation on
password change; C5, C7 (reset-request rate limits), C8 (login/reset events
logged, new-device sign-in notification email via Resend).

**T2. Credential stuffing.** Replay of breached email/password pairs against
`/api/auth/sign-in`. Likely because target users are SMEs reusing passwords.
**L: H / I: H.** Mitigations: C7 — per-IP and per-identifier throttles with
exponential backoff; Cloudflare bot management/WAF in front of auth routes;
breach-password rejection at signup/reset (k-anonymity check acceptable, or a
top-10k denylist offline to keep V1 dependency-free); C8 for anomaly review.
**SEC-P4-09 delta, concretized**: the per-IP half of C7 keys EXCLUSIVELY on
`cf-connecting-ip` (`packages/auth/src/index.ts` `advanced.ipAddress.
ipAddressHeaders: ['cf-connecting-ip']`), not the default header list Better
Auth ships with (which includes `x-forwarded-for`) — `x-forwarded-for` is
client-controlled on Cloudflare Workers, so leaving it in the header list
would let an attacker spoof it to split their traffic across many rate-limit
buckets (or collide two victims into one bucket); `cf-connecting-ip` is set
by Cloudflare's edge and cannot be overridden by the client.

**T3. Brute force.** Online guessing of a single account's password or of
reset/verification tokens. **L: M / I: H.** Mitigations: C7 (account lockout
with backoff, CAPTCHA escalation via Cloudflare Turnstile); tokens ≥128-bit
random, single-use, expiring ≤1h; constant-time comparison (Better Auth
default); C8.

**T4. Session theft.** Stealing the session cookie via XSS, network exposure,
or shared-computer persistence. **L: L / I: H.** Mitigations: C5 (HttpOnly
blocks JS exfiltration; Secure + HSTS in C4 blocks network capture);
C2/C3 shrink the XSS route to the cookie; server-side session store in D1 so
sessions are revocable (logout-all, admin kill); reasonable absolute + idle
session expiry.

**T5. CSRF.** Forged cross-site requests riding the session cookie, e.g. a
malicious page silently changing an org's keyword exclusions or triggering
account deletion. **L: M / I: M.** Mitigations: C5 SameSite=Lax (Better Auth's
default, unmodified — see the C5 correction below) kills the basic cross-site
POST vector; Better Auth CSRF/origin protection on state-changing routes; API
rejects requests whose Origin header does not match the app origin (verified
by `apps/worker/src/auth.test.ts`'s `STATE_CHANGING_HEADERS` requirement); no
state changes on GET.

### 4.2 Web application (A2, A3, A4 rendered in UI) — Tampering / Info disclosure

**T6. XSS.** Script injection into the SPA. Two flavors: (a) classic — via
customer-entered fields (org name, keywords, notes) rendered back; (b) the
BidMorrow-specific one — via TED content (see T14). **L: M / I: H** (leads to
T4/T1). Mitigations: C2 everywhere (React escapes by default; the lint ban on
`dangerouslySetInnerHTML` makes the safe path the only path); C3 as
defense-in-depth so even an injected script cannot load or beacon out; C1
rejects control characters/overlong values at the boundary; no user-controlled
URLs rendered as `href` without scheme allowlisting (`https:` only for
external links; TED links built server-side from notice IDs, not from
source-provided URLs).

**T7. SQL injection.** Injection into D1 queries via API params or TED-derived
strings that flow into queries (e.g. searching the feed for a tender title).
**L: L / I: H.** Mitigations: Drizzle ORM emits parameterized statements for
all query-builder usage, so SQLi is largely mitigated **by construction**; raw
SQL (`sql.raw`, string-built fragments, `db.run` with interpolation) is
**banned** — enforced by lint rule and code review; C1 constrains shapes/types
before data reaches the repository layer; `LIKE` inputs escape `%`/`_`
explicitly (not a security bug, but prevents filter-bypass surprises). Residual
raw-SQL need (e.g. a migration) goes through reviewed migration files only.

**T8. IDOR.** Requesting another org's objects by ID: `/api/matches/:id`,
`/api/tenders/:id/feedback`, saved lists, digest previews, Paddle portal
session creation, invoice PDF lookup by transaction id. IDs are practically guessable (or leak via digests/URLs).
**L: H (classic SaaS bug) / I: H.** Mitigations: C6 is the primary control —
the repository layer's tenant-scoped methods take `organizationId` from the
authenticated session and include it in **every** WHERE clause; no repository
method that touches tenant data compiles without it (type-level requirement);
object lookup by (id, organizationId) returns 404 not 403 (no existence
oracle); integration tests assert cross-org 404 for every tenant-scoped route;
C8 logs authorization failures for detection.

**T9. Cross-tenant leakage.** Broader than IDOR: any path where org A's data
reaches org B — feed queries missing the org filter, digest job batching
matches across orgs into one email, admin match-trace output pasted to the
wrong customer, cache keys unscoped by org, aggregate "popular tenders"
features. **L: M / I: H** (this is the product's trust foundation — customer
relevance profiles are competitive intelligence). Mitigations: C6 as above;
digest generation iterates per-org with per-org queries and the DB-enforced
dedupe key includes `organizationId`; any future caching keys on
(orgId, resource); no cross-org aggregate features in V1 (scoped out — public
tender SEO pages were rejected in product-scope.md partly for this reason);
C8; per-route tenant-isolation tests in CI.

**T10. Privilege escalation.** (a) MEMBER acting as ORGANIZATION_OWNER
(billing, deletion, profile ownership); (b) any customer reaching
INTERNAL_ADMIN routes (A8); (c) self-service role tampering via mass-assignment
(`role` field in a profile-update body). **L: M / I: H/Critical for (b).**
Mitigations: C6 role checks server-side per route; C1 zod schemas use
`.strict()` and simply do not include `role`/`organizationId` in
customer-updatable schemas (mass-assignment impossible by omission);
INTERNAL_ADMIN requires both the role **and** email ∈ `ADMIN_EMAILS`
(defense in depth, C11); admin routes live under a distinct prefix with a
dedicated middleware stack; C8 logs every admin action and role change.
**SEC-P4-09 delta, concretized — deletion compensation**: self-service account
deletion (`DELETE /api/account`) is a Tampering/availability risk in the
other direction — a bug or transient failure partway through deletion must
never silently strand an account in a half-deleted state (memberships
removed but the auth user still exists, or vice versa). The handler removes
every organization membership FIRST, then calls Better Auth's `deleteUser`;
if `deleteUser` itself fails, the handler's `catch` block re-inserts every
removed membership row before returning `account_deletion_failed` — the
account is left exactly as it was before the request, not partially
deleted. The one exception is authorship-attribution nulling (saved/ignored/
feedback rows, `email_deliveries.user_id`), which is NOT compensated on a
`deleteUser` failure — accepted, because it is a lost attribution label on
the user's own rows (not a lost row, membership, or org), and a retried
deletion is still fully idempotent.

### 4.3 Billing (A6) — Spoofing / Tampering / Repudiation

**T11. Webhook replay.** Re-sending a captured legitimate Paddle event (e.g.
`subscription.activated`) to re-trigger entitlement grants or confuse
subscription state. Entry point: the public webhook route. **L: M / I: M.**
Mitigations: C9 — HMAC signature verification with `PADDLE_WEBHOOK_SECRET`
including a 5-minute timestamp tolerance (rejects stale replays; wider than
the SDKs' 5 s for clock skew, safe because of the next control), plus a
processed-`event_id` idempotency table in D1 (`provider_event_id` unique)
so an event applies exactly once;
handlers are idempotent by design (state machine transitions, not increments).

**T12. Fake billing events.** Forged webhook bodies claiming an org paid, or a
user invoking checkout-success URLs directly to self-grant entitlements.
**L: M / I: H** (free service, revenue loss, founding-cap abuse). Mitigations:
C9 — unverifiable signatures are rejected before parsing; **entitlements are
derived only from webhook-verified Paddle state, never from client redirects or
query params**; success/cancel pages are display-only; the checkout transaction
itself is created server-side (items + organization binding), so the browser
never chooses what it buys; the founding-price cap is enforced server-side
against Paddle-confirmed subscriptions, not signups; a Paddle signature
alone is NOT proof that our server created the transaction (the Paddle.js
client token is public, so `Paddle.Checkout.open({ items, customData })`
from devtools can mint a subscription with arbitrary `custom_data`), so
the webhook only trusts `custom_data.organization_id` when its
`organization_sig` HMAC — set at checkout, keyed with the notification
secret — verifies (SEC-PDL-01, packages/billing/src/provenance.ts);
unsigned ids are `ignored`, never written and never used as an FK; no
periodic reconciliation job exists (accepted risk, see the residual-risk
table); C10 keeps test/live keys separate so
test-mode events can never touch production entitlements; C8 logs every
entitlement transition with the causing event ID (repudiation defense).
**Billing surface pattern, concretized** (`packages/billing/src/webhook.ts`):
after C9's signature check passes, the webhook handler trusts the EVENT
**identity** (organization id, subscription id) from the verified payload —
that part of the payload is not re-fetched, only its signature-verified
delivery is trusted — but every mutable **STATE** field it writes
(`status`, `plan`, `cancel_at_period_end`, `current_period_end_at`) is taken
from the Paddle API's own live response to a follow-up read
(`GET /subscriptions/{id}`/the mutation's own response, never copied
verbatim off the webhook body's mutable fields), so a webhook body crafted
with a real, currently-valid signature but stale/tampered mutable fields
still cannot write state Paddle itself doesn't currently hold.
`cancelSubscriptionForOrgDeletion` (Phase 11, org-deletion cancellation)
follows the identical "trust identity, re-fetch state" shape. **Phase 9
residuals, CLOSED 2026-08-16 (Phase 13 hardening)**: SEC-P9-02 — the
unauthenticated `POST /api/webhooks/paddle` endpoint is now gated by the
same IP-keyed native rate-limit binding as the rest of the API surface
(`createIpRateLimit`, applied BEFORE signature verification spends CPU on
attacker-supplied bodies; Paddle retries deliveries that hit a 429), in
addition to the global body-size limit (SEC-P4-09 below) and cheap pre-DB
400s on an invalid signature — an in-worker control, so it needs no
per-zone WAF console configuration and cannot drift from the deploy.
SEC-P9-03 — a user who double-submits checkout (e.g. a slow network
retry) could create two Paddle customers for the same organization and
wedge the second webhook on the org-unique subscription row: the webhook
processor now catch-and-reconciles (detects a subscription-bearing event
for an org whose non-canceled row holds a DIFFERENT `billing_customer_id`,
cancels the duplicate Paddle subscription immediately so the owner is not
double-charged, records the event, and acks 200 so Paddle stops retrying —
logged loudly; see `packages/billing/src/webhook.ts`).

### 4.4 TED ingestion & matching (A4, A5, and the engine) — Tampering / DoS

**T13. Source-data injection.** TED responses (or a MITM'd/compromised
upstream) delivering malformed or adversarial payloads: wrong types, absurd
sizes, spoofed notice IDs overwriting prior versions, corrections that
"correct" a notice into garbage. **L: M / I: M.** Mitigations: TLS to the TED
API; C1 — a strict zod parse of every notice at ingestion with per-field size
caps and type coercion rules; unparseable notices are quarantined (stored raw
in R2, flagged, skipped) rather than partially ingested; notice versioning is
keyed by TED's own identifiers with monotonic version logic so a replayed old
version cannot silently overwrite a newer one; ingestion is scoped by CPV
config (admin-controlled, C8-logged) limiting blast radius; raw snapshots in
R2 (A5) preserve evidence for reproducing any bad score. **Oversized-XML
mitigation, concretized** (`packages/ted/src/client.ts`): `fetchNoticeXml`
rejects any response over `MAX_XML_BYTES` (15,000,000 bytes) via TWO checks —
the (untrusted, spoofable) `Content-Length` header is checked FIRST to reject
an obviously oversized body before buffering it, and the ACTUAL decoded byte
length is re-checked after `response.text()` regardless of what
`Content-Length` claimed (a lying/absent header cannot bypass the cap); a
rejection is recorded as an `XML_TOO_LARGE` ingestion error and the notice is
skipped, not retried. Residual, honestly stated: this is a byte-count cap
checked after `response.text()` has fully buffered the body in Worker memory
— NOT a true streaming cutoff that aborts the fetch mid-transfer — so a
single 15MB response is still fully buffered before rejection; acceptable at
V1 scale (Workers' memory limit is well above 15MB and TED responses are
orders of magnitude smaller in practice) but would need a streaming
byte-counter if `MAX_XML_BYTES` were ever raised significantly.

**T14. Malicious tender strings.** Adversarial text inside legitimate notices
(anyone can influence procurement text — buyers, or attackers targeting
BidMorrow specifically) crafted to attack the **matching engine**: pathological
inputs to keyword tokenization and risk-flag regexes (ReDoS — a 2MB
description of repeated near-matches like `ISO 2700` × 50k can blow the
Workers CPU-time budget), keyword-stuffing to force STRONG_MATCH scores into
every org's digest (spam amplification), or strings that break explanation
rendering. **L: M / I: M.** Mitigations: C1 hard caps on field lengths at
ingestion (title/description truncated at a documented limit before matching);
**all risk-flag and exclusion patterns are linear-time** — no nested
quantifiers or unbounded backtracking; regexes are reviewed against a ReDoS
linter in CI and run only on the capped text; tokenizer is a simple
linear scan (spec: whole-word, diacritic-folded — no catastrophic constructs);
per-notice scoring wrapped in a CPU-budget guard: a lot that cannot be scored
within budget is flagged UNKNOWN-errored, not retried forever (poison-message
handling, see T17); keyword-stuffed notices still score deterministically and
the explanation shows exactly which terms matched — visible, auditable, and
capped (component max 20).

**T15. HTML/script injection from procurement fields.** The rendering half of
T14: notice titles, descriptions, buyer names, and risk-flag **evidence
snippets** (quoted source text, per matching-engine spec) contain
`<script>`, `<img onerror>`, markdown-ish payloads, or RTL/homoglyph tricks —
rendered in the feed, tender detail, admin match trace, **and digest emails**.
**L: H (certain to occur eventually; TED text is arbitrary) / I: H if it
lands.** Mitigations: C2 — TED-derived strings are rendered exclusively as
React text nodes (escaped); the lint ban on `dangerouslySetInnerHTML` applies
with zero exceptions for source data; C3 as backstop in the SPA; **digest
emails** build HTML via an escaping template layer (never string
concatenation of notice text into HTML), since email clients have no CSP;
admin match-trace UI uses the same escaped components as the customer UI (admins
are the juiciest XSS target, T10b); stored raw in D1/R2 unmodified — encode on
output, don't "sanitize" on input (preserves score reproducibility).

### 4.5 Availability (A9, A10) — DoS

**T16. Denial of service.** Volumetric or targeted: hammering expensive
endpoints (feed queries with hostile filter combinations, signup, password
reset), or CPU-exhaustion via T14 payloads. Workers autoscale but D1 and
CPU-time budgets do not, and cost DoS is real on paid plans. **L: M / I: M.**
Mitigations: Cloudflare's edge absorbs volumetric attacks by default; C7 WAF +
rate limits on auth and write routes; feed queries paginated with server-set
max page size and only indexed filter shapes (C1 rejects unknown sort/filter
params); no unauthenticated expensive endpoints (marketing site is static);
Workers has **no filesystem** and no long-lived process — no disk-fill or
state-corruption DoS class; budget alerts on CF spend. **SEC-P4-09 delta,
concretized**: every `/api/*` route (not just specific endpoints) sits behind
a single global body-size limit — `bodyLimit({ maxSize: 128 * 1024 })` in
`apps/worker/src/index.ts` — that 413s an oversized request BEFORE it reaches
any handler or touches D1, applying uniformly to the unauthenticated Paddle
webhook route (T11/T12) as much as to authenticated customer routes; the cap
(128 KB) comfortably exceeds every legitimate request shape in the API
surface (profile/preference updates, webhook payloads) while bounding
worst-case per-request memory/CPU.

**T17. Queue flooding.** Poisoning ingestion/digest Queues: a malformed batch
that retries forever, a mis-scoped CPV config exploding ingestion volume past
D1 limits, or a bug enqueueing duplicate work. Queues are **not** internet
reachable (TB5 — producers are only the Worker's own Cron/API code), so the
realistic threat is amplification and poison messages, not direct injection.
**L: M / I: M.** Mitigations: max-retry + dead-letter queue on every consumer;
consumers are idempotent (keyed on notice ID / digest dedupe key) so redelivery
is safe; ingestion scope changes are admin-only, C8-logged, and bounded by a
sanity cap (max notices per run — exceeding it pauses ingestion and alerts
rather than filling D1); per-message CPU guard from T14; admin pause switches
(product scope §9) kill a runaway pipeline.

**T18. Digest abuse.** Using BidMorrow to send unwanted email: signup bombing a
victim address with verification mail, forcing empty/duplicate digests, or a
dedupe bug spamming customers — all of which burn the Resend domain reputation
(A9) that HUMAN_DECISION_BLOCKERS item 2 works hard to establish. **L: M /
I: M.** Mitigations: C7 rate limits on any endpoint that triggers email
(signup, resend-verification, reset) per address and per IP; DB-enforced
one-digest-per-org-per-day dedupe (unique constraint, not application memory —
survives retries); digests only to verified addresses; empty digests off by
default; unsubscribe/preferences honored at send time; SPF/DKIM/DMARC per
blockers doc prevent third parties spoofing bidmorrow.com; send-volume anomaly
alert (daily sends >> org count ⇒ pause + investigate).

### 4.4b Organization deletion/purge lifecycle (A12) — Tampering / Elevation / DoS

**T22. Organization deletion/purge integrity (Phase 11).** Multiple failure
shapes around the soft-delete → 30-day grace → hard-purge/tombstone
lifecycle: (a) a non-OWNER or a member of a DIFFERENT org triggering
`DELETE /api/org`; (b) the purge job running early (data lost before the
grace window promised) or never (an org that should be purged staying live
forever, holding stale PII past its committed retention); (c) the caller
being resolved into the WRONG organization during the grace window when they
hold membership in more than one org across their lifetime (an older deleted
org shadowing a newer active one, or vice versa); (d) a purge-eligibility
check that can be gamed by an org name chosen to collide with the tombstone
naming scheme, permanently escaping the purge scan. **L: L/M / I: H** (data
retention promises in docs/privacy.md are a customer-facing/legal
commitment, not just an implementation detail). Mitigations: (a) `DELETE
/api/org` requires `requireRole('ORGANIZATION_OWNER')` plus exact-match,
server-verified `{confirm: <real org name>}` (no client-supplied
organization id ever trusted — C6); (b) `listOrganizationsPendingPurge`
computes eligibility off `organizations.updated_at`, set once by
`softDeleteOrganization` and never bumped again for a deleted org by any
other write path (P11-R-02 fixed a regression where a departing member's
`nullifyOrganizationCreator` call would otherwise restart the grace clock on
every account deletion, indefinitely deferring purge); the daily retention
cron always invokes `runOrgPurge` so a stuck job is a monitoring-visible gap,
not a silent one; (c) SEC-P11-01 fixed `getFirstOrganizationForUserAnyStatus`
to resolve ACTIVE membership first (not plain id-ascending order), so a
30-day-old deleted org can no longer shadow a newer active one for the
caller; (d) P11-R-01 fixed the purge-eligibility check from a `LIKE
'deleted-%'` prefix scan (collidable with a genuine org legitimately named
e.g. "Deleted-Data GmbH") to an exact per-row comparison against that row's
own would-be tombstone name (`name != ('deleted-' || id)`), which can only
ever match a row's own tombstone. `subscriptions`/`audit_events`/
`billing_events` are never hard-deleted (their FK to `organizations` is why
the org row itself is tombstoned, not dropped) — see A11/T19/SEC-P11-03
below for that ledger's own retention bound.

### 4.6 Insider & operational (A7, A8, A11) — Elevation / Info disclosure / Repudiation

**T19. Admin misuse.** An INTERNAL_ADMIN (or a compromised admin account —
the highest-value ATO target) reading customer strategy data at will, editing
flags/scope maliciously, or covering tracks. In a solo-founder V1 this is
mostly about compromised-account risk and provable trustworthiness to pilot
customers. **L: L / I: Critical.** Mitigations: C11 — `ADMIN_EMAILS` allowlist
kept minimal (currently one address per blockers doc §6); admin accounts
require strong auth (long random password minimum; passkey/2FA as soon as
Better Auth config allows — see residual risks); C8 — Phase 10 made this
generic, not just per-mutation: `requireInternalAdmin` writes an
`audit_events` row for **every** request that clears the allowlist gate
(reads included), in a try/finally so it fires even when the handler throws,
in addition to the specific before/after-summary rows individual admin
mutations (suspend, flag change, backfill) write; the audit table has **no
delete/update path in application code** (append-only repository); admin UI
shows only what debugging requires (match trace over raw browsing); the admin
surface is cloaked (404, not 401/403, for any non-allowlisted caller — C11)
and lives under a distinct route prefix (`/api/admin/*`) with its own
middleware stack (TB4); it shares the SAME session cookie as the customer
plane (see the C5 correction — no distinct `SameSite=Strict` admin cookie
exists), so C11's allowlist + 404 cloaking, not a cookie attribute, is the
actual isolation control; C4 frame-ancestors none. **SEC-P11-03 / P11-R-05
(2026-08-15 review): `audit_events` retention is now a BOUNDED, not
unbounded, forensics window.** A tombstoned organization's pre-deletion name
and its actors' ids remain readable in `audit_events` rows — this is
DELIBERATE (the ledger is append-only by design, T19's own "no delete/update
path in application code" is the point, and forensics on a deleted org's
history must survive the org's own tombstoning) but is now explicitly time-
bounded: SEC-P11-04 added a 24-month time-based purge (`runLedgerPurge`,
same daily retention cron as the org-purge job above) that deletes
`audit_events` rows past that window (and `email_deliveries`/
`product_events` past 12 months, per docs/privacy.md's data inventory) —
"retained for forensics" now has a concrete, enforced end date rather than
being retained forever by omission.

**T20. Secret exposure.** Leaking A7: secrets committed to git, echoed in
Worker logs, pasted into error messages, present in `wrangler.toml` `[vars]`,
bundled into the SPA, or exfiltrated via a compromised CI. **L: M /
I: Critical** (Paddle live API key = money; CF token = whole platform).
Mitigations: C10 — all secrets via `wrangler secret put` / GitHub environment
secrets, per-environment, never in code or plain vars; `.env` gitignored +
secret-scanning (gitleaks or GitHub push protection) in CI; client bundle
contains no secrets by construction (only publishable values ever reach Vite
env); error responses are generic — stack traces and env dumps never returned
(Hono error middleware); C11 — the CF API token is scoped to exactly the
Workers/D1/R2/Queues edit permissions listed in blockers doc §1, so a leaked
token cannot touch DNS/account settings; the GitHub "production"
environment is restricted to protected branches only; since 2026-09-02
the deploy workflow runs automatically after every successful staging
deploy on `main` (owner decision: `main` is the production branch), and
a manual dispatch still requires the typed `confirm: deploy-production`
input validated in-job (environment Required reviewers need GitHub
Enterprise on private repos and are NOT in place — corrected 2026-08-16;
accepted residual: whoever can merge to `main` or dispatch the workflow
deploys production without a second human, see §5); rotation runbook
documented (rotate first, investigate second).

**T21. Dependency compromise.** Malicious or vulnerable npm packages (Hono,
Drizzle, Better Auth, React, `@paddle/paddle-js`, transitive deps) or a compromised
GitHub Action exfiltrating CI secrets — currently the most active real-world
attack class. **L: M / I: H.** Note (ADR-0011): there is no Paddle server SDK —
the Worker talks to Paddle over plain `fetch`; the SPA's `@paddle/paddle-js`
is only a loader that fetches Paddle.js from `cdn.paddle.com` at runtime
(Paddle mandates its CDN), so that script is a standing trust in Paddle's
supply chain, bounded by the CSP allowlist (C3). Mitigations: lockfile committed and CI installs
with frozen lockfile; Dependabot/`npm audit` gating with prompt patching of
critical advisories; minimal dependency posture (V1 explicitly avoids
analytics SDKs, LLM SDKs, session replay — see product scope); **GitHub
Actions workflows are pinned to commit SHAs as of 2026-08-16** (Phase 13
hardening; every `uses:` in `.github/workflows/*.yml` carries the full
commit SHA with the tag as a trailing comment — a 2026-08-15 review had
found only mutable tag-pinning and tracked this as a follow-up, now
closed; keep new workflow steps SHA-pinned); C11 — read-only reviewer
agents and scoped tokens
limit what compromised tooling can reach; C10 — CI secrets exposed only to
the deploy job in the protected environment; C3 means even a compromised
frontend dependency cannot load remote script or beacon to arbitrary origins;
no postinstall-heavy packages without review.

---

## 5. Residual risks (accepted for V1, with rationale)

| Risk                                                                                                                                                                                                                                                                                                   | Why accepted                                                                                                                                                                                                                                                                                                                                                                                              | Revisit when                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No 2FA/passkeys at launch                                                                                                                                                                                                                                                                              | Better Auth supports it but V1 UI scope is minimal; strong rate-limiting + breach-password checks carry interim load                                                                                                                                                                                                                                                                                      | First customer request, or any credential-stuffing incident — whichever first                                                                                                                                              |
| Admin plane shares the single Worker with the customer app (monolith)                                                                                                                                                                                                                                  | Separate admin deployment is disproportionate at this scale; role + allowlist + audit compensate                                                                                                                                                                                                                                                                                                          | Team grows beyond founder, or SOC2-type requirements appear                                                                                                                                                                |
| D1 has no row-level security; tenant isolation is application-layer (C6)                                                                                                                                                                                                                               | D1/SQLite offers no native RLS; the typed repository requirement + CI isolation tests are the enforcement                                                                                                                                                                                                                                                                                                 | Any C6 bypass found in review, or migration off D1                                                                                                                                                                         |
| TED upstream integrity is trusted after TLS (no content signing exists)                                                                                                                                                                                                                                | No signed feed available; quarantine + versioning + R2 snapshots bound the damage                                                                                                                                                                                                                                                                                                                         | TED offers integrity mechanisms, or a poisoning incident                                                                                                                                                                   |
| No periodic reconciliation job exists (webhooks are the only sync path) — a webhook lost past Paddle's 3-day retry window leaves entitlement drift until the next event                                                                                                                                | Webhooks + idempotency + live re-fetch make drift rare; the admin subscriptions view and the Paddle dashboard notification log are the manual recovery path (docs/runbook.md)                                                                                                                                                                                                                             | Chargeback/abuse patterns, or plan complexity grows                                                                                                                                                                        |
| No dedicated SIEM/alerting stack; audit logs reviewed manually                                                                                                                                                                                                                                         | V1 has no analytics/monitoring SaaS by design; CF dashboards + email alerts suffice at pilot scale                                                                                                                                                                                                                                                                                                        | >50 orgs, or first security incident                                                                                                                                                                                       |
| Single-region single-DB (D1) availability profile                                                                                                                                                                                                                                                      | Accepted for a daily-digest product; RPO = D1 backup cadence                                                                                                                                                                                                                                                                                                                                              | Paying customers demand SLA                                                                                                                                                                                                |
| `API_RATE_LIMITER` fails OPEN, not closed, when the Workers binding is absent (`middleware/rate-limit.ts`, verified from source: `if (limiter === undefined) { ...; await next(); return; }`) — `/api/org/*` gets zero rate limiting for the rest of that isolate's life, logged once, not per-request | Deliberate: failing closed would take the entire customer-facing API down on a binding misconfiguration, which is a worse outcome than temporarily uncapped write volume at pilot scale; the gap is visible in structured logs (`API_RATE_LIMITER binding is not configured`), not silent                                                                                                                 | Any staging/production deploy where the binding is confirmed missing (this should never happen post-deploy-checklist, but the code does not enforce it); or first real abuse incident that a rate limit would have stopped |
| ~~GitHub Actions workflows reference actions by version TAG, not commit SHA~~ CLOSED 2026-08-16: every `uses:` in all workflows is pinned to a full commit SHA (T21)                                                                                                                                   | Row kept for history — the 2026-08-15 review found tag-pinning; the Phase 13 hardening pass closed it                                                                                                                                                                                                                                                                                                     | —                                                                                                                                                                                                                          |
| Production deploys have no second-human gate: any repo-write principal can dispatch `deploy-production.yml` (environment Required reviewers need GitHub Enterprise on private repos)                                                                                                                   | Accepted 2026-08-16, restated 2026-09-02 when production became continuous from `main`: compensating controls are the required PR checks and branch protection on `main`, the staging deploy's smoke tests that must pass before the production run starts, the protected-branches-only environment policy, and the typed `confirm: deploy-production` input validated in-job for manual dispatches (T20) | Additional collaborators gain repo write access, or the repo moves to a plan where environment Required reviewers are enforceable                                                                                          |

## 6. Review triggers — when this model must be revisited

Re-run this threat model (at minimum the affected sections) when any of the
following happens:

1. **Architecture change**: new datastore, new external service/webhook, new
   queue/consumer, moving off D1/Workers, or splitting the monolith.
2. **Any LLM enters the production path** (currently none): prompt-injection
   via TED text becomes a first-class threat and §4.4 must be rewritten.
3. **New data source** beyond TED (`ProcurementSource` implementations —
   national portals, paid datasets): re-evaluate T13–T15 per source.
4. **Multi-seat collaboration UI ships** (MEMBER role becomes real): re-check
   T10 role matrix, invitation flows, and per-member audit granularity.
5. **New public endpoint** that is unauthenticated or crosses TB3 (any new
   webhook, callback, or public API).
6. **Auth changes**: 2FA/passkeys/OAuth providers added, session model changed,
   or Better Auth major-version upgrade.
7. **Billing changes**: new plans, usage billing, a billing-provider change, or any flow that
   grants entitlements outside the webhook path.
8. **Any security incident or near-miss**, including a tenant-isolation test
   failure in CI or a dependency-advisory affecting an internet-facing path.
9. **Team growth**: any person beyond the founder gains INTERNAL_ADMIN,
   production deploy rights, or secret access.
10. **Scheduled**: at least every 6 months even if nothing above fired.
11. **`API_RATE_LIMITER` confirmed missing in staging/production** (the
    fail-open residual risk above) — re-run §4.5/T16 and treat it as an
    active gap, not a theoretical one, until the binding is restored.

---

_Owner: engineering. Last reviewed: 2026-08-15 (Phase 11 fix batch: A12/T22
organization deletion-purge lifecycle added; rate-limit fail-open residual +
revisit trigger #11 added; T13 XML size-cap mitigation concretized; T12
billing surface pattern concretized + SEC-P9-02/03 residuals recorded; T19
admin surface updated + C5's `SameSite=Strict` claim corrected to reality
(single shared session cookie, Better Auth default `Lax`); T21's GitHub
Actions claim corrected from SHA-pinned to tag-pinned + ledger follow-up
recorded; SEC-P4-09 deltas closed out (cf-connecting-ip keying, global body
limit, account-deletion compensation)). 2026-08-16 (Phase 13 hardening):
SEC-P9-02 closed (in-worker IP rate limit on the billing webhook route,
before signature verification), SEC-P9-03 closed (webhook double-checkout
catch-and-reconcile), T21 GitHub Actions now genuinely SHA-pinned, T12/T16
rate-limit coverage extended to `/api/admin/*` and `/api/account/*`
(P10-R-04), and FK enforcement is verified live (`PRAGMA foreign_keys`) at
every deploy. Status: V1 baseline — written against
the assumed architecture; reconcile with docs/architecture.md when it lands
(trigger #1 applies if they diverge)._
