# BidMorrow — Content & SEO Strategy (website redesign workstream)

Author: content-seo-strategist agent · Date: 2026-08-17
Scope: public marketing site only. Public tender-detail SEO pages are OUT of V1
(docs/product-scope.md — "thin content + leaking customer relevance signals").
All recommendations respect the truth rules in
`.claude/skills/website-redesign/requirements.md` and the frozen pricing
directive (€29/€49 substance unchanged; presentation only).

Evidence base: repo inspection (`apps/web/src/copy.ts`, `apps/web/src/pages/*`,
`apps/web/index.html`, `apps/web/public/_headers`, `apps/worker/wrangler.jsonc`,
`apps/web/src/app.test.ts`, `docs/website-redesign-plan.md`,
`docs/product-scope.md`) plus live WebSearch (reachable this session) for the
competitive keyword landscape and the CSP/JSON-LD mechanism. **No keyword-volume
tool was reachable — volumes are qualitative estimates from SERP composition,
labeled as such.**

---

## 1. Technical SEO audit — findings ranked by impact

### Critical

**T1. No static HTML for any route (SPA, no SSR/prerender).**
Every URL — `/pricing`, `/methodology`, everything — is served the same
`apps/web/index.html`: an empty `<div id="root">` plus the Home title and
description. Consequences:

- Non-Google crawlers and every social/link-preview scraper (Slack, LinkedIn,
  WhatsApp, Teams — none execute JS) see identical, Home-flavored metadata for
  all 8 pages and **zero body content**.
- Per-route `<title>`, meta description, and `<link rel="canonical">` (which
  the pages correctly render via React 19 hoisting) exist **only after JS
  execution**. Google renders JS but on a deferred second-wave budget; a brand
  new domain gets minimal render budget.
- The canonical signal in raw HTML is effectively "every URL looks like `/`"
  → classic duplicate-content ambiguity at exactly the moment a new domain is
  trying to earn trust.
  Fix: prerender public routes at build time — see §7.

**T2. `not_found_handling: "single-page-application"` produces sitewide
soft-404s.** (`apps/worker/wrangler.jsonc:12`.) Any garbage URL returns HTTP
200 with the SPA shell. Search engines classify these as soft 404s, which
degrades crawl trust. Mitigation in §7 (prerendered routes + `noindex` on the
NotFound view; true 404 status for unknown non-app paths is a stretch goal
noted there).

**T3. robots.txt is missing** (`apps/web/public/` contains only `_headers`).
No crawl directives, no sitemap pointer; `/app`, `/admin`, `/onboarding` are
crawlable 200-status URLs. Spec in §5.

**T4. sitemap.xml is missing.** For a new domain with zero backlinks, the
sitemap + Search Console submission is the primary discovery channel. Spec in §5.

### High

**T5. No Open Graph / Twitter Card metadata and no share image, on any page.**
Every share of bidmorrow.com renders as a bare URL. For a founder-led pilot
launch (LinkedIn posts, procurement forums, newsletters), link previews are
the highest-leverage single asset. Spec in §3.

**T6. Likely duplicate `<title>`/`<meta name=description>` elements after
hydration.** `index.html` carries a static title/description; each page also
renders its own, which React 19 hoists into `<head>`. React does not dedupe
against server-static tags it didn't render, so the DOM plausibly ends up with
two `<title>` and two description tags (browsers/document.title use the first
in tree order — i.e. the static Home one may _win_ on every page). Must be
verified in a rendered DOM; resolved automatically by the prerender approach
(§7), where the per-route head is the only head.

**T7. No `noindex` on app/auth/admin shells and no `<title>` on `/app` or
`/onboarding`** (already logged in the redesign plan §2). Auth pages have
titles via `AuthLayout` but no robots meta, no canonical, and generic-duplicate
descriptions (none at all). Spec: `noindex` meta on `/login`, `/signup`,
`/verify-email`, `/forgot-password`, `/reset-password`, NotFound, and all
`/app`·`/admin`·`/onboarding` shells (§3, §5).

