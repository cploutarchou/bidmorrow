# Website redesign — standing owner requirements and decisions

Authoritative record for the redesign workflow. Update it whenever the
owner decides something; never re-litigate what is recorded here.

## Rejected design directions (2026-08-17 — owner)

The owner reviewed and REJECTED all three initial directions. Do not
implement them or produce minor variations of them; new concepts must be
substantially different.

1. "Ledger" — editorial audit-document: warm paper ground, ink text, deep
   blue accent, hairline rules, mono data blocks.
2. "Control Room" — single-theme dark technical: near-black ground, teal
   accent, grid-line texture, glowing score readouts.
3. "Mac Modern" (rev. 1) — literal macOS treatment: frosted sticky nav,
   macOS window chrome with traffic-light dots, #0071e3 accent.

"Substantially different" means a different concept (hero thesis, layout
model, storytelling device, personality) — not a re-skin of the above.

## Standing decisions

- **Pricing frozen**: €29/€49 flat EUR, plan structure and substance
  unchanged. Presentation may be restyled; content/claims may not change.
- **Onboarding is the top UX priority** for the interface work.
- **Visual character: macOS-INSPIRED** — refined typography, generous
  spacing, layered surfaces, elegant depth, tasteful translucency, soft
  shadows, controlled gradients, polished icons, smooth transitions,
  meaningful micro-interactions, strong product storytelling. Inspiration
  only: never copy Apple's website, layouts, branding, proprietary assets
  (SF Pro cannot be self-hosted), or interface components.
- **Same stack**: approved designs are migrated faithfully into React 19 +
  Vite + react-router + vanilla-CSS tokens. No stack rebuild, no
  disconnected prototype as the deliverable.
- **English-only launch, i18n-ready architecture** (centralized message
  catalogs incl. metadata/validation/a11y labels/emails; mature i18n
  library; locale-aware formatting; RTL-prepared; language selector hidden
  until a second language; hreflang/localized sitemaps only at
  activation; documented activation process).
- **Testimonials/social proof**: only when real customers exist — never
  fabricated. Named competitor comparisons: not without owner approval.
- **Sliders/carousels**: only where they genuinely improve comprehension,
  and only fully accessible (keyboard, touch, screen reader, pause,
  reduced motion).

## Hard technical constraints

- CSP (load-bearing, triple-enforced): `script-src 'self'; style-src
'self'; font-src 'self'` — no unsafe-inline, no CDN assets, no runtime
  CSS-in-JS injection, no third-party scripts/analytics. Enforced in
  `apps/web/public/_headers`, Hono secureHeaders, and byte-exact in
  `tests/security/static-asset-headers.test.ts`. JSON-LD needs an
  explicit CSP-compatible mechanism.
- TypeScript strict; pnpm; modular monolith; no LLM in the production
  request path; fixed infra < $100/month.
- Marketing copy constants in `apps/web/src/copy.ts` are locked by
  `apps/web/src/app.test.ts` — copy changes update tests in the same PR.
- Procurement content is untrusted input — never render as HTML.
- Public tender-detail SEO pages are OUT of V1 scope.

## Content truth rules

No fake testimonials/logos/stats/reviews; no exhaustive-coverage claims;
no "AI-powered" framing (deterministic, LLM-free engine — stating that
truthfully is fine); TED attribution (Commission Decision 2011/833/EU)
and decision-support disclaimer mandatory; founding-cap honesty ("first
20"); honest CPV coverage statement. No keyword stuffing, hidden text,
doorway pages, or manipulative SEO.

## Libraries

New dependencies are allowed when they materially improve design quality,
interaction, accessibility, implementation speed, or reliability. Before
adding one, evaluate: framework compatibility, maintenance/maturity,
security history, accessibility, licensing, bundle-size and runtime
impact, whether the existing stack already covers it, and whether a small
internal implementation is more appropriate. Avoid overlap. Record every
added dependency and its rationale in `docs/dependency-versions.md` and
the shared plan. Verify current API syntax via the `verify-current-docs`
skill — never from memory.

## Approval and pause rules

- Mandatory stop at the Stage 3 approval checkpoint (13-item package).
- After direction approval, implement autonomously; pause only for:
  material design/scope changes, removal or change of existing
  functionality, paid services or restricted assets, credentials/
  production deployment/sensitive data, or serious security, privacy,
  legal, or architectural risks.
- Launch-pipeline note: the phase-13→14 go-live pipeline is ON HOLD until
  this redesign completes; production ingestion stays paused until the
  owner's explicit go.

## Decisions log

- 2026-08-17: Initial three directions rejected (see above); workflow
  restarted at research/creative exploration with this reusable system.
