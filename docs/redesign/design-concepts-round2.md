# Round-2 design concepts (post-rejection) — working briefs

Rejected (never revive): Ledger (paper/ink/hairline audit doc), Control
Room (dark teal terminal), Mac Modern rev.1 (literal macOS chrome,
traffic lights, #0071e3). All three round-2 concepts keep the macOS-
inspired fundamentals (type refinement, generous spacing, layered
surfaces, soft shadows, controlled gradients, tasteful translucency,
micro-interactions) but differ at CONCEPT level.

## E — "Verdict" (the product demo IS the homepage)

Thesis: don't describe qualification — perform it. Hero = a working
sample-data demo: a real-shaped TED notice card slides in, the score
computes live (count-up + staged breakdown bars), verdict lands
(Pursue / Skip). Visitor can flip through 3 sample notices.
Light, luminous, kinetic-precise. Decision-semantic accent: viridian
"pursue" green + neutral slate, amber "review". NOT terminal-dark, NOT
window chrome. Type: Schibsted Grotesk (display, OFL) + Figtree (body,
OFL) + JetBrains Mono (scores, OFL). Translucency: sticky nav only.
Storytelling device: watching a decision happen in 6 seconds.
App/onboarding shown as real UI panels with soft diffuse shadows.

## F — "Daylight" (the Monday-morning briefing)

Thesis: calm is the product. The anti-dashboard, anti-noise argument:
"2,400 notices this week. 14 matched. 3 worth a meeting." rendered as an
animated funnel-reduction sequence — the signature motion. Serene
gallery light: warm-white ground with a dawn-gradient wash (pale gold →
sky), floating window cards with large soft shadows, oversized humanist
display type, enormous whitespace. Accent: deep teal-ink? NO (Control
Room teal) → deep spruce green or slate-indigo; semantic greens kept
separate. Type: Bricolage Grotesque (display, OFL — characterful) +
Public Sans or Figtree (body) + tabular mono for figures. Light-first
with a soft dusk dark twin. Storytelling device: reduction from flood to
focus.

## G — "Strata" (descend through the layers)

Thesis: filtering depth made spatial. Scroll descends through layered
translucent panes — Discover (all of TED) → Qualify (your profile) →
Decide (the shortlist) — depth of field as the metaphor for signal
extraction. Ink-navy night ground (NOT near-black, NOT teal-accented),
warm solar accent (apricot→rose controlled gradient) — a deliberate
cool-ground/warm-accent inversion of the blue/violet category cliché.
Real glass (backdrop-filter) with reduced-transparency fallback.
Dark-first with a full daylight twin. Type: General-purpose grotesque
with wide display cuts — Space Grotesk is overused → use "Sora" or
"Hanken Grotesk" display + body; mono for data. Storytelling device:
z-depth journey; scroll-scenes with reduced-motion static fallback.

## Shared, non-negotiable

Same content architecture across all three (hero, how-it-works, live
score anatomy, onboarding preview, coverage honesty, pricing FROZEN
presentation, FAQ, TED attribution + disclaimer footer); both themes
unless justified; WCAG AA contrast; CSP-safe (no CDN, self-hosted OFL
fonts only, CSS/CSSOM motion, no runtime style injection); responsive
390/768/1440; reduced-motion fallbacks; original iconography (Lucide ISC

- custom SVG); no Apple/Tendify copying; no fake proof.

Artifacts to publish: one per direction, each showing marketing home +
score-card anatomy + onboarding-assistant glimpse, desktop AND a framed
mobile composition, light+dark (G dark-first).