**T8. Home `<title>` is 76 characters** ("BidMorrow — Bid/no-bid qualification
intelligence for EU public procurement") — truncated in SERPs; and it
duplicates the meaning of the meta description instead of complementing it.
The static `index.html` title uses a hyphen while components use an em dash
(inconsistent brand rendering in SERPs). Full metadata respec in §3.

### Medium

**T9. Single 357 KB JS bundle shipping admin code to marketing visitors**
(redesign plan §2). Direct Core Web Vitals / crawl-render cost. Already planned
as M4 code splitting — endorse; SEO acceptance criteria in §10 include the
budget.

**T10. Thin/dead-end pages.** `/contact` is ~2 sentences (fine to keep, but
mark it low-priority for indexing, not a keyword target); `/how-it-works`
dead-ends without a CTA (already in redesign plan). Internal-linking fixes in §8.

**T11. No structured data of any kind.** Plan in §6.

**T12. No favicon / theme-color / apple-touch icon** — minor ranking
irrelevance, but favicons render in Google SERPs and their absence looks
broken. Already in M0 scope; included in acceptance criteria.

### Correct as-is (do not regress)

- Per-page canonicals on all 8 marketing pages, absolute, consistent host
  (`https://bidmorrow.com`), no trailing-slash inconsistency.
- Semantic HTML: one `<h1>` per page, ordered heading levels, real `<table>`
  with caption/scope on Methodology, landmarks/skip links.
- English-only: correctly **no** hreflang until a second locale activates
  (requirements.md); do not add self-referencing hreflang now.
- No manipulative patterns anywhere — keep it that way (truth rules).

---

## 2. Keyword-to-page map with search intent

Method: live SERP reconnaissance this session (reachable) + domain knowledge.
Competitors visible in these SERPs are mostly small/aggressive content players
(TenderMetric, Jorpex, TenderRadar, Tendersight, TED Monitor, OpenOpps) plus
Stotles (UK, high authority). Verified pattern: **the winnable ground for a
new domain is long-tail informational queries** (CPV guides, bid/no-bid
frameworks, methodology-adjacent questions), where small competitors already
rank with glossary/guide pages — head terms ("tender software", "eTendering")
are owned by incumbents and are not realistic year-one targets. Volumes below
are qualitative (no volume tool reachable): L = low, M = medium.

| Page                 | Primary keyword                         | Secondary keywords                                                                                                                      | Intent                     | Competition (new-domain realism)                                                                                                         |
| -------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                  | bid/no-bid software for EU tenders      | tender qualification software · EU tender relevance scoring · TED tender alerts alternative                                             | Commercial                 | M — winnable long-tail phrasing; "tender software" head term is not the target                                                           |
| `/methodology`       | tender relevance scoring (how it works) | bid/no-bid decision criteria · deterministic tender matching · tender scoring methodology · what does "unknown" mean in tender matching | Informational              | **L — best long-term asset.** No competitor publishes a real methodology; this is the differentiated, linkable page                      |
| `/how-it-works`      | how TED tender matching works           | TED daily notices volume · tender shortlist from TED · CPV-based tender matching                                                        | Informational→Commercial   | L–M — competitors have "how it works" pages but none tied to a published scoring model                                                   |
| `/pricing`           | tender alert software pricing           | TED tender alert service cost · tender monitoring monthly price                                                                         | Transactional              | L — most incumbents hide pricing (demo-gated / annual upfront); a public flat-EUR pricing page is inherently differentiated in this SERP |
| `/pilot`             | (brand) BidMorrow founding pilot        | early access tender software                                                                                                            | Navigational/Transactional | n/a — conversion page, not a keyword target                                                                                              |
| `/contact`           | (brand) BidMorrow contact               | —                                                                                                                                       | Navigational               | n/a                                                                                                                                      |
| `/privacy`, `/terms` | (brand)                                 | —                                                                                                                                       | Navigational/trust         | n/a — index but no targets                                                                                                               |
| Auth pages           | —                                       | —                                                                                                                                       | —                          | noindex                                                                                                                                  |

**Deferred keyword opportunities (record, don't build now):**

- "CPV codes for IT services" / "CPV 72000000 tenders" — high-fit informational
  cluster where Jorpex/TenderRadar/TenderMetric rank with guide pages. Would
  need a `/guides` or blog surface → **out of this cycle** (new public pages
  beyond the fixed list = decision D4, default NO). Log as the first
  post-launch content candidate; it maps perfectly to the honest CPV-scope
  story.
- Vertical pages ("tender alerts for cybersecurity consultancies") — D4, NO
  this cycle.
- Anything tender-notice-specific — permanently out (product scope).

**Explicit honesty note:** BidMorrow's coverage is scoped (CPV 72*/48* +
extras). Keyword targeting must never imply exhaustive EU coverage — e.g. do
not target "all EU tenders", "never miss a tender". The map above complies.

---

## 3. Per-page metadata spec

Rules: title ≤ 60 chars incl. spaces; description ≤ 155; canonical absolute on
`https://bidmorrow.com` (no trailing slash except root); em dash "—" as brand
separator everywhere (fix the hyphen in `index.html`); every marketing page
gets identical OG/Twitter scaffolding with per-page title/description/url and
the shared default OG image. All strings live in the i18n message catalog
(coordinate with internationalization-engineer); metadata is emitted from the
prerender step (§7) so it exists in raw HTML.

Shared OG/Twitter block (values interpolated per page):

```html
<meta property="og:type" content="website" />
<meta property="og:site_name" content="BidMorrow" />
<meta property="og:title" content="{page title}" />
<meta property="og:description" content="{page description}" />
<meta property="og:url" content="{canonical}" />
<meta property="og:image" content="https://bidmorrow.com/og/og-default.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta
  property="og:image:alt"
  content="BidMorrow — Find the tenders worth pursuing. Skip the rest."
/>
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{page title}" />
<meta name="twitter:description" content="{page description}" />
<meta name="twitter:image" content="https://bidmorrow.com/og/og-default.png" />
```

**Share-image spec** (`/og/og-default.png`, self-hosted, in `apps/web/public/og/`):
1200×630 PNG (≤ 300 KB; also export @2x-quality but keep single file), safe
area 1120×550 centered (LinkedIn/WhatsApp crops edges). Content: wordmark
top-left, headline "Find the tenders worth pursuing. Skip the rest." set large
(≥ 56 px equivalent), and the score-breakdown card motif (the hero artifact —
84.5/100 worked example) as the visual, on the Mac Modern light ground. No
fake UI content — use the canonical fixture numbers from docs/matching-engine.md.
Static designed asset per redesign plan §4c. Per-page OG images: not V1;
revisit post-launch (a Methodology-specific card is the first candidate).

### Page-by-page

**`/` Home** — canonical `https://bidmorrow.com/`

- Title (50): `BidMorrow — Bid/No-Bid Intelligence for EU Tenders`
- Description (147): `BidMorrow scores TED procurement notices 0–100 against your company profile — deterministic, explained point by point. Built for IT consultancies.`

**`/how-it-works`** — canonical `https://bidmorrow.com/how-it-works`

- Title (54): `How BidMorrow Works — TED Notices to a Scored Shortlist` _(55 with em dash spacing; verify ≤60 at implementation)_
- Description (150): `From daily TED ingestion to a scored shortlist: profile setup, scoped CPV coverage, deterministic 0–100 scoring, and one daily digest email. Step by step.`

**`/methodology`** — canonical `https://bidmorrow.com/methodology`

- Title (57): `Tender Scoring Methodology, Published in Full — BidMorrow`
- Description (155): `Exactly how BidMorrow scores tenders: eight components to 100 points, a documented missing-data policy, five hard-exclusion rules, and evidence-quoting risk flags.` _(trim to ≤155 at implementation: drop "evidence-quoting" if over)_

**`/pricing`** — canonical `https://bidmorrow.com/pricing`

- Title (43): `Pricing — €29 or €49/Month Flat — BidMorrow`
- Description (144): `Two monthly plans, prices on the page: €29 founding (first 50 customers) and €49 standard. No annual contracts, no usage fees, no demo gate.`
- Note: this is metadata, not page copy — it restates frozen pricing substance
  verbatim and changes no claims. **Owner/product sign-off required anyway**
  since it touches the pricing surface.

**`/pilot`** — canonical `https://bidmorrow.com/pilot`

- Title (47): `Founding Pilot — First 20 Customers — BidMorrow`
- Description (139): `Join BidMorrow's founding pilot: €29/month locked in for the life of your subscription, and a direct line to the team building the product.`

**`/contact`** — canonical `https://bidmorrow.com/contact`

- Title (19): `Contact — BidMorrow`
- Description (103): `Support, billing, privacy, and general questions — email support@bidmorrow.com. Email-only by design.`

**`/privacy`** — canonical `https://bidmorrow.com/privacy`

- Title (19): `Privacy — BidMorrow`
- Description (139): `What BidMorrow collects and what it deliberately doesn't: no third-party analytics, no session replay, no data sales. Full legal text pending.`

**`/terms`** — canonical `https://bidmorrow.com/terms`

- Title (17): `Terms — BidMorrow`
- Description (145): `BidMorrow terms summary: decision support only, scoped TED coverage, monthly billing via Paddle (Merchant of Record), cancel any time. Full legal text pending.`

**Auth pages (`/login`, `/signup`, `/verify-email`, `/forgot-password`,
`/reset-password`)** — keep existing `AuthLayout` titles; add
`<meta name="robots" content="noindex" />` to `AuthLayout`; no OG, no
canonical, no description needed. Exception consideration: `/signup` could be
indexable later; default noindex for V1 (thin form page).

**App/admin shells + NotFound** — `<meta name="robots" content="noindex" />`
rendered by `AppShell`, `AdminGate` (careful: NotFound is also the admin cloak
page — noindex there is correct and preserves the cloak), and add missing
`<title>` for Feed ("Your feed — BidMorrow") and Onboarding
("Set up your profile — BidMorrow").

---

## 4. Messaging architecture + conversion copy deck

Message hierarchy (unchanged from the approved plan §3, restated as the
authority for all copy): 1) scoped relevance ("skip the rest"), 2) explainable
0–100 score, 3) deterministic/LLM-free (factual), 4) digest
only-when-meaningful, 5) honest coverage, 6) EUR flat pricing + real founding
cap, 7) TED attribution (mandatory), 8) no lock-in.

