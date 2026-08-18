# App interface spec — Control Room polish, responsiveness, interaction layer

Author: ui-visual-designer · 2026-08-18
Direction: **Direction B "Control Room"** (locked 2026-08-18, single-theme
dark only — see `.claude/skills/website-redesign/requirements.md`). This is
an implementation spec, not a new direction. Scope: visual + layout +
responsiveness + a CSS-first interaction/motion layer for BOTH surfaces
(owner addendum 2026-08-18: "more interactive and modern", app AND
marketing). No copy.ts changes, no routes/IA changes, no behavior changes
(per-section saves stay), no new dependencies, no inline styles (CSP
`style-src 'self'`), token-based CSS in the existing `styles.css` idiom.

Reference mockup: `docs/redesign/mockups/direction-b-control-room.html`.
Files touched: `apps/web/src/styles.css`,
`apps/web/src/components/AppShell.tsx`, `TenderCard.tsx`,
`MarketingLayout.tsx`, `apps/web/src/pages/app/Feed.tsx`, `Settings.tsx`,
`TenderDetail.tsx`, `apps/web/src/pages/marketing/Home.tsx` (classNames
only), plus one-line CSS-only fixes for Onboarding/auth.

Primary scope = the app area (§4–§7, owner screenshots); secondary =
interaction layer + marketing polish (§8, §13).

---

## 1. Design rationale

The marketing site already speaks Control Room: opaque `#12151b` panels
with `#2a303d` rules on the grid-textured ground, mono uppercase panel
heads, glowing tabular score figures, one teal accent. The app currently
speaks pre-redesign utility CSS: translucent grey washes, hairline-rule
section breaks, native fieldsets, 44rem-boxed headers. This spec extends
the mockup's **panel language** into the app: everything that groups
content becomes an opaque panel (`--glass-solid` + `--stroke` + radius
10–12px); everything that labels a panel becomes a mono uppercase head;
every input becomes a *recessed* field (darker than its panel — depth
logic: ground < field < panel < raised); every score number keeps its
glow. Page titles step down to workspace scale (1.5rem) because the app is
an instrument, not a landing page. One root-cause bug fix (the bare
`header` element rule) kills the "island header" on three shells at once.

---

## 2. Root causes found (read before implementing)

1. **Header island (Feed/Settings/Detail + Onboarding).** `styles.css`
   L210–221: `header, main, footer { max-width: 44rem; margin-inline:
   auto; padding-inline: 1.5rem; }` + `header { padding-block: 1.25rem }`.
   `.site-header` escapes this (`max-width: none; margin-inline: 0; …`);
   `.app-header` and `.assistant-header` do **not** — so both render as a
   44rem centered box while their content runs 72rem/40rem. Fix by
   escaping them the same way `.site-header` does. Do NOT touch the bare
   element rule (admin + legacy shells depend on it).
2. **Inconsistent tab dividers.** `Feed.tsx` drops the `tab--shelf` class
   when a shelf tab is active (`tab tab--active`), so the
   `border-inline-start` divider vanishes whenever Saved/Ignored is
   selected — and each of the two shelf tabs draws its own divider,
   producing double rules. Fix: key all group styling off the
   **`data-group` attribute** (always present) and draw exactly one
   divider via an adjacent-sibling selector.
3. **Giant H1.** Bare `h1 { font-size: 2.25rem }` serves marketing pages;
   the app inherits it. Scope a smaller app title size under `.app-main`.
4. **Native fieldset.** The Settings contract-types `<fieldset>` and the
   TenderDetail feedback `<fieldset>` are unclassed → default browser
   chrome. Give both a `.field-group` class.

---

## 3. Token additions and changes

Add to `:root` in `styles.css` (names follow existing conventions):

```css
/* recessed input surface — darker than panel, lighter than ground-deep */
--field-bg: #0e1116;
/* app-shell layout metric: header height, drives sticky offsets and
   scroll-margins. Overridden to 6.25rem inside the ≤40rem media query. */
--app-header-h: 3.5rem;
/* decorative danger border (panel edge + danger h2 underline only —
   never a text color and never the sole signifier) */
--danger-edge: rgba(248, 113, 113, 0.35);
```

No existing token values change. No webfonts, no new assets — the
empty-state glyph is pure CSS (§5.3).

### Contrast (WCAG 2.2 AA, computed relative luminance)

New/newly-relied-on text pairings (all ≥ 4.5:1 — pass):

| Foreground | Background | Ratio |
|---|---|---|
| `--text-1` #e8edf4 | panel `--glass-solid` #12151b | 15.5:1 |
| `--text-2` #8b94a7 | panel #12151b | 5.9:1 |
| `--text-3` #7d8799 | panel #12151b | 5.05:1 |
| `--text-1` #e8edf4 | `--field-bg` #0e1116 | 16.1:1 |
| `--text-3` #7d8799 (hints/placeholder) | `--field-bg` #0e1116 | 5.2:1 |
| `--accent-text` #35d3c0 | panel #12151b | 9.8:1 |
| `--accent-ink` #062723 | accent fill #35d3c0 | 8.5:1 |
| `--status-danger-text` #f87171 | panel #12151b | 6.6:1 |
| `--status-strong-text` #4ade80 | panel #12151b | 10.5:1 |
| `--status-caution-text` #fbbf24 | panel #12151b | 10.8:1 |
| `--status-info-text` #7dd3fc | panel #12151b | 11.0:1 |

`--danger-edge` blended over panel is ~1.8:1 — acceptable because it is
strictly decorative (the danger section is identified by its red heading
text at 6.6:1 and its copy, never by the border alone).

---

## 4. App shell / header (`AppShell.tsx` + CSS)

### 4.1 Desktop (default)

