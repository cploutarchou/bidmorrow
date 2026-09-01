# BidMorrow i18n Architecture — Readiness Plan (English-only launch)

Author: internationalization-engineer agent · Date: 2026-08-17
Status: PROPOSAL for the website-redesign workflow (Stage: i18n readiness)

Scope basis (measured in-repo, 2026-08-17):

- `apps/web/src/pages/` — 30 page components, ~5,570 lines total. Largest
  extraction surfaces: `app/Onboarding.tsx` (925), `app/Settings.tsx` (823),
  `admin/Ingestion.tsx` (476), `app/Feed.tsx` (307), `app/TenderDetail.tsx`
  (292). 11 admin pages (~2,100 lines) are internal-only (scope decision
  below).
- `apps/web/src/copy.ts` — 9 exported marketing/compliance constants, locked
  verbatim/`toContain` by `apps/web/src/app.test.ts`.
- `apps/web/src/lib/format.ts` — display-label maps (classification, risk
  confidence, component status) and `Intl`-based value/date helpers; several
  English-composed strings (`Deadline in ${days} days`).
- `apps/web/src/components/` — 6 shared components with nav labels,
  aria-labels. ~41 `aria-label`/`<title>`/`placeholder` sites across the SPA.
- `packages/notifications/src/auth-mail.ts` and `digest-renderer.ts` — all
  email subjects/bodies hardcoded English, including a manual English plural
  (`match${totalCount === 1 ? '' : 'es'}`) and duplicated label maps
  (`CLASSIFICATION_LABEL`, `RISK_CONFIDENCE_LABEL` mirror `lib/format.ts`).

Rough total: ~600–900 user-facing strings including admin; ~450–650 excluding
admin.

No i18n library is currently installed in `apps/web` or `apps/worker`.

---

## 1. Library recommendation

### Recommendation: **i18next 26.x + react-i18next 17.x** (verify exact pins

via `verify-current-docs` at install; latest on npm 2026-08-17: i18next
26.3.6, react-i18next 17.0.11 — checked live against registry.npmjs.org).

### Evaluation matrix