Voice: calm, precise, evidence-first. The site's testimonial substitute is
**showing work**: the score breakdown, the published methodology, the
falsifiable coverage statement. Never superlatives, never urgency theater.

Locked-constant policy: `HEADLINE`, `TED_ATTRIBUTION`,
`DECISION_SUPPORT_DISCLAIMER`, `SCOPED_COVERAGE_STATEMENT`,
`CPV_PREFILTER_DISCLOSURE`, `UNKNOWN_POLICY_STATEMENT`,
`HARD_EXCLUSIONS_STATEMENT`, `RISK_FLAG_STATEMENT` stay **verbatim**. One
proposed change to a locked constant: `SUBHEADLINE` (below) — permitted under
decision D3 (default YES, non-pricing), requires updating
`apps/web/src/app.test.ts` in the same PR (the `startsWith(PRODUCT_NAME)` and
"bid/no-bid qualification intelligence" / quoted-question assertions are
preserved by the proposed text).

### Home (revised copy proposal)

- H1: `Find the tenders worth pursuing. Skip the rest.` (locked, verbatim)
- Proposed SUBHEADLINE (locked-constant revision, test-compatible):
  `BidMorrow is bid/no-bid qualification intelligence for EU public procurement. Deterministic relevance scoring on every TED competition notice in scope, matched to your company profile — answering one question: "Should a company like mine spend time investigating this tender?"`