A deliberate **full-width app bar**: edge-to-edge glass surface, hairline
bottom border, with an inner container sharing `.app-main`'s exact content
metrics (72rem + 1.5rem inline padding) so the wordmark aligns flush with
the page content below. CSS deltas:

```css
.app-header {
  position: sticky;
  top: 0;
  z-index: 20;
  /* escape the bare `header` element box — root cause §2.1 */
  width: 100%;
  max-width: none;
  margin-inline: 0;
  padding-inline: 0;
  padding-block: 0;
  border: none;
  border-bottom: 1px solid var(--stroke-faint);
}
.app-header-inner {
  /* keep: flex, align-items center, gap 1.5rem, max-width 72rem,
     margin-inline auto, padding-inline 1.5rem */
  min-height: var(--app-header-h);
  padding-block: 0.5rem;
}
```

Nav links get a real selected indicator (currently color-only — an AA
"use of color" problem as well as a polish one):

```css
.app-nav-list a {
  padding: 0.55rem 0.15rem;   /* was 0.3rem 0.1rem */
}
.app-nav-list a[aria-current='page'] {
  color: var(--accent-text);
  box-shadow: inset 0 -2px 0 var(--accent-text);
}
```

No markup change in `AppShell.tsx` for desktop. The `glass` class stays
(reduced-transparency fallback already handled).

### 4.2 Mobile (≤ 40rem) — the app-bar pattern decision

The app nav has exactly three actions (Feed, Settings, Log out). A
hamburger would hide two links behind a tap for no benefit — the app
equivalent of the marketing hamburger is a **two-row bar**: row 1
wordmark + Log out (space-between), row 2 a full-width segmented Feed |
Settings strip with 44px targets and a 2px accent underline on the active
item. Replace the existing `@media (max-width: 40rem)` app-header block
with:

```css
@media (max-width: 40rem) {
  :root { --app-header-h: 6.25rem; }
  .app-header-inner {
    flex-wrap: wrap;
    gap: 0 1rem;
    min-height: 0;
    padding-block: 0.5rem 0;
  }
  .app-wordmark { display: inline-flex; align-items: center; min-height: 2.75rem; }
  .app-nav-actions { margin-left: auto; }
  .app-nav-list {
    order: 3;
    width: 100%;
    margin: 0;
    gap: 0;
    border-top: 1px solid var(--stroke-faint);
  }
  .app-nav-list li { flex: 1; }
  .app-nav-list a {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 2.75rem;   /* 44px */
    padding: 0;
  }
}
```

No markup change (the `<ul>` structure already supports this).

---

## 5. Feed page

### 5.1 Page title

Scope all app pages to workspace scale (also fixes Feed↔Settings type
inconsistency and long TenderDetail titles):

```css
.app-main h1 {
  font-size: 1.5rem;
  line-height: 1.3;
  letter-spacing: -0.015em;
  margin: 0 0 1.25rem;
}
```

(The `.assistant-card h1` onboarding rule is separate and unchanged.)

Column discipline at wide widths — cap the reading column so 2000px
screens don't stretch cards into 1100px-wide slabs:

```css
.tender-list,
.feed-skeleton-list,
.feed-empty,
.feed-filters {
  max-width: 58rem;
}
```

### 5.2 Tabs (divider fix + polish)

`Feed.tsx` markup delta: simplify the className expression to
`tab === t.id ? 'tab tab--active' : 'tab'` (drop `tab--shelf` from
classNames entirely — `data-group` stays and now carries all group
styling). CSS deltas — **delete** the whole `.tab--shelf` rule and the
`@media (max-width: 30rem)` feed-tabs block, replace with:

```css
.tab { min-height: 2.25rem; transition: background-color 180ms var(--ease), color 180ms var(--ease); }
.feed-tabs [data-group='shelf']:not(.tab--active) { color: var(--text-3); }
/* exactly ONE divider: between the last score tab and the first shelf tab */
.feed-tabs [data-group='score'] + [data-group='shelf'] {
  position: relative;
  margin-inline-start: 1.1rem;
}
.feed-tabs [data-group='score'] + [data-group='shelf']::before {
  content: '';
  position: absolute;
  left: -0.55rem;
  top: 20%;
  bottom: 20%;
  width: 1px;
  background: var(--stroke);
}
@media (max-width: 56rem) {
  .feed-tabs {
    width: 100%;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: thin;
  }
  .tab { min-height: 2.75rem; }
}
```

### 5.3 Filters — from heavy accordion to quiet toolbar control

The collapsed state becomes a compact fit-content control; the open body
becomes a proper Control Room panel. No markup change. Replace the
`.feed-filters` / `.feed-filter-body` rules:

```css
.feed-filters { border: none; background: none; border-radius: 0; margin-bottom: 1.5rem; }
.feed-filters summary {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.5rem;
  padding: 0.45rem 0.9rem;
  border: 1px solid var(--stroke);
  border-radius: var(--r-s);
  background: var(--surface-1);
  color: var(--text-2);
  font-weight: 600;
  font-size: 0.9rem;
  transition: border-color 180ms var(--ease), color 180ms var(--ease);
}
.feed-filters summary:hover { color: var(--text-1); border-color: var(--stroke-strong); }
.feed-filters[open] summary { color: var(--text-1); border-color: var(--accent-edge); }
.feed-filters summary::after { /* keep chevron; add: */ transition: transform 200ms var(--ease); }
.feed-filter-body {
  margin-top: 0.75rem;
  padding: 1.25rem;
  border: 1px solid var(--stroke);
  border-top: 1px solid var(--stroke);   /* replaces old border-top hairline */
  border-radius: var(--r-m);
  background: var(--glass-solid);
  box-shadow: var(--shadow-s);
  /* keep: display grid, gap 1.25rem */
}
.feed-filter-fields .form-field {
  flex: 1 1 11rem;
  max-width: 16rem;
  margin-bottom: 0;
}
```

