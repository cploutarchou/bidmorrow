# BidMorrow — Human Setup Guide (accounts, secrets, connections)

Step-by-step instructions for every account, credential, and connection a
human must provide before/around Phase 13 (Deployment). Written for the
account owner; assumes no prior Cloudflare/Stripe/Resend experience.

Companion to `HUMAN_DECISION_BLOCKERS.md` (which tracks _status_); this file
is the _how_.

---

## 0. The golden rules for secrets

1. **Never paste a secret into a Claude chat, a commit, an issue, or a PR.**
   Claude never needs to see secret values — only to know they exist.
2. Every secret has exactly **one place you put it**, and the pipeline
   distributes it from there:

| Destination                                                                    | What goes there                                        | Who reads it                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------- |
| **GitHub → repo → Settings → Secrets and variables → Actions**                 | ALL secrets (deploy credentials AND runtime secrets)   | CI only; deploy workflow forwards runtime secrets to Cloudflare via `wrangler secret put` |
| **Cloudflare dashboard → Workers & Pages → (worker) → Settings → Variables**   | Optional manual alternative for runtime secrets        | The deployed Worker                   |

Recommended: use **GitHub Actions secrets as the single source of truth**.
You enter each value once; the deploy workflow pushes runtime secrets to the
Worker. You never manage two copies.

3. Rotation: if a secret ever leaks (or you merely suspect it), revoke it at
   the issuer (Cloudflare/Stripe/Resend), create a new one, update the GitHub
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

The Cloudflare MCP connector already serves Claude's interactive sessions,
but **GitHub Actions CI needs its own least-privilege token** to deploy.

### 2a. Create the token

1. https://dash.cloudflare.com → top-right profile icon → **My Profile** →
   **API Tokens** → **Create Token**.
2. Start from the **"Edit Cloudflare Workers"** template.
3. Under **Permissions**, make sure the final list includes (add any missing):
   - `Account` / `Workers Scripts` / `Edit`
   - `Account` / `D1` / `Edit`
   - `Account` / `Workers R2 Storage` / `Edit`
   - `Account` / `Queues` / `Edit`
4. **Account Resources**: Include → your account (not "All accounts").
5. **Zone Resources**: Include → Specific zone → `bidmorrow.com`
   (needed so deploys can attach the custom domain).
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

---

## 3. GitHub — repository protection (~5 min)

1. Repo → Settings → **Branches** → Add branch protection rule for `master`:
   - Require a pull request before merging.
   - Require status checks to pass (select the CI workflow's check).
2. Repo → Settings → **Environments** → New environment `production`:
   - Add **Required reviewers**: yourself.
   - The production deploy workflow will target this environment, so every
     production deploy needs your explicit click to proceed.

---

## 4. Stripe — account, products, keys (~15 min, test mode first)

All development and staging use **test mode**. Live mode is repeated only
before real launch.

### 4a. Account + test mode

1. https://dashboard.stripe.com → create/sign in to your account.
2. Toggle **Test mode** ON (top-right switch) for everything below.

### 4b. Products and prices (test mode)

Create two products (Product catalog → Add product):

| Product           | Price     | Billing period |
| ----------------- | --------- | -------------- |
| BidMorrow Founding | $29.00    | Monthly        |
| BidMorrow Standard | $49.00    | Monthly        |

After creating each, open the price and copy its **Price ID**
(`price_...`). Price IDs are configuration, not secrets, but we store them
alongside the other Stripe values.

### 4c. Keys and secrets → GitHub Actions secrets

| GitHub secret name              | Where to find it (test mode)                                    |
| ------------------------------- | --------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`             | Developers → API keys → **Secret key** (`sk_test_...`)          |
| `STRIPE_PRICE_FOUNDING_MONTHLY` | Product catalog → Founding product → price → Price ID           |
| `STRIPE_PRICE_STANDARD_MONTHLY` | Product catalog → Standard product → price → Price ID           |
| `STRIPE_WEBHOOK_SECRET`         | **Not yet** — created in 4d, AFTER the first staging deploy     |

### 4d. Webhook endpoint (after Phase 13 staging deploy)

The endpoint URL only exists once the Worker is deployed. When Claude
reports the staging URL:

1. Developers → **Webhooks** → Add endpoint.
2. Endpoint URL: `https://<staging-worker-url>/api/webhooks/stripe`.
3. Events: select the set listed in `docs/architecture.md` § billing
   (checkout/session, customer.subscription, invoice events).
4. Copy the **Signing secret** (`whsec_...`) → GitHub secret
   `STRIPE_WEBHOOK_SECRET`.

### 4e. Customer Portal

Settings → Billing → **Customer portal** → activate (test mode; repeat in
live mode later). Enable "Cancel subscription" and payment-method updates.

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
   when Claude wires the deploy workflow.

---

## 6. App-generated secrets (~2 min)

Generate locally in any terminal — do not reuse values across environments:

```bash
openssl rand -base64 32
```

| GitHub secret name   | Value                                            |
| -------------------- | ------------------------------------------------ |
| `BETTER_AUTH_SECRET` | output of the command above (one per environment) |

Also confirm the admin allowlist (a variable, not a secret):
`ADMIN_EMAILS=cploutarchou@gmail.com` — tell Claude if this should differ.

---

## 7. What is already connected to Claude (no action needed)

| Connection            | Status | What Claude can do with it                                                    |
| --------------------- | ------ | ----------------------------------------------------------------------------- |
| GitHub (`cploutarchou/bidmorrow`) | ✅ connected | Branches, commits, PRs, CI status, merges                          |
| Cloudflare MCP connector | ✅ connected | Create/manage D1 databases, R2 buckets, KV; query D1; inspect Workers — used in Phase 13 to provision staging/production resources |
| bidmorrow.com zone on Cloudflare | ✅ done | Custom-domain attach can happen automatically at deploy time (wrangler route with `custom_domain: true`) |

## 8. What you can OPTIONALLY connect to automate more

| Connector | How | What it automates | Worth it? |
| --------- | --- | ----------------- | --------- |
| **Stripe MCP** (official, `https://mcp.stripe.com`) | claude.ai → Settings → Connectors → Add custom connector → paste URL → authorize via Stripe OAuth | Claude creates the test-mode products/prices itself and reads the price IDs — removes step 4b entirely | Yes, if you'd rather not click through the Stripe catalog UI |
| Resend MCP | Resend publishes an MCP server for _sending_ email only | Nothing in this guide — account, domain, API key stay manual | No |

Everything else is **deliberately not automatable**: plan/billing approvals,
API-token creation, and secret entry must stay in your hands — Claude never
sees or invents credential values (see `CLAUDE.md` hard rules). The point of
this guide is that you enter each value exactly once, into GitHub Actions
secrets, and automation handles all distribution from there.

## 9. Order of operations (what unblocks what)

```
1. Workers Paid plan          ──┐
2. CF token + account ID → GH  ─┴─► Phase 13: staging deploy (workers.dev)
3. Stripe test keys/prices → GH ──► billing works on staging
   4d. webhook secret (needs staging URL, done after deploy)
5. Resend key + DNS records   ──► real emails on staging
6. BETTER_AUTH_SECRET → GH    ──► required for staging deploy (with #1/#2)
3 (GitHub protection)         ──► anytime; required before production
Live-mode Stripe + prod keys  ──► production launch only
```

Minimum to let Claude deploy staging end-to-end: **items 1, 2, and 6**.
Stripe/Resend can be added afterwards without redeploying code — they are
secrets-only changes.