- Persona line (new, under hero): `Built for 5–50-person IT, cloud, software and cybersecurity consultancies that bid without a dedicated bid team.`
- Primary CTA: `Join the founding pilot` → `/pilot` · Secondary CTA: `See how scoring works` → `/methodology`
- Hero artifact: the real rendered ScoreBreakdownTable (84.5/100 fixture) — the artifact is the pitch; no screenshot carousel, no logo wall.
- Section "The problem" (the enemy): `TED publishes 3,000+ notices every working day. Your problem isn't finding tenders — it's saying no fast.` Supporting line: `Most alert services maximize volume. BidMorrow ranks a scoped feed so the first thing you read each day is the tender most worth your time.` (TED volume claim is about TED, sourced — keep the source link in a footnote.)
- Section "How it works" teaser: 3 steps (profile → daily scoped ingestion → scored shortlist + one digest), each linking to `/how-it-works`.
- Section "Honest coverage" callout: `SCOPED_COVERAGE_STATEMENT` verbatim, framed with heading `Scoped on purpose` and one intro line: `We'd rather tell you exactly what we cover than imply we cover everything.`
- Section "No black box": `Every score explains itself. Eight components, published weights, a documented policy for missing data — and no LLM anywhere in the scoring path. Same inputs, same engine version, same score. Read the full methodology.` → `/methodology`
- Trust checklist (anti-fine-print): `Prices on the page · Monthly billing, cancel any time · No demo call required · No third-party trackers or cookies · Source: TED, the EU's official journal`
- FAQ accordion (native `<details>`, real answers only — also the FAQPage JSON-LD source, §6):
  1. `Does BidMorrow cover all EU tenders?` → No — scoped-coverage answer (reuse the statement's substance, link Methodology).
  2. `Is this AI?` → `No. The scoring engine is deterministic and LLM-free — every point is traceable to a rule you can read on our methodology page.`
  3. `What happens if a data point is missing from a notice?` → Unknown-policy summary.
  4. `Can I cancel any time?` → `Yes — monthly billing via Paddle, cancel from settings, no annual contract.`
  5. `What does the founding pilot involve?` → honest first-20 answer, link `/pilot`.
- Footer (site-wide): `TED_ATTRIBUTION` + `DECISION_SUPPORT_DISCLAIMER` verbatim.

### How it works (revised)

Keep the 5 existing steps and their honest content; per redesign plan add a
visual per step and a closing CTA block (currently dead-ends):

- Closing block: H2 `See it score a real notice` — copy: `The methodology page walks through a real worked example — every component, every point.` CTAs: `Read the methodology` (secondary) + `Join the founding pilot` (primary).
- Step-3 copy stays as-is (already states deterministic/no-LLM correctly).

### Methodology (promote from compliance doc to trust asset)

- Add intro paragraph before the disclaimer: `This page is the product. Every scoring rule BidMorrow applies is documented here — the same inputs at the same engine version always produce the same score. If a claim on this page ever stops being true, that's a bug.`
- Keep all eight locked statements verbatim in current order.
- Add the full annotated worked example (84.5/100 fixture) after the components table.
- Closing CTA: `If you'd rather see this on your own profile:` → `/pilot`.

### Pricing — **FROZEN.** No copy changes of any kind this cycle (owner

directive). Visual restyle only. The §3 metadata is additive head markup, not
page copy; flag it for explicit owner sign-off.

### Pilot (revised, truthful-singular framing per plan §7)

- Keep structure; change `direct access to the team building BidMorrow` →
  `a direct line to the person building BidMorrow` only if the owner opts into
  the solo framing (decision D8 pending; the current "team" wording overstates
  — flag to owner as a truth-rule tension: sole trader per docs. Recommended:
  neutral `direct line to the builder` if D8 stays NO).