### 5.4 Empty state — designed, centered, Control-Room motif

Replace `.feed-empty` (delete the dashed border) with a centered
composition that also solves the "vast empty ground below the fold"
defect via generous min-height:

```css
.feed-empty {
  border: 1px solid var(--stroke);
  border-radius: var(--r-l);
  background: var(--glass-solid);
  box-shadow: var(--shadow-s);
  padding: 4rem 1.5rem;
  min-height: 20rem;
  display: grid;
  gap: 0.6rem;
  justify-items: center;
  align-content: center;
  text-align: center;
  color: var(--text-2);
}
.feed-empty__glyph {          /* pure-CSS radar motif — no asset */
  width: 72px;
  height: 72px;
  margin-bottom: 0.75rem;
  border: 1px solid var(--stroke-strong);
  border-radius: 50%;
  position: relative;
  background: radial-gradient(circle, rgba(53, 211, 192, 0.12), transparent 65%);
}
.feed-empty__glyph::before {
  content: '';
  position: absolute;
  inset: 16px;
  border: 1px dashed var(--stroke);
  border-radius: 50%;
}
.feed-empty__glyph::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 6px;
  height: 6px;
  margin: -3px;
  border-radius: 50%;
  background: var(--sol-1);
  box-shadow: 0 0 12px rgba(53, 211, 192, 0.6);
}
@media (prefers-reduced-motion: no-preference) {
  .feed-empty__glyph::after { animation: empty-ping 3s ease-in-out infinite; }
  @keyframes empty-ping {
    0%, 100% { box-shadow: 0 0 8px rgba(53, 211, 192, 0.4); }
    50%      { box-shadow: 0 0 16px rgba(53, 211, 192, 0.75); }
  }
}
.feed-empty__title { margin: 0; font-weight: 600; font-size: 1.05rem; color: var(--text-1); }
.feed-empty__body  { margin: 0; font-size: 0.95rem; max-width: 34ch; }
.feed-empty__actions { margin-top: 0.75rem; display: flex; flex-wrap: wrap; justify-content: center; gap: 0.75rem; }
```

`Feed.tsx` markup delta (the empty-state block only; glyph in every
variant):

- **Shelf tabs**: glyph + the existing sentence verbatim as
  `<p className="feed-empty__title">`.
- **Filtered**: glyph + `<p className="feed-empty__title">No matches with
  these filters.</p>` + existing Clear-filters button (promote to
  `className="btn-quiet"`, drop `btn-sm`) inside
  `<div className="feed-empty__actions">`.
- **Default (no filters)**:
  - `<p className="feed-empty__title">No matches yet — ingestion and matching run daily.</p>`
  - `<p className="feed-empty__body">Your next chance: tomorrow.</p>`
  - `<div className="feed-empty__actions"><a className="btn-quiet" href="/app/settings#matching-profile">Widen CPV preferences in Settings</a></div>`

  Copy note (meaning-preserving restructure, allowed by the brief): the
  three sentences are kept verbatim; the trailing clause "if this
  persists" is absorbed by the quiet (non-imperative) button treatment —
  the action is offered, not commanded. **QA check**: grep e2e/unit tests
  for the old empty-state string before landing; if any test locks the
  full sentence, keep the sentence verbatim as `.feed-empty__body` (with
  its inline link) instead of the button, and update this spec's status.

### 5.5 Tender card (populated state)

Cards become opaque panels (currently translucent `--surface-1`, which
lets the grid texture bleed through — off-language). CSS deltas:

```css
.tender-card {
  background: var(--glass-solid);      /* was var(--surface-1) */
  padding: 1.25rem 1.4rem;
  gap: 0.55rem;
}
.tender-card__head {                    /* class exists in markup, currently unstyled */
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
}
.tender-card__title { line-height: 1.35; }
.tender-card__title a { color: var(--text-1); text-decoration: none; }
.tender-card__title a:hover { color: var(--accent-text); text-decoration: underline; }
.tender-card__meta {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--text-3);
  overflow-wrap: anywhere;
}
.tender-card__actions {
  margin-top: 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--stroke-faint);
}
/* visible pressed state for Save/Ignore toggles (not color-only: label
   text already flips Saved/Ignored) */
.btn-quiet[aria-pressed='true'] { background: var(--accent-soft); }
```

`TenderCard.tsx` markup delta: move the deadline `<p className=
"tender-card__deadline num">` **inside** `.tender-card__head`, after the
`ScoreBadge` — badge left, deadline right, wrapping below on narrow
cards. Nothing else changes.

### 5.6 ScoreBadge

