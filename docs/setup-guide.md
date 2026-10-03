# BidMorrow — Human Setup Guide (accounts, secrets, connections)

Step-by-step instructions for every account, credential, and connection a
human must provide before/around Phase 13 (Deployment). Written for the
account owner; assumes no prior Cloudflare/Paddle/Resend experience.

Companion to `HUMAN_DECISION_BLOCKERS.md` (which tracks _status_); this file
is the _how_.

---

## 0. The golden rules for secrets

1. **Never paste a secret into the assistant chat, a commit, an issue, or a PR.**
   The assistant never needs to see secret values — only to know they exist.
2. Every secret has exactly **one place you put it**, and the pipeline
   distributes it from there:

| Destination                                                                  | What goes there                                      | Who reads it                                                                              |
| ---------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **GitHub → repo → Settings → Secrets and variables → Actions**               | ALL secrets (deploy credentials AND runtime secrets) | CI only; deploy workflow forwards runtime secrets to Cloudflare via `wrangler secret put` |
| **Cloudflare dashboard → Workers & Pages → (worker) → Settings → Variables** | Optional manual alternative for runtime secrets      | The deployed Worker                                                                       |

Recommended: use **GitHub Actions secrets as the single source of truth**.
You enter each value once; the deploy workflow pushes runtime secrets to the
Worker. You never manage two copies.

3. Rotation: if a secret ever leaks (or you merely suspect it), revoke it at
   the issuer (Cloudflare/Paddle/Resend), create a new one, update the GitHub
   secret, re-run the deploy workflow. Nothing in the repo changes.

---

## 1. Cloudflare — Workers Paid plan (~2 min, $5/month)

Required because Cloudflare **Queues** (used for ingestion/scoring/digest
jobs) is only available on the Workers Paid plan. This is the first blocker:
staging cannot deploy without it.

1. https://dash.cloudflare.com → select your account.
2. Left sidebar → **Workers & Pages** → **Plans**.
3. Choose **Workers Paid** ($5/month) → confirm billing.

Done when: the plan page shows "Workers Paid".

---

## 2. Cloudflare — scoped API token + account ID for CI (~5 min)

The Cloudflare MCP connector already serves the assistant's interactive sessions,
but **GitHub Actions CI needs its own least-privilege token** to deploy.

### 2a. Create the token

1. https://dash.cloudflare.com → top-right profile icon → **My Profile** →
   **API Tokens** → **Create Token**.
2. Start from the **"Edit Cloudflare Workers"** template.
3. Under **Permissions**, make sure the final list includes (add any missing;
   verified against Cloudflare docs 2026-08-15):
   - `Account` / `Workers Scripts` / `Edit` — deploy, cron, `wrangler secret put`
   - `Account` / `D1` / `Edit` — create DB, remote migrations
   - `Account` / `Workers R2 Storage` / `Edit` — snapshots bucket
   - `Account` / `Queues` / `Edit` — job queues + DLQs
   - `Account` / `Account Settings` / `Read` (template default)
   - `Zone` / `Workers Routes` / `Edit` — custom-domain attach at deploy
   - `User` / `User Details` / `Read` + `User` / `Memberships` / `Read`
     (template defaults, used by `wrangler whoami`)
   - Remove `Workers KV Storage` if the template added it (unused).
   - Do NOT add DNS Edit — custom domains manage their own record via
     Workers Routes.
4. **Account Resources**: Include → your account (not "All accounts").
5. **Zone Resources**: Include → Specific zone → `bidmorrow.com`.
6. Continue → Create Token → **copy the token now** (shown once).

Never use the legacy "Global API Key" — it cannot be scoped.

### 2b. Find your account ID

Dashboard → Workers & Pages → right-hand sidebar shows **Account ID**
(also visible in the dashboard URL: `dash.cloudflare.com/<account-id>`).
The account ID is an identifier, not a secret, but we store it as a secret
for tidiness.

### 2c. Add both to GitHub

1. https://github.com/cploutarchou/bidmorrow → **Settings** →
   **Secrets and variables** → **Actions** → **New repository secret**.
2. Add:
   - Name `CLOUDFLARE_API_TOKEN`, value = the token from 2a.
   - Name `CLOUDFLARE_ACCOUNT_ID`, value = the ID from 2b.

Done when: both names appear in the Actions secrets list.

> **As actually configured (2026-08-15)**: the owner stored these (and all
> other secrets) in the GitHub **`staging` environment** instead of
> repository-level — equally valid; the deploy workflows therefore declare
> `environment: staging` / `environment: production`, and production values
> must be added to the `production` environment before the first
> production deploy.

---

## 3. GitHub — repository protection (~5 min)