- Add one honest scarcity line, wired to reality, not a fake counter:
  `The founding plan closes at 50 customers. We don't show a live countdown —
when it's full, this page will say so.` (No fake urgency; complies with the
  no-unwired-counters guardrail; D6 live counter stays NO.)

### Contact / Privacy / Terms

Content unchanged (Privacy/Terms explicitly frozen pending legal text).
Contact may add one expectation line **only if the owner commits**:
`We aim to reply within two business days.` — otherwise ship as-is.

### Auth pages

No marketing copy. Add noindex (§3).

---

## 5. robots.txt + XML sitemap spec

Both are static files in `apps/web/public/` (Vite copies verbatim into
`dist/`, served by Workers Static Assets — no worker code needed).

**`apps/web/public/robots.txt`:**

```
User-agent: *
Disallow: /app
Disallow: /admin
Disallow: /onboarding
Disallow: /api

Sitemap: https://bidmorrow.com/sitemap.xml
```

Notes: auth pages are deliberately **not** disallowed — their `noindex` meta
must remain crawlable to be honored. `/app`·`/admin`·`/onboarding` get both
Disallow (crawl-budget hygiene) and shell-level noindex; the residual
"URL-only listing" risk is acceptable for a shell with no unique content.
No crawler-specific rules, no `Crawl-delay` (ignored by Google). Do not add
AI-crawler blocks without an owner decision (out of SEO scope).

**`apps/web/public/sitemap.xml`** — 8 URLs, no `priority`/`changefreq`
(ignored by Google; noise):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://bidmorrow.com/</loc><lastmod>YYYY-MM-DD</lastmod></url>
  <url><loc>https://bidmorrow.com/how-it-works</loc><lastmod>YYYY-MM-DD</lastmod></url>
  <url><loc>https://bidmorrow.com/methodology</loc><lastmod>YYYY-MM-DD</lastmod></url>
  <url><loc>https://bidmorrow.com/pricing</loc><lastmod>YYYY-MM-DD</lastmod></url>
  <url><loc>https://bidmorrow.com/pilot</loc><lastmod>YYYY-MM-DD</lastmod></url>
  <url><loc>https://bidmorrow.com/contact</loc><lastmod>YYYY-MM-DD</lastmod></url>
  <url><loc>https://bidmorrow.com/privacy</loc><lastmod>YYYY-MM-DD</lastmod></url>
  <url><loc>https://bidmorrow.com/terms</loc><lastmod>YYYY-MM-DD</lastmod></url>
</urlset>
```

`lastmod` should be real (per-page content change date, e.g. stamped by the
prerender script from git history), or omitted entirely — never a fake
always-today value. Localized sitemaps/hreflang: only at second-locale
activation (requirements.md). Submit to Google Search Console **and** Bing
Webmaster Tools at launch (both free, no scripts).

---

## 6. JSON-LD plan + CSP-compatible delivery mechanism

### Mechanism decision: inline `<script type="application/ld+json">` data blocks, emitted into prerendered static HTML at build time. No CSP change required.

Justification (this was verified this session, not recalled from memory):
CSP `script-src` governs **script execution**. A `<script>` element whose
`type` is not a JavaScript/module/importmap type is an HTML _data block_ — in
the HTML spec's "prepare a script element" algorithm, processing returns
before the CSP inline check is ever reached, so the block is not executed,
not blocked, and produces **no console violation** in browsers. This is the
documented standard technique for shipping inline JSON under a strict CSP
(see Mathias Bynens, "Hiding JSON-formatted data in the DOM with CSP
enabled", and content-security-policy.com's script-src guide). Crawlers parse
JSON-LD from raw markup and ignore CSP entirely. Therefore:

- **No `unsafe-inline`, no hashes, no CSP edits** — `_headers`, Hono
  `secureHeaders`, and the byte-exact `tests/security/static-asset-headers.test.ts`
  all stay untouched. This is the decisive advantage.
- Rejected — hash-source (`'sha256-…'` in script-src): works but is
  strictly worse here: every JSON-LD content change forces regenerating
  hashes in `_headers` + the Worker policy + the byte-exact security test;
  three-way drift risk for zero benefit, since hashes are only needed for
  _executable_ inline script, which JSON-LD is not.
- Rejected — external file via `<script src="/schema.json" type="application/ld+json">`:
  search engines do not fetch externally referenced structured data; JSON-LD
  must be inline (or DOM-injected) to be read.
- Rejected — runtime DOM injection from the bundle: CSP-legal
  (`script-src 'self'`) and Google-supported, but reintroduces the
  render-dependency problem T1 for non-Google parsers and validators reading
  raw HTML. Build-time static emission is strictly better once §7 prerendering
  exists.

Implementation rules: generate the JSON at build time in the prerender step
from a single typed module (`apps/web/src/seo/jsonld.ts`) that imports
`copy.ts` constants — so markup can never drift from visible copy;
`JSON.stringify` then escape `<` as `<` (prevents `</script>` breakout —
standard hardening; procurement strings never appear here in V1, but the
escaper is mandatory anyway).

### Schemas (V1 — only claims that are true and visible on-page)

**Sitewide (on `/`, referenced by `@id` elsewhere):**

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://bidmorrow.com/#organization",
      "name": "BidMorrow",
      "url": "https://bidmorrow.com/",
      "logo": "https://bidmorrow.com/brand/logo.png",
      "contactPoint": [
        {
          "@type": "ContactPoint",
          "contactType": "customer support",
          "email": "support@bidmorrow.com"
        }
      ]
    },
    {
      "@type": "WebSite",
      "@id": "https://bidmorrow.com/#website",
      "url": "https://bidmorrow.com/",
      "name": "BidMorrow",
      "publisher": { "@id": "https://bidmorrow.com/#organization" }
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://bidmorrow.com/#app",
      "name": "BidMorrow",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Web",
      "url": "https://bidmorrow.com/",
      "description": "Bid/no-bid qualification intelligence for EU public procurement. Deterministic 0–100 relevance scoring of TED competition notices within a documented CPV scope.",
      "offers": [
        {
          "@type": "Offer",
          "name": "Founding plan",
          "price": "29",
          "priceCurrency": "EUR",
          "url": "https://bidmorrow.com/pricing"
        },
        {
          "@type": "Offer",
          "name": "Standard plan",
          "price": "49",
          "priceCurrency": "EUR",
          "url": "https://bidmorrow.com/pricing"
        }
      ]
    }
  ]
}
```