Align the pill to the mockup's classification chip (`.score-total
.class`): squared radius, mono uppercase label, per-class glow. CSS
deltas on the app-section `.score-badge` rules:

```css
.score-badge {
  border-radius: var(--r-s);   /* was 999px */
  border-width: 1px;           /* was 1.5px */
  padding: 0.3rem 0.65rem;
  font-size: 0.8rem;
}
.score-badge__label {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.score-badge__num {
  font-size: 0.95rem;
  text-shadow: 0 0 16px currentColor;  /* was fixed teal — wrong hue on
                                          caution/risk/info badges */
}
```

Also update the base (pre-app) `.score-badge` rule's `border: 2px solid`
→ `1px` so the two rules don't fight. No component change —
classification stays text-first.

### 5.7 402 notice (`SubscriptionRequiredNotice`)

Already on-language. Only responsive deltas (§9) plus
`.subscribe-required { background: var(--glass-solid); }` under the same
reduced-transparency logic it already gets from `glass` — no change
needed beyond §9. No markup change.

---

## 6. Settings page

### 6.1 Layout

```css
.settings-shell { grid-template-columns: 15rem minmax(0, 1fr); }  /* was 14rem */
.settings-content {                 /* class exists, currently unstyled */
  display: grid;
  gap: 1.25rem;
  min-width: 0;
  max-width: 48rem;
}
```

The perceived "empty right half" is fixed by panelizing the sections
(below), not by stretching forms to 1100px — form measure stays capped
for usability; the panel edges give the column a designed boundary.

### 6.2 Sections become panels (defect #6)

Replace the `.settings-group`/`.settings-subsection` hairline-rule
styling:

```css
.settings-group {
  margin: 0;
  padding: 1.5rem 1.75rem 1.75rem;
  border: 1px solid var(--stroke);
  border-radius: var(--r-l);
  background: var(--glass-solid);
  box-shadow: var(--shadow-s);
  scroll-margin-top: calc(var(--app-header-h) + 1rem);
}
/* delete the old .settings-group:first-child reset (no longer needed) */
.settings-group > h2 {              /* Control Room panel-head */
  margin: 0 0 1.25rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--stroke-faint);
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-2);
}
.settings-subsection {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--stroke-faint);
  scroll-margin-top: calc(var(--app-header-h) + 1rem);
}
.settings-subsection h3 { margin: 0 0 0.75rem; font-size: 1rem; }
```

### 6.3 Sidebar nav (defect #2 type size)

```css
.settings-nav {
  top: calc(var(--app-header-h) + 1.25rem);   /* was hardcoded 5.5rem */
  background: var(--glass-solid);              /* was surface-1 */
  padding: 0.6rem;
}
.settings-nav a {
  display: flex;
  align-items: center;
  min-height: 2.5rem;
  padding: 0.45rem 0.75rem;
  font-size: 0.95rem;    /* was 0.9rem */
}
.settings-nav a[aria-current='true'] {
  color: var(--accent-text);
  background: var(--accent-soft);
  box-shadow: inset 2px 0 0 var(--accent-text);   /* not color-only */
}
```

### 6.4 Form component system (global — serves Settings, Feed filters, Onboarding, auth, TenderDetail feedback)

**Text inputs / selects / textareas** — upgrade the existing bare-element
rule in place (safe for admin too):

```css
input, textarea, select {
  padding: 0.5rem 0.75rem;            /* was 0.5rem */
  border: 1px solid var(--stroke);    /* was --color-border (same value) */
  border-radius: var(--r-s);          /* was 0.25rem */
  background: var(--field-bg);        /* was --color-bg — recessed field */
  color: var(--text-1);
  font: inherit;
  min-height: 2.5rem;
}
input:focus-visible, textarea:focus-visible, select:focus-visible {
  border-color: var(--accent-edge);   /* + the global outline, kept */
}
textarea { min-height: 6rem; resize: vertical; }
input[type='checkbox'] {
  min-height: 0;
  width: 1.05rem;
  height: 1.05rem;
  margin: 0;
  flex: none;
  accent-color: var(--sol-1);
}
.form-field input, .form-field select, .form-field textarea {
  width: 100%;
  min-width: 0;
}
```

**Add-rows** (defect #4 — label/input/button misalignment). CSS:

```css
.form-field.inline {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;      /* was flex-end */
  gap: 0.5rem;
  max-width: 32rem;         /* was none */
}
.form-field.inline label { flex: 1 0 100%; }   /* label on its own line */
.form-field.inline input, .form-field.inline select {
  flex: 1 1 10rem;
  width: auto;
  min-width: 0;
}
.btn-add {
  flex: none;
  min-height: 2.5rem;
  padding: 0.5rem 1.1rem;
  border: 1px solid var(--stroke);
  border-radius: var(--r-s);
  background: var(--surface-2);
  color: var(--text-1);
  font-weight: 600;
  cursor: pointer;
  transition: border-color 180ms var(--ease);
}
.btn-add:hover { border-color: var(--stroke-strong); }
```

`Settings.tsx` markup delta: add `className="btn-add"` to the six "Add"
buttons (CPV, keyword, geography, exclusion, capability, certification).

**Chip groups** (defect #4 tightness):

```css
.chip-list { gap: 0.5rem; }
.chip-list li {
  gap: 0.45rem;
  border: 1px solid var(--stroke);
  background: var(--surface-2);
  border-radius: 999px;
  padding: 0.3rem 0.35rem 0.3rem 0.8rem;
  font-size: 0.88rem;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.chip-list li button {
  width: 1.5rem;                 /* 24px — WCAG 2.5.8 minimum met */
  height: 1.5rem;
  min-height: 0;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-3);
  font-size: 1rem;
  line-height: 1;
  flex: none;
}
.chip-list li button:hover {
  color: var(--status-danger-text);
  background: rgba(139, 148, 167, 0.15);
}
```

**Fieldsets** (defect #5 — native chrome):

```css
.field-group { border: none; margin: 0 0 1rem; padding: 0; display: grid; gap: 0.35rem; }
.field-group legend { padding: 0; margin-bottom: 0.35rem; font-weight: 600; font-size: 0.9rem; }
.checkbox-row { min-height: 2rem; gap: 0.6rem; }
```

Markup deltas: `className="field-group"` on the Settings contract-natures
`<fieldset>` **and** the TenderDetail feedback `<fieldset>`.

**Save buttons** (defect #7 — behavior stays per-section; only styling
unifies). Every per-section save `.cta` gets wrapped:

```css
.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--stroke-faint);
}
```

`Settings.tsx` markup delta: wrap each of the nine save buttons (profile,
CPV, keywords, geographies, exclusions, capabilities, certifications,
matching, digest) in `<div className="form-actions">…</div>`. Buttons
keep `className="cta"` and their exact labels/handlers. Identical
anchored placement + hairline = the consistency the owner asked for;
width still fits content (correct for text buttons).

### 6.5 Danger zone (defect #8)

```css
.settings-danger { border-color: var(--danger-edge); }
.settings-danger h2 { color: var(--status-danger-text); border-bottom-color: var(--danger-edge); }
button.danger {
  border: 1px solid var(--status-danger-text);
  color: var(--status-danger-text);
  background: transparent;
  border-radius: var(--r-s);
  font-weight: 600;
  padding: 0.6rem 1.2rem;
  min-height: 2.5rem;
}
button.danger:hover:not([disabled]) { background: rgba(248, 113, 113, 0.1); }
button.danger[disabled] { opacity: 0.5; cursor: not-allowed; }
#delete-confirm { max-width: 16rem; }
```

(`.settings-danger`'s old `border-top-color` override is superseded by
the panel border.) No markup change.

---

## 7. Secondary pages — consistency pass (only what changes)

### 7.1 TenderDetail

- H1/type: covered by the `.app-main h1` rule (§5.1). Add
  `.tender-detail { max-width: 56rem; }`.
- Facts grid → panel:
  ```css
  .detail-facts {
    border: 1px solid var(--stroke);
    border-radius: var(--r-l);
    background: var(--glass-solid);
    padding: 1.25rem;
    gap: 1rem 1.5rem;
  }
  .detail-facts dt {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-3);
    margin-bottom: 0.15rem;
  }
  .detail-facts dd { margin: 0; overflow-wrap: anywhere; }
  ```
- Score-anatomy panel: `background: var(--glass-solid)` (was surface-1),
  `overflow-x: auto`, and de-spreadsheet the table (scoped — the global
  bordered `th, td` rule stays for admin):
  ```css
  .score-anatomy th, .score-anatomy td {
    border: none;
    border-top: 1px solid var(--stroke-faint);
    padding: 0.5rem 0.75rem;
  }
  .score-anatomy thead th {
    border-top: none;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .score-anatomy caption {
    caption-side: top;
    text-align: left;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-3);
    margin-bottom: 0.5rem;
  }
  .score-anatomy table { min-width: 34rem; }  /* scrolls inside panel on mobile */
  ```
- Currently-unstyled classes:
  ```css
  .feedback-form {
    border: 1px solid var(--stroke);
    border-radius: var(--r-l);
    background: var(--glass-solid);
    padding: 1.25rem;
    margin-bottom: 1.5rem;
    display: grid;
    gap: 1rem;
  }
  .ted-attribution {
    margin-top: 2.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--stroke-faint);
    color: var(--text-3);
    font-size: 0.8rem;
  }
  ```
- Markup delta: `className="field-group"` on the feedback fieldset (§6.4).

### 7.2 Onboarding

- **Header island fix** (same root cause as the app header):
  ```css
  .assistant-header { max-width: none; margin-inline: 0; padding: 1rem 1.5rem; }
  ```
- Everything else (assistant card, presets, chip toggles) inherits the
  global input upgrade (§6.4) automatically and already matches the
  panel language. No markup changes.

### 7.3 Auth pages

- Inherit the input/field upgrade automatically. Add (after the shared
  `#main-content` rule):
  ```css
  .auth-main { max-width: 30rem; }
  .auth-main h1 { font-size: 1.6rem; }
  ```