| Criterion                       | i18next 26 + react-i18next 17                                                                                                                                                                                                           | Lingui 6.6                                                                                                                                                                                         | react-intl 10.1 (FormatJS)                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| React 19 compat                 | Yes — peer `react >= 16.8`, uses `use-sync-external-store`; no legacy context                                                                                                                                                           | Yes — peer includes `^19.0.0`                                                                                                                                                                      | Yes — peer `react >= 18`                                                                                                                |
| TS-strict typed messages        | **Strong**: module augmentation (`CustomTypeOptions`) types every key + interpolation vars from the `en` catalog at compile time; peer `typescript ^5\|\|^6\|\|^7` matches our 5.9 pin                                                  | Inherent (messages are inline source English via macros), but ids are compile-generated; typing of dynamic ids weaker                                                                              | Weakest by default — ids are strings; typing requires extra codegen/ESLint tooling                                                      |
| Bundle (en-only SPA)            | ~15 kB gz (i18next) + ~7 kB gz (react-i18next); no ICU parser needed at runtime                                                                                                                                                         | **Smallest** (~3–8 kB gz runtime; catalogs precompiled)                                                                                                                                            | Largest: `react-intl` + `@formatjs/intl` + `intl-messageformat` + ICU parser, runtime ICU parsing unless AST-precompiled (~50–60 kB gz) |
| ICU / plurals                   | Plurals natively via `Intl.PluralRules` (CLDR categories, `key_one`/`key_other`); built-in `Intl` formatting in interpolation. Full ICU syntax available later via `i18next-icu` 2.4.x + `intl-messageformat` if translators require it | Native ICU, compiled at build time                                                                                                                                                                 | Native ICU (its raison d'être)                                                                                                          |
| Non-React usage (worker emails) | **Excellent** — `i18next` core is dependency-free plain JS; `createInstance()` runs unmodified in workerd/Hono                                                                                                                          | `@lingui/core` works, BUT inline-macro messages require the Babel macro transform in the **wrangler/esbuild** pipeline too, or a second non-macro authoring style for worker code                  | `@formatjs/intl` (imperative API) works in workers                                                                                      |
| Build/CSP coupling              | None — plain TS/JSON catalogs bundled by Vite/esbuild; zero runtime injection; fully `script-src 'self'` compatible                                                                                                                     | Requires `@lingui/vite-plugin` + `@babel/core` + macro plugin in the Vite pipeline (verified: peer `vite ^6.3\|\|^7\|\|^8`), plus extract/compile CLI steps; worker build needs the same treatment | None at runtime; extraction/compile CLI optional. CSP-fine                                                                              |
| Maintenance                     | Very active (26.x line current, largest i18n ecosystem in JS)                                                                                                                                                                           | Active (6.6.0 current)                                                                                                                                                                             | Active (FormatJS monorepo, 10.x current)                                                                                                |
| License                         | MIT                                                                                                                                                                                                                                     | MIT                                                                                                                                                                                                | BSD-3-Clause (fine)                                                                                                                     |

### Why i18next wins for THIS stack

1. **One runtime, two composition roots.** The same `packages/i18n` package
   (catalogs + factory) is imported by both the React SPA and the Hono
   worker with zero build-tool ceremony. Lingui's best DX (macros) needs a
   Babel transform in _both_ the Vite and the wrangler/esbuild pipelines —
   exactly the kind of build magic BidMorrow's "simple explicit code" rule
   avoids, and a moving part in the CSP-triple-enforced asset pipeline.
2. **Strict-TS key safety is first-class.** `CustomTypeOptions` typed
   resources make every `t('marketing.home.headline')` a compile-time-checked
   key with typed interpolation variables — this directly satisfies "typed
   access" without codegen.
3. **CSP is trivially satisfied** — no runtime script/style injection, no
   CDN; catalogs are statically imported modules in the `'self'` bundle.
4. **en-only cost is bounded**: ~22 kB gz total, no ICU parser shipped at
   launch. Lingui would be smaller, but the delta (~15 kB) does not justify
   the dual-pipeline Babel coupling; react-intl would be ~2.5× heavier and
   is the weakest on typing.

Tradeoffs accepted: i18next's native message syntax is `{{var}}` +
plural-suffixed keys, not full ICU. `Intl.PluralRules` drives plural
selection (CLDR-correct for every locale), and `Intl` drives all
date/number/currency formatting, which satisfies the "Intl/ICU" architecture
rule. If a future translation vendor mandates ICU source syntax, `i18next-icu`
(2.4.4, peer `intl-messageformat >=10.3.3 <12`) can be added per-locale later
without re-architecting. Also considered: Paraglide/inlang (fully
tree-shaken typed message functions) — rejected on maturity/ecosystem risk
for a production SaaS.

**verify-current-docs before install (mandatory):** i18next v26
`CustomTypeOptions` shape (the typed-resources API has shifted across
majors; v26 is newer than assistant memory), react-i18next v17 React-19
notes, and `i18next.d.ts` augmentation placement with our TS 5.9/moduleRes
settings. Record pins + rationale in `docs/dependency-versions.md`.

---

## 2. Catalog architecture

### New package: `packages/i18n`

Depends on nothing internal (like `domain`); consumed by `apps/web`,
`apps/worker`, and `packages/notifications` (dependency rules: it is a leaf,
so feature packages may depend on it).

```
packages/i18n/
  src/
    locales/
      en/
        common.ts        # product name, nav, generic actions/buttons, empty/error states
        marketing.ts     # home, how-it-works, pricing, pilot, contact
        legal.ts         # compliance-locked: TED attribution, disclaimers,
                         # methodology statements, terms/privacy copy
        auth.ts          # login/signup/forgot/reset/verify
        app.ts           # feed, tender detail, onboarding, settings
        labels.ts        # classification/risk/component-status label maps
                         # (single source for web format.ts AND digest emails)
        validation.ts    # form validation messages
        a11y.ts          # aria-labels, sr-only text, skip links
        meta.ts          # per-route <title>/<meta description>/OG strings
        emails.ts        # digest + auth transactional subjects/bodies/footers
        admin.ts         # (scope decision — see below)
      index.ts           # locale registry (see §7)
    create-i18n.ts       # createInstance factory (no detector, no backend)
    format.ts            # Intl wrappers (see §3)
    i18next.d.ts         # CustomTypeOptions augmentation → typed keys
```

### Namespaces and key style

- Namespaces = the files above. The worker imports **only**
  `emails` + `labels` + `legal` (footer attribution) — bundlers tree-shake
  the rest out of the worker build.
- Keys are nested, structural, stable: `hero.headline`,
  `feed.empty.title`, `digest.subject_zero`. Namespace prefix at call site:
  `t('marketing:hero.headline')` or scoped `useTranslation('marketing')`.
- **Compliance-locked strings live in `legal`** — the 9 `copy.ts` constants
  move here verbatim. This namespace is explicitly marked "changes require
  updating `app.test.ts` in the same PR" (existing rule).

### Typed access

- `en` catalogs are authored as TypeScript `as const` objects → literal
  string types.
- `i18next.d.ts`:
  ```ts
  import type { resources } from './locales/en';
  declare module 'i18next' {
    interface CustomTypeOptions {
      defaultNS: 'common';
      resources: typeof resources; // all namespaces, en shape
    }
  }
  ```
  Every `t()` key and its interpolation variables are compile-checked;
  future locales are typed `satisfies TranslationShape<typeof en.marketing>`
  so a missing/extra key is a `pnpm typecheck` failure, not a runtime hole.

### en-only, tree-shaken build

- `createI18n(locale)` statically imports **only** `en` at launch:
  `supportedLngs: ['en']`, `fallbackLng: 'en'`, `lng: 'en'`, no
  language-detector plugin, no HTTP backend plugin (nothing fetched — CSP-
  and cost-friendly).
- Future locales load via an explicit map of dynamic imports
  (`() => import('./locales/de')`) → Vite emits same-origin lazy chunks
  (CSP `'self'`-compatible). English users never download other locales.
- `<html lang>` (and later `dir`) set from the locale registry in
  `apps/web/index.html` / root component.

### Metadata

React 19 hoists `<title>`/`<meta>` from components (pattern already used in
`Home.tsx`). Add a tiny `<PageMeta route="home" />` component that reads
`meta:home.title`, `meta:home.description`, OG fields, and the canonical URL
from a route→URL map. No hardcoded metadata strings in pages.

### Emails (worker, non-React)

- `packages/notifications` renderers become locale-parameterized pure
  functions: `renderDigest(args, { locale = 'en' })`,
  `buildAuthEmailBody(kind, url, { locale = 'en' })`. Internally they use a
  fixed-locale `TFunction` from `createI18n(locale)` (worker composition
  root creates one instance per active locale — cheap, cacheable, and keeps
  renders pure/deterministic, which the digest resume path requires).
- The duplicated `CLASSIFICATION_LABEL` / `RISK_CONFIDENCE_LABEL` maps in
  `digest-renderer.ts` and `lib/format.ts` collapse into `labels`
  namespace — one source of truth.
- Escaping order unchanged: translate first, then `escapeHtml()` on every
  interpolated untrusted value exactly as today (procurement content is
  never trusted; catalog strings themselves are trusted code).
- At launch every send passes `'en'`; the org-locale preference column is an
  activation-time migration (see §7).

---

## 3. Formatting strategy

All composed values via `Intl`, centralized in `packages/i18n/format.ts`
(the current `apps/web/src/lib/format.ts` helpers migrate there and gain an
explicit `locale` parameter; web re-exports for compatibility):

- **Dates/times**: `Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone })`.
  Digest emails format deadlines with the org's digest timezone (already
  tracked for digest scheduling) instead of today's raw
  `toISOString().slice(0,10)`. The `digestDate` (YYYY-MM-DD) stays ISO
  internally; its _presentation_ goes through Intl.