Constraints honored: **no `aggregateRating`, no `review`** (zero customers —
truth rules; note this means no software-app rich result stars, which is
correct and expected), no postal address (owner decision: email-only), no
founder/person claims, no `sameAs` until real profiles exist. Offers restate
frozen pricing verbatim — flag for owner sign-off like the pricing meta.

**Per-page additions:**

- `/pricing`: none beyond referencing the sitewide graph (offers already
  carry the pricing; avoid duplicating Product/Offer markup).
- `/` FAQPage: only if the M3 FAQ accordions ship, containing **exactly** the
  visible Q&A text. Set expectations honestly: since 2023 Google restricts
  FAQ rich results to authoritative gov/health sites, so this earns no SERP
  feature — it remains valid, harmless, machine-readable context. Low priority.
- Subpages: `BreadcrumbList` (2 levels, e.g. Home → Methodology). Google's
  guidance is that breadcrumb markup should represent on-page breadcrumbs; the
  marketing IA is flat (depth 1), so ship BreadcrumbList **only if** visible
  breadcrumbs ship (§8 recommends against visible breadcrumbs). Default:
  omit; keep the spec on file. Not a loss — for a flat 8-page site Google
  derives the URL trail anyway.

### Validation plan (required before M3 sign-off)

1. Raw-markup check: `curl` each prerendered route; assert exactly one
   `application/ld+json` block, `JSON.parse`-able, expected `@type`s
   (automatable as a vitest/Playwright assertion in the marketing spec).
2. CSP execution check: load each page on staging (real `_headers` policy) in
   Chromium + Firefox via Playwright; assert **zero console errors and zero
   `securitypolicyviolation` events** (add a listener in the spec). This is
   the "validate the mechanism actually parses" gate; if any engine ever
   reports a violation (not expected per spec behavior), fallback = hash-source
   with a build step that writes all three policy locations — documented, not
   implemented, unless triggered.
3. Google Rich Results Test + Schema.org validator on the 3 distinct page
   shapes (Home graph, pricing, one subpage) — manual, screenshot into the PR.
4. Search Console structured-data reports monitored post-launch (§10).

---

## 7. Indexability strategy for the SPA — prerender public routes at build time

**Recommendation: build-time static generation (SSG) of the 8 public marketing
routes with full body HTML + per-route head, using React's own static
prerender API, emitted as `dist/{route}/index.html`; client hydrates.**
Concretely:

1. Post-`vite build` Node script (or Vite plugin closing over the same code):
   for each public route, render `<MarketingLayout><Page/></MarketingLayout>`
   inside react-router's static router context, via **`prerender` from
   `react-dom/static`** (React 19's SSG API — it resolves suspense and hoists
   `<title>/<meta>/<link>` into `<head>`, which is exactly the metadata
   mechanism the pages already use). Inject the result plus the §3 OG block
   and §6 JSON-LD into the `index.html` template; write
   `dist/pricing/index.html`, `dist/methodology/index.html`, etc.
   **API surfaces must be verified with the `verify-current-docs` skill
   before implementation** (`react-dom/static` `prerender`, react-router 7
   `StaticRouter`/static handler exports, Workers Static Assets
   `html_handling`) — per project hard rule, do not implement from this
   report's memory of the APIs.