- No markup changes; `.site-header glass` already correct.

---

## 8. Interaction & motion layer (BOTH surfaces)

Contract for every rule in this section: **transform/opacity/color/
border-color/box-shadow/filter only** (60fps-safe, no layout properties
animated, no layout thrash), CSS-first (zero new JS libraries; the only
JS is React class-toggling — classList, never `style`), and **everything
is neutralized by the existing global reduced-motion kill-switch**
(`* { animation: none; transition: none }` under `prefers-reduced-motion:
reduce`) — new keyframes additionally self-gate under
`prefers-reduced-motion: no-preference` for clarity. All end-states are
identical with motion off (nothing conveys information via motion alone).
Asset manifest: **no new binary assets** — glyphs, sweeps and glows are
pure CSS; iconography stays the inline-SVG brand mark + CSS chevrons.

### 8.1 Micro-interactions (hover / focus / active) — shared vocabulary

One press treatment, one hover treatment per element class, both
surfaces:

```css
/* press feedback — every button-like element */
.cta:active, .btn-quiet:active, .btn-solar:active, .btn-add:active,
.tab:active, button.danger:active, .mkt-btn-quiet:active,
.mkt-menu-toggle:active {
  transform: translateY(1px);
}
/* hover-capable pointers only — never sticky-hover on touch */
@media (hover: hover) {
  /* interactive cards/panels: lift + edge sharpen (app cards already
     have this; extend to marketing cards, §13) */
  .tender-card:hover, .mkt-step:hover, .mkt-truth-card:hover,
  .feature-list li:hover, .mkt-plan:hover, .mkt-plan-chip:hover {
    transform: translateY(-2px);
    border-color: var(--stroke-strong);
    box-shadow: var(--shadow-m);
  }
}
.mkt-step, .mkt-truth-card, .feature-list li, .mkt-plan, .mkt-plan-chip {
  transition: transform 200ms var(--ease), border-color 200ms var(--ease),
    box-shadow 200ms var(--ease);
}
```

- Buttons keep their existing hover semantics (solid → `brightness(1.1)`;
  quiet → `--accent-soft` wash; add `transition: … transform 120ms
  var(--ease)` to each existing button transition list).
- Tabs: 180ms color/background (§5.2); chips (`.mkt-chip`, `.chip-list
  li`): border-color 180ms; remove buttons per §6.4.
- Focus: the existing global `:focus-visible { outline: 3px solid
  var(--focus) }` (teal, ≥3:1 against every surface) is the single focus
  treatment — never suppressed, never replaced by glow. `prefers-contrast:
  more` already widens it.

### 8.2 Transitions (in-page state changes)