- **Relative deadlines**: replace `Deadline in ${days} days` with plural
  message keys (`deadline_in_days_one` / `_other`) or
  `Intl.RelativeTimeFormat` — never numeric concatenation.
- **Numbers**: `Intl.NumberFormat(locale)`; score lines stay message-keyed
  (`{{score}} / 100 - {{label}}` as a message, not code-side concatenation).
- **Currency (EUR + original currencies)**: keep the existing correct
  policy — never convert; format the buyer's original currency code via
  `Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 })`
  with the existing try/catch fallback. Pricing page EUR (€29/€49 frozen)
  renders through the same helper.
- **Plurals**: i18next `count`-driven suffixed keys backed by
  `Intl.PluralRules` — fixes the digest subject's hand-rolled
  `match${n===1?'':'es'}`. New locales add their CLDR categories
  (`_few`, `_many`, …) in their own catalogs.
- **Locale policy decision (flagged)**: today `format.ts` passes
  `undefined` (browser regional preference). For coherence between text and
  values, formatting should use the **active UI locale** once i18n is wired
  (`'en'` at launch). This is a small observable change (e.g. a German
  browser today sees `1.234 €`); owner should confirm.
- **Lists**: `Intl.ListFormat` for any comma-joined enumerations.
- Hard rule enforced by review + lint: no template-literal composition of
  translatable sentences, no gender/word-order assumptions, no string `+`
  around translatable fragments.