2. Serving: Workers Static Assets' default `html_handling`
   (auto-trailing-slash) serves `/pricing` from `dist/pricing/index.html`;
   `not_found_handling: "single-page-application"` stays, so `/app/*` client
   routes keep working. Verify both behaviors on staging with `curl -i`.
3. Client entry: switch `createRoot` → `hydrateRoot` when `#root` has
   children (marketing routes), falling back to `createRoot` for the SPA
   shell. Guard against hydration mismatch (marketing pages are pure static
   content — low risk; the interactive scoring demo must render
   deterministically or mount post-hydration).
4. The static `index.html` (SPA fallback for app routes) gets
   `<meta name="robots" content="noindex">` REMOVED from consideration —
   instead keep its generic title but rely on route-level noindex (T7);
   alternatively keep fallback shell metadata minimal. NotFound view renders
   `noindex`. Stretch goal (optional, later): move unknown-path handling into
   the Worker to return real 404 status for non-app, non-asset paths —
   resolves T2 fully; not required for V1 if NotFound is noindexed.

**Why this approach over alternatives:**

- _react-router 7 framework-mode `prerender` config_: purpose-built, but
  requires migrating from `BrowserRouter` library mode to framework mode —
  routing-architecture churn across the whole app for 8 static pages.
  Rejected this cycle.
- _Headless-browser prerender plugins (puppeteer-based)_: heavy dev
  dependency, slow/flaky CI, violates the "simple explicit code" rule.
  Rejected.
- _Head-only variant generation_ (per-route `index.html` with correct head
  but empty body): acceptable **fallback milestone** if full SSG hits
  hydration trouble — it already fixes T1's metadata/social/canonical harm
  (link previews, per-route titles) with trivial code; body content would
  remain Google-render-dependent. Ship this first if M-timeline pressure
  demands, then upgrade.
- _SSR at runtime_: out — no server rendering infrastructure, cost and
  complexity rules.

Cost/complexity: zero runtime dependencies, zero new services, build-time
only — consistent with the <$100/month constraint and CSP (static HTML).

---

## 8. Internal linking + breadcrumbs

Link graph (marketing pages, each link with descriptive anchor text — no
"click here"):

- Global nav (all pages): Home · How it works · Methodology · Pricing ·
  Founding pilot (CTA-styled) — `aria-current` per redesign a11y plan.
- Global footer (all pages): Methodology · Pricing · Pilot · Contact ·
  Privacy · Terms + `TED_ATTRIBUTION` + `DECISION_SUPPORT_DISCLAIMER`.
- Home body → `/methodology` (from "No black box" + hero secondary CTA),
  `/how-it-works` (teaser), `/pilot` (primary CTA, ×2), `/pricing` (pricing
  teaser).
- How-it-works → `/methodology` (exists, keep) + new closing CTA →
  `/pilot` and `/methodology` (fixes the dead end).
- Methodology → `/how-it-works` (context link in intro) + closing CTA →
  `/pilot`.