- **Accordion (feed filters)**: chevron rotates 200ms (§5.3); the opened
  body rises in:
  ```css
  @media (prefers-reduced-motion: no-preference) {
    .feed-filters[open] .feed-filter-body { animation: rise-in 200ms var(--ease); }
    @keyframes rise-in { from { opacity: 0; transform: translateY(-6px); } }
  }
  ```
- **Tab switches / feed loads**: the list and empty state are unmounted
  during `loading` (skeleton shows), so a mount animation re-triggers on
  every tab change with zero JS:
  ```css
  @media (prefers-reduced-motion: no-preference) {
    .tender-list, .feed-empty { animation: rise-in 240ms var(--ease); }
  }
  ```
  Skeleton sheen stays as shipped (already reduced-motion-gated).
- **Chip add**: `@media (prefers-reduced-motion: no-preference)
  { .chip-list li { animation: chip-in 160ms var(--ease); } @keyframes
  chip-in { from { opacity: 0; transform: scale(0.92); } } }`. Chip
  *removal* animates nothing — exit animations would require
  unmount-delay state machinery for pure decoration; rejected.
- **Save success feedback (app)**: make the existing `statusMessage`
  visible as a transient toast — the accessible live region stays exactly
  as-is (visually hidden, `role="status"`), so AT behavior is unchanged;
  the toast is its `aria-hidden` visual twin.
  - React delta (Feed, Settings, TenderDetail): render
    `{statusMessage !== null && <div className="app-toast" aria-hidden="true">{statusMessage}</div>}`
    next to the existing hidden status `<p>`, and add one effect that
    clears `statusMessage` after 2500ms (existing strings only — "Saved.",
    "CPV preferences saved.", …; no new copy).
  - CSS:
    ```css
    .app-toast {
      position: fixed;
      right: 1.5rem;
      bottom: 1.5rem;
      z-index: 60;
      max-width: min(22rem, calc(100vw - 3rem));
      padding: 0.6rem 1rem;
      border: 1px solid var(--accent-edge);
      border-radius: var(--r-s);
      background: var(--glass-solid);
      color: var(--text-1);
      font-size: 0.9rem;
      box-shadow: var(--shadow-m);
    }
    @media (prefers-reduced-motion: no-preference) {
      .app-toast { animation: toast-in 200ms var(--ease); }
      @keyframes toast-in { from { opacity: 0; transform: translateY(8px); } }
    }
    ```
    (With motion off the toast simply appears/disappears — fine.)
- **Page-level transitions**: none. Cross-route fades in an SPA fight the
  router, add perceived latency, and read as 2016 portfolio-site — the
  per-view rise-in above is the right amount.

### 8.3 Ambient Control-Room character (exactly three devices, both surfaces)

Chosen for comprehension value; everything else was rejected as
decoration overload (see §12).

1. **Terminal cursor blink** — the wordmark's teal `_` blinks three times
   on load, then holds solid (persistent blink = distraction):
   ```css
   @media (prefers-reduced-motion: no-preference) {
     .product-name::after, .app-wordmark::after {
       animation: cursor-blink 1.1s steps(2, jump-none) 3;
     }
     @keyframes cursor-blink { 50% { opacity: 0; } }
   }
   ```
2. **Score readout glow-in** — every score figure "powers on" at first
   paint (says: this number was computed, not fetched from a CMS). Real
   text throughout; AT unaffected:
   ```css
   @media (prefers-reduced-motion: no-preference) {
     .score-badge__num { animation: readout-in 500ms var(--ease); }
     @keyframes readout-in { from { opacity: 0.2; text-shadow: none; } }
   }
   ```
   (A numeric count-up was rejected: it needs per-frame JS or
   pseudo-element counters that break screen-reader text.)
3. **Hero panel scan sweep** (marketing hero panel + the app empty-state
   panel share it) — one 1.4s diagonal teal sheen pass on mount, then
   static:
   ```css
   @media (prefers-reduced-motion: no-preference) {
     .mkt-hero-panel, .feed-empty { position: relative; overflow: hidden; }
     .mkt-hero-panel::after, .feed-empty::after {
       content: '';
       position: absolute;
       inset: 0;
       transform: translateX(-110%);
       background: linear-gradient(105deg, transparent 40%,
         rgba(53, 211, 192, 0.08) 50%, transparent 60%);
       animation: panel-scan 1.4s var(--ease) 400ms 1 forwards;
       pointer-events: none;
     }
     @keyframes panel-scan { to { transform: translateX(110%); } }
   }
   ```
   Explicitly rejected: animating the body grid texture
   (background-position on the full page repaints everything — not
   60fps-safe) and the empty-state glyph keeps its 3s glow pulse from
   §5.4 as part of this device.

### 8.4 Scroll-triggered reveals — marketing pages ONLY

Cheap, IntersectionObserver + class toggle, progressive enhancement
(content fully visible if JS never runs, because the hidden state only
exists under a JS-added root class):

- React delta (`MarketingLayout.tsx`): on mount add `js-reveal` to
  `document.documentElement` (classList only); one effect keyed on
  `location.pathname` that observes all `.mkt-reveal:not(.is-in)`
  elements (`rootMargin: '0px 0px -10%'`, `threshold: 0.15`), adds
  `is-in` on intersect, unobserves each revealed element, disconnects on
  cleanup. Guard `typeof IntersectionObserver === 'undefined'` → add
  `is-in` to everything immediately.
- CSS:
  ```css
  @media (prefers-reduced-motion: no-preference) {
    .js-reveal .mkt-reveal {
      opacity: 0;
      transform: translateY(16px);
      transition: opacity 480ms var(--ease), transform 480ms var(--ease);
    }
    .js-reveal .mkt-reveal.is-in { opacity: 1; transform: none; }
    .mkt-reveal--d1 { transition-delay: 60ms; }
    .mkt-reveal--d2 { transition-delay: 120ms; }
    .mkt-reveal--d3 { transition-delay: 180ms; }
  }
  ```
  (Under reduced motion the hidden state never applies at all — no
  reveal, content simply present.)