`Intl` is fully available in both browsers and Cloudflare workerd (full ICU)
— no polyfills, no bundle cost.

---

## 4. RTL readiness and +35% expansion

### RTL rules (enforced from now, cost ≈ zero while LTR-only)

1. **Logical CSS properties only** in `apps/web/src/styles.css` and all
   token CSS produced by the redesign: `margin-inline-start` not
   `margin-left`; `padding-inline`/`padding-block`; `inset-inline-start` not
   `left`; `border-start-start-radius`; `text-align: start|end` never
   `left|right`. Flex/grid are direction-aware by default — prefer them for
   ordering.
2. **Lint gate**: add a `stylelint` rule (or a small grep-based
   `pnpm lint:logical` script in quality gates) that fails CI on physical
   direction properties (`margin-left|right`, `padding-left|right`,
   `left:|right:` positioning, `text-align: left|right`) outside an
   explicitly annotated allowlist (e.g. decorative effects that must not
   flip).
3. **`dir` attribute** comes from the locale registry
   (`{ code, label, dir: 'ltr' | 'rtl' }`) and is set once on `<html>`;
   components never set `dir` themselves except for **bidi-isolated
   untrusted content**: tender titles/buyer names from TED keep their own
   base direction via `dir="auto"` (or `<bdi>`) so an Arabic/Hebrew notice
   title renders correctly inside any UI locale — this applies at launch,
   not just after RTL activation, and also to email templates.