- Pilot → `/signup` (exists) + `/pricing` (one contextual link: "see full
  pricing").
- Pricing → already links `/how-it-works`, `/methodology`, `/pilot`,
  `/signup` — **frozen, leave untouched**.
- Contact/Privacy/Terms → `/methodology` links exist in Terms/Privacy; keep.

Rule: every marketing page reachable within one click of Home and links back
to at least one conversion page (`/pilot` or `/signup`).

**Breadcrumbs: recommend NO visible breadcrumb UI.** The public IA is flat
(depth 1, 8 pages); breadcrumbs would be pure chrome ("Home > Pricing")
adding noise to the Mac Modern minimalism with zero navigation value.
Consequently omit BreadcrumbList JSON-LD too (markup should mirror visible
UI — §6). Revisit both only if a `/guides/*` content section (post-launch,
D4-adjacent) introduces real depth — that is when breadcrumbs start paying
rent.

---

## 9. Analytics & conversion measurement (no third-party scripts — CSP-enforced)

Constraints: `script-src 'self'`, "no session replay / third-party analytics;
minimal first-party events only" (product scope), D7 first-party page-view
counter = default NO this cycle. Within that:

1. **Server-side conversion funnel from data that already exists** (zero new
   code paths, zero client beacons):
   - Signup started/completed — auth tables.
   - Email verified — auth tables.
   - Onboarding completed / preset chosen — org profile rows (+ timestamps).
   - Checkout started/completed, plan chosen — Paddle (source of truth;
     the Paddle dashboard gives conversion, MRR, churn without any site script).
   - Activation: first save/ignore action; digest opens are NOT trackable
     (no pixel — consistent with the privacy stance; use digest-driven
     logins as the proxy if needed later).
     Define the funnel report as an admin-surface query (read-only, existing
     admin area) rather than any analytics product:
     `visits→?` is unknowable without page-views — accept that; the funnel
     starts at signup.
2. **Edge-level traffic without scripts**: Cloudflare zone analytics (server
   side, aggregate, no beacon) gives request/visit counts per path for the
   marketing site at no cost and no CSP impact. Note: Cloudflare _Web
   Analytics_ (the beacon flavor) would inject a third-party script —
   **do not enable it**; zone/HTTP-traffic analytics only.
3. **Search Console + Bing Webmaster Tools** as the SEO measurement layer:
   impressions, clicks, queries, page-level CTR, index coverage, structured
   data errors. DNS-record site verification (no HTML tag needed, no script).
4. **Campaign attribution without client JS**: keep it honest and minimal —
   distinct landing paths per channel where it matters (e.g. `/pilot` as the
   link shared in outreach) rather than UTM+JS capture. If the owner later
   wants UTM persistence into signup, that's a D7-class decision — server can
   read the query string on the signup POST referer; defer.
5. **Never**: GA/GTM/Plausible-cloud/Hotjar or any third-party origin;
   fingerprinting; cookie banners are unnecessary because nothing requiring
   consent runs — and "no trackers" is itself homepage messaging (§4).

---

## 10. Measurable acceptance criteria

Technical (automatable — add to marketing Playwright/vitest specs + CI):

1. `curl -s https://<staging>/{route}` for all 8 public routes returns
   HTTP 200 with: exactly one `<title>` matching §3 (≤ 60 chars), exactly one
   meta description matching §3 (≤ 155 chars), correct absolute canonical,
   full OG/Twitter block, and page `<h1>` present **in raw HTML (no JS)**.
2. `/robots.txt` and `/sitemap.xml` return 200, `text/plain`/`application/xml`
   (or `text/xml`), match spec §5; sitemap URL count = 8 and every URL
   returns 200.
3. Every `/login|/signup|/verify-email|/forgot-password|/reset-password`
   response (post-render) contains `noindex`; `/app`, `/admin`, `/onboarding`
   shells render `noindex`; NotFound renders `noindex`.
4. JSON-LD: each prerendered route contains exactly one parseable
   `application/ld+json` block with expected `@type`s; Playwright asserts
   zero console errors and zero `securitypolicyviolation` events on staging
   under the byte-exact production CSP; Rich Results Test passes for Home
   (screenshot in PR).
5. `tests/security/static-asset-headers.test.ts` still passes byte-identical
   (proof the JSON-LD mechanism required no CSP change).
6. Favicon set + `theme-color` present; `/og/og-default.png` returns 200,
   1200×630, ≤ 300 KB; manual share-preview check (LinkedIn Post Inspector or
   equivalent) renders title/description/image for `/`, `/pricing`,
   `/methodology` (screenshots in PR).
7. Lighthouse (or equivalent) SEO category = 100 on all 8 pages; performance
   budgets per redesign plan (marketing JS entry ≤ 150 KB) verified from
   build output — LCP element remains text/HTML.
8. Copy gates: `pnpm test` green with copy-lock tests updated in the same PR
   as any constant change; pricing-page copy assertions **untouched and
   green**; every new claim traceable to a doc (product agent sign-off).

Post-launch (Search Console, first 60/90 days — realistic for a new domain):

9. All 8 URLs "Indexed" in GSC within 30 days of sitemap submission; zero
   soft-404 or duplicate-canonical warnings on marketing URLs.
10. Zero structured-data errors in GSC enhancement reports.
11. Brand query "bidmorrow" returns the site at #1 within 30 days.
12. ≥ 1 non-brand query cluster (methodology/bid-no-bid/tender-scoring terms)
    generating impressions in GSC by day 90 — measured as trend, not a
    traffic promise (no invented traffic targets; a new domain earns
    long-tail impressions before clicks).
13. Funnel report (signup→verified→onboarded→subscribed) queryable from
    existing data; baseline recorded in the ledger at launch.

---

## Implementation sequencing note (fits existing milestones)

- **M0**: robots.txt, sitemap.xml, favicon/theme-color, OG image asset,
  §3 metadata into pages, noindex on auth/app shells, `<title>` for
  Feed/Onboarding, fix `index.html` title/description duplication (T6/T8).
- **M3**: revised copy deck (§4) + locked-test updates; FAQ accordions
  (+FAQPage JSON-LD); prerender pipeline (§7) + JSON-LD emission (§6) +
  validation gates (§10 items 1–5). Prerendering can land earlier if M0 has
  room — it multiplies the value of everything else.
- **Post-launch backlog (recorded, not scoped)**: CPV/IT-services guide
  cluster (D4-adjacent, owner decision), per-page OG images, Worker-level
  true-404, named-competitor content (D11, owner-gated).

Key sources consulted this session (live SERPs): tendermetric.com, jorpex.com,
tenderradar.io, tenqual.com, stotles.com, openopps.com, tedmonitor.eu
(competitive keyword landscape); mathiasbynens.be/notes/json-dom-csp and
content-security-policy.com/script-src (CSP data-block behavior).