- Markup delta (classNames only, no structure change): in `Home.tsx` add
  `mkt-reveal` to each `.mkt-section-head`, each `.mkt-step` (stagger
  `--d1/--d2/--d3` on steps 2–4), each `.mkt-truth-card` (`--d1` on the
  second), each `.mkt-plan-chip` (`--d1` on the second), and each
  `.feature-list li` (stagger). Other marketing pages: section heads and
  `.mkt-plan` cards only. **Never** on the hero (above the fold must
  paint instantly) and never on legal prose (Privacy/Terms get no
  reveals).

---

## 9. Responsive spec (consolidated per breakpoint)

Breakpoints use the file's existing rem queries; owner's px asks map:
480px→30rem, 768px→48rem, 1024px→64rem, ≥1440px→90rem. **Invariant at
every width: no horizontal page overflow** (guaranteed by: `min-width: 0`
on flex/grid children, `overflow-wrap: anywhere` on meta/chips/dd,
`overflow-x: auto` on `.feed-tabs`, `.settings-nav ul`,
`.score-anatomy`; QA at 320px).

**≥ 90rem (wide, incl. ~2000px):** no new rules. `.app-main` stays
72rem centered; Feed column capped 58rem, Settings content 48rem beside
the 15rem rail; the full-width app bar (§4.1) reads intentional at any
width because its inner container shares the 72rem grid.

**≤ 64rem (1024):** nothing app-specific changes (72rem container
becomes fluid naturally). Verify feed filter fields wrap 3→2 per row
(they do via `flex: 1 1 11rem`).

**≤ 56rem (896 — covers 768):**
- Feed tabs: single-row horizontal scroll, no wrap, thin scrollbar,
  44px-tall tabs (§5.2).
- Settings: `.settings-shell { display: block; }` (replaces the current
  `grid-template-columns: 1fr` block). Sidebar becomes a **sticky
  horizontal chip row** under the app bar:
  ```css
  @media (max-width: 56rem) {
    .settings-shell { display: block; }
    .settings-nav {
      position: sticky;
      top: var(--app-header-h);
      z-index: 15;
      margin-bottom: 1.25rem;
      padding: 0.5rem;
    }
    .settings-nav ul { display: flex; flex-wrap: nowrap; overflow-x: auto; gap: 0.35rem; }
    .settings-nav a {
      white-space: nowrap;
      min-height: 2.75rem;         /* 44px */
      border: 1px solid var(--stroke);
      border-radius: 999px;
      padding: 0.4rem 1rem;
    }
    .settings-nav a[aria-current='true'] { box-shadow: none; border-color: var(--accent-edge); }
    .settings-group, .settings-subsection {
      scroll-margin-top: calc(var(--app-header-h) + 4.5rem);
    }
  }
  ```
  (Scrollspy + anchors already exist; this is restyle only.)

**≤ 48rem (768):** all interactive controls reach 44px:
```css
@media (max-width: 48rem) {
  .cta, .btn-quiet, .btn-solar, .btn-add, button.danger { min-height: 2.75rem; }
  .checkbox-row { min-height: 2.75rem; }
}
```

**≤ 40rem (640):** two-row app bar + `--app-header-h: 6.25rem` (§4.2).
Existing `.detail-facts { grid-template-columns: 1fr }` block kept.

**≤ 30rem (480 — covers 320–480):**
```css
@media (max-width: 30rem) {
  .app-main { padding-inline: 1rem; }
  .settings-group { padding: 1.25rem 1rem 1.5rem; }
  .form-actions .cta { width: 100%; }
  .form-field.inline .btn-add { flex: 1 1 auto; }
  .feed-empty { padding: 3rem 1.25rem; }
  .feed-filter-fields .form-field { max-width: none; flex-basis: 100%; }
  .subscribe-required { padding: 1.5rem 1.25rem; }
  .subscribe-required__actions { flex-direction: column; align-items: stretch; }
  .tender-card__actions { flex-wrap: wrap; }
}
```

---

## 13. Marketing front pages polish (secondary — after the app area)

Audit of `apps/web/src/pages/marketing/*` + `MarketingLayout.tsx` against
the Control Room mockup. Copy is LOCKED (`copy.ts` + `app.test.ts`);
structure/IA unchanged — classNames and CSS only.

### 13.1 Gap audit (shipped vs mockup character)

| Surface | Shipped | Mockup character | Verdict |
|---|---|---|---|
| Hero right panel (Home) | Static chip rows + tier list (`.mkt-hero-panel`) | Glowing 84.5/100 score-readout panel with breakdown bars + mono panel head | **Flagged, out of this pass**: a live score panel means new illustrative content (numbers/labels), which is a content addition, not a re-skin — and it's exactly the planned public sample-verdict demo's job. Do not fake it here. This pass: scan sweep (§8.3), chip hover states, and a proper mono panel-head treatment on the existing captions. |
| Cards (`.mkt-step`, `.mkt-truth-card`, `.feature-list li`, `.mkt-plan`, `.mkt-plan-chip`) | Fully static — no hover, no transition | Panels feel instrumented/alive | Hover lift + border sharpen (§8.1) + scroll reveals (§8.4). |
| Section links ("… →") | Plain teal link, underline on hover | — | Arrow nudge: `.mkt-section-link a { display: inline-block; transition: transform 200ms var(--ease); } .mkt-section-link a:hover { transform: translateX(3px); }` (whole-link transform; the "→" is locked copy — never wrap it). |
| Methodology score-components table | Plain bordered table in a glass card | Mockup's breakdown table: tabular-mono points, hairline row rules only | Scope inside `.mkt-table-card`: `td, th { border-inline: none; border-top: 1px solid var(--stroke-faint); }`, `thead th { border-top: none; }`, points column gets `.num`-equivalent via `.mkt-table-card td:nth-child(2) { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }`. (Adding `<progress>` bars is a tasteful OPTION but a structure change — leave out unless the owner asks.) |
| Wordmark | Static `_` | Terminal cursor | Blink ×3 on load (§8.3). |
| Buttons | Hover only | — | Press feedback (§8.1). |
| Panel heads | `.mkt-hero-panel__caption` mono caption exists | Mockup `.panel__head` has a hairline underline strip | `.mkt-hero-panel__caption { padding-bottom: 0.4rem; border-bottom: 1px solid var(--stroke-faint); }` |