4. **Icon direction policy** (documented in the design system): classify
   every icon at introduction:
   - _Directional-semantic_ (back/forward arrows, chevrons in nav/pagination,
     "next step") → flips under `[dir='rtl']` via `transform: scaleX(-1)`
     applied by a shared `.icon--flip-rtl` class.
   - _Direction-neutral_ (check, clock, alert, search, euro) → never flips.
   - _Real-world-referent_ (logos, media-play per platform convention) →
     never flips.
     No text embedded in SVGs; no directional metaphors in copy ("the panel on
     the left").
5. Animations/transitions expressed in logical terms (translate along
   inline axis via CSS custom property that the RTL block negates).

### +35% expansion rules (German/Finnish headroom; also protects RTL)

- No fixed pixel widths/heights on any text-bearing element: buttons, nav
  items, badges, table headers size to content + padding; use
  `min-inline-size`, never `inline-size` on labels.
- Layouts wrap, they don't clip: nav collapses earlier rather than
  truncating; card grids use `minmax()` tracks; forms put labels above
  inputs (wrap-friendly), never fixed-width label columns.
- Truncation (`text-overflow: ellipsis`) allowed **only** for
  data-driven strings (tender titles) with full text available (title
  attr/tooltip/detail page) — never for catalog UI strings.
- `overflow-wrap: break-word` on constrained containers; badges/pills get
  `white-space: normal` fallback at narrow widths.
- **Verification tool**: a dev-only i18next `postProcess` pseudo-locale
  (`en-XA`-style: accents + ~40% padding + RTL-marker variant), toggleable
  via a Vite dev flag — excluded from production build (keeps CSP/bundle
  clean). The redesign's E2E visual pass runs key pages under pseudo-expansion
  at 360px/768px/1280px and fails on horizontal overflow.

---

## 5. Migration plan from `copy.ts` / hardcoded strings (copy-lock-safe sequencing)

The locks: `apps/web/src/app.test.ts` imports 9 named constants from
`./copy` and asserts exact/`toContain` English values (TED attribution
verbatim, disclaimers, methodology statements). Requirement: copy changes
update tests in the same PR. The migration never orphans that protection.

**Step 0 — foundation (no visible change).** Create `packages/i18n` with
`en` catalogs whose `legal` namespace contains the 9 constants' current
values **character-for-character**. Add unit tests in `packages/i18n`
asserting the same compliance substrings (attribution verbatim, "decision
support", "never an LLM guess", CPV codes) directly against the catalog —
the lock now exists at the source of truth.

**Step 1 — facade inversion (app.test.ts untouched, still green).**
`apps/web/src/copy.ts` becomes a thin re-export facade:

```ts
import { en } from '@bidmorrow/i18n/locales/en';
export const HEADLINE = en.legal.headline;
export const TED_ATTRIBUTION = en.legal.tedAttribution;
// … all 9, same names, same values
```

`app.test.ts` passes unchanged because the exported names and values are
identical. The catalog is now the single source; `copy.ts` is compatibility
glue. (If the redesign changes any copy, the catalog value and the
`app.test.ts` assertion change together in that PR — existing rule,
unchanged mechanics.)

**Step 2 — provider wiring.** `apps/web/src/main.tsx` initializes
`createI18n('en')` synchronously (static en import → no loading state, no
Suspense flash) and wraps the app in `I18nextProvider`. Quality gates green;
zero user-visible change.

**Step 3 — page migration, redesign-aligned.** Key efficiency: the redesign
**rebuilds the marketing pages anyway** — new pages are written catalog-first
(`t()` from day one), so marketing strings are never migrated twice. For
surviving surfaces, migrate in this order, one PR per group, gates green
each time: (a) shared components + `format.ts` labels → `labels`/`a11y`/
`common`; (b) auth pages + `validation`; (c) app pages (Feed, TenderDetail,
Onboarding, Settings) — the two big files (Onboarding 925, Settings 823
lines) each get their own PR; (d) metadata → `meta` + `<PageMeta>`;
(e) admin (only if in scope — decision below).

**Step 4 — emails.** Extract `auth-mail.ts` and `digest-renderer.ts`
strings to `emails` namespace; add the `locale = 'en'` parameter. Existing
notification tests assert current English output — they pass unchanged
(values identical); add one new test per renderer asserting the locale
parameter is honored (using a stub second locale fixture that never ships).
Digest determinism preserved: locale is an explicit input.

**Step 5 — retire the facade (single PR).** When no component imports
`copy.ts` any longer, update `app.test.ts` to import from
`@bidmorrow/i18n` (assertions unchanged), delete `copy.ts`. Alternatively
keep the facade permanently — it costs ~15 lines; deletion is optional
hygiene, `app.test.ts`'s lock semantics survive either way.

**Enforcement so regressions can't creep back:** enable
`eslint-plugin-i18next` (`no-literal-string` on JSX text, `aria-label`,
`placeholder`, `title` attributes) for migrated directories, expanding the
include list as each group lands; runs inside the existing `pnpm lint` gate.

---

## 6. SEO interplay

### Now (en-only launch)

- `<html lang="en">`; every route emits canonical URL + title + description
  via `<PageMeta>` (React 19 head hoisting — already the pattern in
  `Home.tsx`).
- **No hreflang** — hreflang with a single locale is meaningless noise;
  correct posture is canonical-only. No locale prefix in URLs: English
  lives at the root (`bidmorrow.com/pricing`) and keeps accruing link
  equity there permanently.
- Single sitemap listing en URLs; `Content-Language` header not needed
  (lang attribute suffices).
- Language selector is built but hidden (`activeLocales.length > 1` gate).
- Known SPA caveat (unchanged by i18n): metadata is client-rendered; public
  tender-detail SEO pages are out of V1 scope per requirements, and
  marketing prerendering is a separate redesign concern — flagged, not an
  i18n blocker.

### At activation of locale N ≥ 2

- **URL model**: en stays at root; new locales get a path prefix
  (`/de/pricing`) via a react-router locale segment. Path prefixes (not
  domains/subdomains/query params) are the right cost/SEO tradeoff for one
  Workers deployment.
- **hreflang cluster** on every localized page: one `<link rel="alternate"
hreflang="…">` per active locale **plus self-reference plus
  `x-default` → en root**. Emitted from the same locale registry that
  drives the selector, so the cluster can't drift from reality.
- Localized `<title>/<meta>/OG` from that locale's `meta` namespace;
  canonical per language version (each language is canonical to itself —
  translations are not duplicates).
- **Sitemaps**: either per-locale sitemaps under a sitemap index, or
  `xhtml:link` alternates in one sitemap — pick one at activation and
  generate from the locale registry + route map (never hand-maintained).
- **Never auto-redirect** on `Accept-Language` (breaks crawlers and users);
  at most a dismissible "view this page in Deutsch?" banner.
- Serving note: localized routes are the same SPA bundle; static-asset SPA
  fallback already handles arbitrary paths. If marketing prerendering has
  been added by then, it must prerender each locale prefix.

---

## 7. Documented process: adding + activating a language

This becomes `docs/i18n.md` at implementation. Adding locale `xx`:

1. **Owner decision** — market, target date, who translates (human blocker:
   translation vendor/budget go to `HUMAN_DECISION_BLOCKERS.md`; machine
   translation without native review is prohibited for a paid product).
2. **Registry entry** — add `{ code: 'xx', label: '<endonym>', dir, }` to
   `packages/i18n/src/locales/index.ts` with `active: false`. Inactive =
   translatable but invisible: no selector entry, no routes, no hreflang.
3. **Catalog scaffold** — create `locales/xx/*` typed
   `satisfies TranslationShape<typeof en.…>`; `pnpm typecheck` fails until
   every key exists (completeness is compiler-enforced, not runtime-logged).
4. **Translate** — export en source with translator context notes (per-key
   `// context:` comments ship in the catalog files); domain glossary
   (tender, notice, buyer, CPV, framework agreement — procurement terms have
   official per-language EU equivalents; translators must use TED's own
   terminology for that market).
5. **Legal/compliance review** — `legal` namespace (TED attribution,
   disclaimers, terms/privacy) requires legal review in the target language;
   the attribution wording must match the Publications Office's required
   form for that language. Human blocker until signed off.
6. **Native review** — a native speaker reviews in-context (staging with the
   locale force-enabled via query flag), not spreadsheet-only.
7. **Formatting QA** — dates, EUR + original-currency rendering, plural
   categories (add `_few/_many` keys where CLDR requires), list formatting.
8. **RTL QA** (if `dir: 'rtl'`) — full pass with the icon-flip policy and
   logical-properties audit; bidi-isolation of TED content re-verified.
9. **Metadata + SEO** — translate `meta` namespace; add locale routes,
   hreflang cluster, sitemap generation for `xx` (all driven by flipping the
   registry, verified by a unit test that renders the head for each active
   locale).
10. **Emails** — translate `emails` namespace; ship the org-locale
    preference (activation-time D1 migration adding `locale` to the org
    settings, default `'en'`, via `migration-safety` skill); digest +
    auth mail render tests for `xx`.
11. **Activate** — set `active: true`; the language selector appears
    automatically (it renders whenever `activeLocales.length > 1`); en-XX
    users see the optional suggestion banner.
12. **Gates + records** — full quality gates, pseudo-expansion visual pass,
    Playwright smoke in `xx`, bundle-size check (locale chunk is lazy, en
    users unaffected), update `docs/dependency-versions.md` (if any plugin
    added, e.g. `i18next-icu`), `IMPLEMENTATION_LEDGER.md`, and the cost
    model if translation is a recurring vendor cost (`cost-audit` skill).

Deactivation is the reverse: registry `active: false` removes selector,
routes, hreflang, sitemap in one change (plus redirects from dead localized
URLs to en equivalents — document at first deactivation).

---

## 8. Acceptance criteria — "i18n-ready" (Definition of Done for this workstream)

Catalog coverage

- [ ] Zero hardcoded user-facing strings in `apps/web/src` components/pages
      (JSX text, `aria-label`, `placeholder`, `title`, `alt`, validation
      messages, error/empty states) — enforced by `eslint-plugin-i18next`
      in `pnpm lint`, not by review memory.
- [ ] `copy.ts` content sourced from the `legal` catalog namespace;
      `app.test.ts` green with unchanged assertions (or migrated to import
      the catalog directly in the retirement PR).
- [ ] Route metadata (titles/descriptions/OG/canonical) rendered from the
      `meta` namespace via a shared component.
- [ ] Worker emails (digest + auth transactional) fully catalog-driven with
      an explicit `locale` parameter defaulting `'en'`; label maps
      deduplicated between web and notifications into `labels`.
- [ ] Admin surface: catalog-covered OR explicitly recorded as
      English-only-by-decision (see decisions).

Type safety & correctness

- [ ] Every `t()` key compile-checked via `CustomTypeOptions`; a deliberately
      wrong key fails `pnpm typecheck` (verified by a type-level test).
- [ ] Locale catalog shape enforced by `satisfies` — missing key in any
      future locale is a typecheck failure.
- [ ] No template-literal/`+` composition of translatable sentences; no
      hand-rolled plurals (the digest `match/matches` ternary and
      `Deadline in ${days} days` are gone); plurals via `count` keys.
- [ ] All date/number/currency display through the central Intl wrappers
      with an explicit locale parameter.

Layout & RTL

- [ ] No physical direction properties in CSS outside the annotated
      allowlist (lint-enforced).
- [ ] `lang`/`dir` on `<html>` driven by the locale registry; TED-sourced
      strings bidi-isolated (`dir="auto"`/`<bdi>`) in web and email HTML.
- [ ] Icon inventory classified (flip / never-flip); flip class in place.
- [ ] Pseudo-locale (+~35% expansion) pass on all key pages at 360/768/1280
      px with no horizontal overflow or clipped catalog strings; pseudo
      tooling excluded from production bundles.

Launch posture & SEO

- [ ] `en` is the only active locale; selector hidden behind
      `activeLocales.length > 1`; no hreflang emitted; canonical + lang
      correct on every route.
- [ ] Only `en` catalog bytes in the shipped bundle (verified in build
      output); total i18n runtime cost ≤ ~30 kB gz budget; no new CSP
      violations (all assets `'self'`; `tests/security/static-asset-headers.test.ts`
      untouched and green).

Process & records

- [ ] `docs/i18n.md` exists containing §7's activation process verbatim.
- [ ] `docs/dependency-versions.md` records i18next/react-i18next pins,
      rationale, and verify-current-docs date; ledger updated.
- [ ] Full quality gates (`pnpm format:check lint typecheck test build`)
      green; `production-reviewer` sign-off obtained.

---

## Open decisions for the owner / orchestrator

1. **Approve the library choice** (i18next 26.x + react-i18next 17.x) so it
   can be verified via `verify-current-docs` and recorded in
   `docs/dependency-versions.md`.
2. **Admin surface scope**: include the 11 admin pages (~2,100 lines) in the
   catalog now, or record them as permanently English-only internal tooling
   (recommended: English-only-by-decision; saves ~30% of extraction effort).
3. **Value-formatting locale policy**: format numbers/dates with the active
   UI locale (recommended, coherent) vs. today's browser-regional default —
   small observable change for non-en-region browsers.
4. **At activation (defer, but note now)**: org-level email locale field
   (D1 migration) and whether marketing pages get prerendering before locale
   2 ships (affects whether localized metadata is crawler-visible without
   JS execution).