1. Repo → Settings → **Branches** → Add branch protection rule for `main`
   (the default branch — renamed from `master` on 2026-08-15):
   - Require a pull request before merging.
   - Require status checks to pass (select the CI workflow's check).
2. Repo → Settings → **Environments** → New environment `production`:
   - Add **Required reviewers**: yourself.
   - The production deploy workflow will target this environment, so every
     production deploy needs your explicit click to proceed.

---

## 4. Paddle — account, catalog, keys (~15 min, sandbox first)

Paddle Billing is the **Merchant of Record** (ADR-0011): Paddle is the
legal seller, charges VAT for the customer's country, remits it and issues
the invoices. You need no VAT registration. Sandbox and live are two
completely separate accounts (different dashboards, keys, catalogs,
webhook destinations); nothing crosses between them.

### 4a. Sandbox account

1. https://sandbox-vendors.paddle.com → create/sign in (the sandbox signup
   is separate from live; no approval needed).
2. Everything below is in the SANDBOX dashboard until §4f.

### 4b. Catalog — ALREADY CREATED (2026-08-25, via the Paddle MCP)

Two products with one EUR monthly price each, tax category `saas`.
They were created `tax_mode: external`; the owner decision of 2026-08-26
made prices **tax-INCLUSIVE**, so both must be switched to tax mode
"Inclusive" (`internal`) in the dashboard — until that is done the
overlay adds VAT on top of €29/€49 while the site says "incl. VAT"
(blockers item 4b):

| Product            | Product id                       | Price id (monthly, EUR)          | Amount |
| ------------------ | -------------------------------- | -------------------------------- | ------ |
| BidMorrow Founding | `pro_01m0wx38mqz3gm6r2ytx6qakq4` | `pri_01m0wx38ymack0vxmqvtadddg9` | €29.00 |
| BidMorrow Standard | `pro_01m0wx38tjejcm7tvx35paz8rp` | `pri_01m0wx39a5dkx4fpr7pexbwv6b` | €49.00 |

Verify under **Catalog → Products**. Price ids are configuration, not
secrets, but they are stored alongside the other Paddle values.

### 4c. Keys → GitHub `staging` environment

| GitHub name                     | Kind     | Where to get it (sandbox dashboard)                                                                        |
| ------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `PADDLE_API_KEY`                | secret   | Developer tools → Authentication → **API keys** → New (`pdl_sdbx_apikey_…`); copy once                     |
| `PADDLE_WEBHOOK_SECRET`         | secret   | Developer tools → Notifications → **BidMorrow staging** destination → secret key (`pdl_ntfset_…`)          |
| `PADDLE_PRICE_FOUNDING_MONTHLY` | secret   | `pri_01m0wx38ymack0vxmqvtadddg9` (table above)                                                             |
| `PADDLE_PRICE_STANDARD_MONTHLY` | secret   | `pri_01m0wx39a5dkx4fpr7pexbwv6b` (table above)                                                             |
| `PADDLE_CLIENT_TOKEN`           | variable | `test_71e5894f9d1a1e0d7f52b651ba5` — client-side token `ctkn_01m0wx39m4rv1qen7ez4bk08vx`, public by design |
| `PADDLE_ENVIRONMENT`            | variable | `sandbox`                                                                                                  |

The API key needs read/write on transactions, subscriptions, customers,
customer portal sessions, and read on products/prices. The client token
is safe to expose (it only opens checkouts); the API key never leaves the
Worker.

### 4d. Webhook destination — ALREADY CREATED

`ntfset_01m0wx39g6qmk4m1bmf39mpa4d` → `https://staging.bidmorrow.com/api/webhooks/paddle`,
subscribed to the eight `subscription.*` events (docs/deployment.md § Paddle
webhook registration). Only the secret copy in 4c is left to do.

### 4e. Dashboard-only settings (cannot be set by API)

1. **Checkout → Checkout settings → Default payment link** =
   `https://staging.bidmorrow.com/app/settings`. Paddle.js refuses to open
   a checkout ("Something went wrong") until this is set.
2. **Checkout → Website approval**: add `staging.bidmorrow.com` (sandbox
   approves instantly).

### 4f. Live (before the first real charge — allow DAYS for approval)

**Status 2026-08-30:** steps 3, 4 and 5 (token) and 6 (all but two secrets)
are DONE via the `paddle-live` MCP — products
`pro_01m19e8qdsyrezm8z9zf9bazc3` / `pro_01m19e8qk2cffzy8dp0m99b8tz`, prices
`pri_01m19e8qpvnd6kttmjr2dndpkd` (€29, inclusive) /
`pri_01m19e8qv0810gaeg1z2s27cv8` (€49, inclusive), destination
`ntfset_01m19e8r12sx7j9m31s4ef4j56`, client token
`ctkn_01m19e8r53epwzj5048b14m92b` = `live_0437a850a828f5dc3b74fcb3603`.
Owner still owes: 1 (seller verification), 2 (website approval), the default
payment link + branding in 5, and `PADDLE_API_KEY` + `PADDLE_WEBHOOK_SECRET`
in 6.