### 13.2 Responsive tightening (marketing)

```css
@media (max-width: 30rem) {
  .mkt-cta-row .cta, .mkt-cta-row .mkt-btn-quiet {
    flex: 1 1 100%;
    justify-content: center;
  }
  .mkt-plan-row { flex-direction: column; }
  .mkt-hero-panel { padding: 1.25rem; }
}
```

Everything else (hero grid collapse at 64rem, steps 2-col/1-col, plans
1-col at 48rem, hamburger ≤56rem) is already handled — verified in
`styles.css`; no further marketing layout changes.

### 13.3 Marketing markup deltas (complete list)

- `Home.tsx`: `mkt-reveal` (+ delay modifiers) classNames per §8.4.
- `Pricing.tsx` / `HowItWorks.tsx` / `Methodology.tsx` / `Pilot.tsx`:
  `mkt-reveal` on section heads / `.mkt-plan` / `.mkt-step` /
  `.mkt-truth-card` only.
- `MarketingLayout.tsx`: `js-reveal` root class + IntersectionObserver
  effect (§8.4).
- `Contact.tsx`, `Privacy.tsx`, `Terms.tsx`: **no changes** (legal/prose
  pages get no reveals).

---

## 10. Implementation checklist (ordered for frontend-engineer)

1. **Tokens**: add `--field-bg`, `--app-header-h`, `--danger-edge` to
   `:root` (§3).
2. **App bar**: `.app-header` full-bleed escape + inner min-height +
   active-nav underline; replace the ≤40rem header block (§4). Also the
   one-line `.assistant-header` fix (§7.2).
3. **Global form primitives**: input/select/textarea/checkbox upgrade,
   `.form-field` width, `.form-field.inline` add-row, `.btn-add`,
   `.field-group`, `.form-actions`, chip-list, `button.danger` (§6.4–6.5).
   These are app-wide — verify auth, onboarding, admin, feed filters
   render sanely after this step alone.
4. **Feed**: `.app-main h1` scale; column caps; tab divider fix (CSS +
   `Feed.tsx` className simplification); filters restyle; empty-state CSS
   + `Feed.tsx` empty-block markup (§5.1–5.4). Run the copy-lock grep
   noted in §5.4 first.
5. **Card + badge**: `.tender-card` deltas + `TenderCard.tsx` deadline
   move into `__head`; ScoreBadge chip restyle (§5.5–5.6).
6. **Settings**: shell columns, `.settings-content`, panelized groups,
   panel-head h2, sidebar restyle, danger zone; markup deltas =
   `btn-add` ×6, `field-group` ×1, `form-actions` ×9 (§6).
7. **TenderDetail**: facts panel, table de-border, feedback-form,
   ted-attribution, `field-group` ×1 (§7.1).
8. **Auth**: `.auth-main` cap (§7.3).
9. **Responsive blocks**: apply §9 top-down; delete the superseded
   `@media (max-width: 30rem)` feed-tabs block and the old ≤56rem
   settings block contents it replaces.
10. **QA pass**: 320 / 390 / 480 / 768 / 1024 / 1440 / 2000px — no
    horizontal overflow anywhere; keyboard focus visible on every new
    control; axe/contrast spot-check of §3 pairings; `prefers-reduced-
    motion` and `prefers-reduced-transparency` sweeps; existing E2E tab
    selectors (`getByRole('tab', …)`) still pass (className change only).

---

## 11. What does NOT change

- Copy: `copy.ts` untouched; all Settings/Detail/Onboarding strings
  verbatim; the one Feed empty-state restructure is meaning-preserving
  and has a specified verbatim fallback (§5.4).
- Behavior: per-section saves, scrollspy, tab semantics
  (`role="tab"`/`data-group`), optimistic save/ignore, 402 flow, filter
  apply-on-submit, IntersectionObserver logic — all as-is.
- Routes, IA, section ids/anchors (`#billing`, `#matching-profile`, …).
- Tokens: no existing value changes; single dark theme; grid texture;
  system font stacks (no webfonts); terminal wordmark.
- CSP posture: zero inline styles introduced; score bars stay native
  `<progress>`.
- Marketing site, admin shell, `.cta` treatment, `.glass` fallbacks,
  reduced-motion kill-switch.
- Dependencies: none added.

## 12. Rejected while designing (taste record)

- **Hamburger for the app nav on mobile** — hiding 2 links behind a tap
  is worse than a segmented second row; the marketing hamburger exists
  because that nav has 6 items.
- **Two-column tender feed at wide widths** — scanning a ranked queue is
  a single-column task; a 58rem cap beats a masonry of verdicts.
- **Full-width form inputs at desktop in Settings** — stretching fields
  to 1100px "fills space" but destroys scanability; panels + capped
  measure fix the perceived emptiness instead.
- **Illustration/SVG asset for the empty state** — a CSS radar motif is
  on-direction, weighs 0 bytes, and can't drift from the token palette.
- **Filled red delete button** — an outline danger button keeps the
  page's single-accent discipline; the confirm-input is the real guard.