1. https://vendors.paddle.com → sign up for a LIVE account and complete
   Paddle's seller verification (identity/business review — Paddle
   approves asynchronously).
2. **Website approval** for `bidmorrow.com` (manual review: public pricing,
   terms with Paddle named as Merchant of Record, privacy, refund policy).
3. Recreate the catalog exactly as 4b (EUR, monthly) but with tax mode
   **"Inclusive"** (`internal`) from the start — the 2026-08-26 owner
   decision; €29/€49 is what the customer pays. Note the new `pri_…` ids.
4. Notification destination → `https://bidmorrow.com/api/webhooks/paddle`,
   same event set; copy its secret.
5. Client-side token (`live_…`); default payment link
   `https://bidmorrow.com/app/settings`.
6. GitHub `production` environment: the four secrets above with live
   values, `PADDLE_CLIENT_TOKEN=live_…`, `PADDLE_ENVIRONMENT=production`.

---

## 5. Resend — email sending (~15 min + DNS propagation)

Needed before any real verification/digest email. Until then the app runs
with a logging email provider (safe, sends nothing).

1. https://resend.com → create an account.
2. **Domains** → Add Domain → `bidmorrow.com`.
3. Resend shows SPF + DKIM (and recommended DMARC) DNS records. Since
   bidmorrow.com DNS is already on Cloudflare: open Cloudflare dashboard →
   `bidmorrow.com` zone → **DNS** → add each record exactly as Resend shows
   it (type, name, value; proxy status OFF/grey for these records).
   - Recommended DMARC start: `v=DMARC1; p=none; rua=mailto:postmaster@bidmorrow.com`
     (tighten to `p=quarantine` after a few weeks of monitoring).
4. Wait for Resend to show the domain as **Verified** (minutes to hours).
5. **API Keys** → Create API key (sending access only) → GitHub secret
   `RESEND_API_KEY`. Create a second key later for production — one key per
   environment, never shared.
6. Sending addresses (already assumed by the app's config):
   `verify@bidmorrow.com` (auth emails) and `digest@bidmorrow.com`
   (daily digests). Set the GitHub secret/variable `EMAIL_FROM` accordingly
   when the assistant wires the deploy workflow.

---

## 6. App-generated secrets (~2 min)

Generate locally in any terminal — do not reuse values across environments:

```bash
openssl rand -base64 32
```

| GitHub secret name   | Value                                             |
| -------------------- | ------------------------------------------------- |
| `BETTER_AUTH_SECRET` | output of the command above (one per environment) |

Also confirm the admin allowlist (a variable, not a secret):
`ADMIN_EMAILS=cploutarchou@gmail.com` — tell the assistant if this should differ.

---

## 7. What is already connected to the assistant (no action needed)

| Connection                        | Status       | What the assistant can do with it                                                                                                  |
| --------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| GitHub (`cploutarchou/bidmorrow`) | ✅ connected | Branches, commits, PRs, CI status, merges                                                                                          |
| Cloudflare MCP connector          | ✅ connected | Create/manage D1 databases, R2 buckets, KV; query D1; inspect Workers — used in Phase 13 to provision staging/production resources |
| bidmorrow.com zone on Cloudflare  | ✅ done      | Custom-domain attach can happen automatically at deploy time (wrangler route with `custom_domain: true`)                           |

## 8. What you can OPTIONALLY connect to automate more

| Connector                                                                  | How                                                     | What it automates                                                                                              | Worth it?      |
| -------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------- |
| **Paddle MCP** (official plugin: `paddle-sandbox` / `paddle-live` servers) | assistant plugin, already connected for sandbox         | Created the sandbox catalog, webhook destination and client token (4b/4d); can repeat for live once authorised | Already in use |
| Resend MCP                                                                 | Resend publishes an MCP server for _sending_ email only | Nothing in this guide — account, domain, API key stay manual                                                   | No             |

Everything else is **deliberately not automatable**: plan/billing approvals,
API-token creation, and secret entry must stay in your hands — the assistant never
sees or invents credential values (see `docs/project-guide.md` hard rules). The point of
this guide is that you enter each value exactly once, into GitHub Actions
secrets, and automation handles all distribution from there.

## 9. Order of operations (what unblocks what)

```
1. Workers Paid plan          ──┐
2. CF token + account ID → GH  ─┴─► Phase 13: staging deploy (workers.dev)
3. Paddle sandbox keys/prices → GH ─► billing works on staging
   4c. webhook secret (destination already exists)
5. Resend key + DNS records   ──► real emails on staging
6. BETTER_AUTH_SECRET → GH    ──► required for staging deploy (with #1/#2)
3 (GitHub protection)         ──► anytime; required before production
Live Paddle account + prod keys ─► production launch only
```

Minimum to let the assistant deploy staging end-to-end: **items 1, 2, and 6**.
Paddle/Resend can be added afterwards without redeploying code — they are
secrets-only changes.
