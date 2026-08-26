import type { ReactElement } from 'react';
import '../styles/illustrations.css';

/**
 * Signature hero visual (brand-elevation phase, docs/redesign/brand-elevation-phase.md
 * §2 "the funnel"): a queue of notice chips sits above the profile
 * "lens"; a few of them flow down through it and settle into three
 * verdict groups. The 3 / 4 / 2 split sums to the 9 chips actually drawn
 * (6 static queue + 3 animated flow) — an illustrative worked count, not
 * a product metric, and labelled as such in the artwork itself so
 * nothing here reads as a real statistic.
 *
 * Revision (2026-08-26, coordinator review of the rendered Home hero at
 * 1366px/390px): the original all-9-chips-animate version left the top
 * ~55% of the frame empty once everything had fallen away, and the card
 * type was unreadably small at real display width. Fixed by splitting
 * the chips into a permanent, never-animated "queue" (6 chips, 65%
 * opacity, always on screen — the composition is never empty, motion or
 * not) and a small flow subset (3 chips) that do the actual fall-through
 * animation; by tightening the viewBox from 560×420 to 560×360 so the
 * lens + cards fill the frame; and by raising every card/caption font
 * size (title 16, number 28, "of 9 notices" 12, footer 11 viewBox units
 * — all above the coordinator's stated floors of 15/26/11/10).
 *
 * CSS-only animation (keyframes live in `../styles/illustrations.css`,
 * a real stylesheet — never an inline `<style>`/`style=`, see that
 * file's header). The 3 flow chips run once, ≤ 3s end-to-end, then hold
 * their final (invisible) frame (`animation-fill-mode: forwards`) — not
 * an infinite loop, so WCAG 2.2 SC 2.2.2 needs no pause control; the
 * static queue, lens and cards need no such allowance since they never
 * move. Under `prefers-reduced-motion: reduce` the 3 flow chips and the
 * lens pulse are hidden outright (they are motion-only flourishes, never
 * load-bearing) rather than frozen mid-flight, so the remaining frame —
 * queue, lens, three verdict cards, footer caption — is a single fully
 * visible static composition with nothing left half-transparent.
 *
 * Decorative role is *not* used here: this is the product's signature
 * story-telling image, so it carries `role="img"` + a real `aria-label`
 * (equivalent to `<img alt>`) rather than `aria-hidden`. Fill/stroke
 * that must track theme go through `var(--token, <dark fallback>)`
 * classes (`.bm-accent-fill` etc.); ink linework uses
 * `stroke="currentColor"` so it always matches surrounding text.
 *
 * Usage: marketing Home hero, ~560×360 intrinsic, scales via `className`
 * (e.g. `width: min(100%, 560px)` + `height: auto`). Source ~7 KB.
 */
export function FunnelHero({ className }: { className?: string }): ReactElement {
  return (
    <svg
      className={['bm-illust', 'funnel-hero', className].filter(Boolean).join(' ')}
      viewBox="0 0 560 360"
      fill="none"
      role="img"
      aria-label="Illustration: a stream of procurement notices flows through a matching lens and sorts into three illustrative verdict groups — Strong fit, Worth reviewing, and Possible."
    >
      {/* Permanent queue — never animated, always on screen at 65%
          opacity, so the composition is never empty regardless of where
          the flow animation (or reduced motion) leaves things. */}
      <g stroke="currentColor" strokeWidth="1.5" opacity="0.65">
        {[
          [86, 6],
          [256, 6],
          [426, 6],
          [171, 32],
          [341, 32],
          [256, 58],
        ].map(([x, y]) => (
          <g transform={`translate(${x}, ${y})`} key={`queue-${x}-${y}`}>
            <rect width="24" height="14" rx="3" strokeOpacity="0.55" />
            <line x1="5" y1="5.5" x2="17" y2="5.5" strokeOpacity="0.35" strokeLinecap="round" />
            <line x1="5" y1="9.5" x2="13" y2="9.5" strokeOpacity="0.35" strokeLinecap="round" />
          </g>
        ))}
      </g>

      {/* Flow subset — the only chips that move. Start just above the
          frame (overflow: visible on .bm-illust lets that read cleanly)
          and fall through the lens. */}
      <g className="bm-chip-stream" stroke="currentColor" strokeWidth="1.5">
        {[
          [224, -8],
          [268, -8],
          [312, -8],
        ].map(([x, y]) => (
          // Two nested <g>s on purpose: a CSS `transform` (even one only
          // ever set via a keyframe) replaces an element's SVG `transform`
          // presentation attribute rather than composing with it, in every
          // browser. Positioning lives on this outer, CSS-untouched <g>;
          // the animated `.bm-chip` is a plain child with no attribute of
          // its own for the animation to clobber.
          <g transform={`translate(${x}, ${y})`} key={`flow-${x}-${y}`}>
            <g className="bm-chip">
              <rect width="24" height="14" rx="3" strokeOpacity="0.55" />
              <line x1="5" y1="5.5" x2="17" y2="5.5" strokeOpacity="0.35" strokeLinecap="round" />
              <line x1="5" y1="9.5" x2="13" y2="9.5" strokeOpacity="0.35" strokeLinecap="round" />
            </g>
          </g>
        ))}
      </g>

      <g className="lens" transform="translate(280, 150)">
        <circle className="bm-lens-pulse bm-accent-line" r="44" strokeWidth="1.5" />
        <circle className="bm-accent-stroke" r="44" strokeWidth="1.5" />
        <circle r="29" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.5" />
        <circle className="bm-accent-fill" r="3.5" stroke="none" />
        <line
          x1="0"
          y1="-56"
          x2="0"
          y2="-48"
          stroke="currentColor"
          strokeOpacity="0.5"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <line
          x1="0"
          y1="48"
          x2="0"
          y2="56"
          stroke="currentColor"
          strokeOpacity="0.5"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <line
          x1="-56"
          y1="0"
          x2="-48"
          y2="0"
          stroke="currentColor"
          strokeOpacity="0.5"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <line
          x1="48"
          y1="0"
          x2="56"
          y2="0"
          stroke="currentColor"
          strokeOpacity="0.5"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </g>

      <g className="bm-verdict-cards">
        {/* Same split-transform reasoning as the chip stream above: each
            card's position is a static, CSS-untouched outer <g>; the
            animated `.bm-card` is a plain inner child. */}
        <g transform="translate(10, 236)">
          <g className="bm-card">
            <rect className="bm-accent-fill" width="174" height="100" rx="12" />
            <text x="16" y="32" className="bm-accent-ink-fill" fontSize="16" fontWeight="600">
              Strong fit
            </text>
            <text
              x="16"
              y="70"
              className="bm-mono bm-accent-ink-fill"
              fontSize="28"
              fontWeight="700"
            >
              3
            </text>
            {/* Solid, not opacity-reduced: at 75% opacity this measured
                3.55:1 against the accent fill in the light theme (below
                the 4.5:1 small-text floor — WCAG 1.4.3, `--accent-ink` on
                `--accent`). Full opacity restores the ≥5:1 the token pair
                already carries everywhere else it's used (e.g. `.cta`). */}
            <text x="16" y="90" className="bm-accent-ink-fill" fontSize="12">
              of 9 notices
            </text>
          </g>
        </g>

        <g transform="translate(193, 236)">
          <g className="bm-card">
            <rect className="bm-accent-tint" width="174" height="100" rx="12" />
            <rect
              className="bm-accent-line"
              width="174"
              height="100"
              rx="12"
              fill="none"
              strokeWidth="1.5"
            />
            <text x="16" y="32" className="bm-accent-text" fontSize="16" fontWeight="600">
              Worth reviewing
            </text>
            <text x="16" y="70" className="bm-mono bm-accent-text" fontSize="28" fontWeight="700">
              4
            </text>
            {/* `bm-accent-text`, not `bm-ink3-fill`: ink-3 is calibrated
                against opaque neutral surfaces (see base.css's own axe
                comment on that token), not the translucent `accent-tint`
                wash this card's background actually is — measured 3.87:1
                in the dark theme, below the 4.5:1 small-text floor.
                `accent-text` is the same pairing `.score-badge--worth-
                reviewing` already uses on this exact background
                (`--fit-review-ink`/`--fit-review-tint`) and clears ≥9:1. */}
            <text x="16" y="90" className="bm-accent-text" fontSize="12">
              of 9 notices
            </text>
          </g>
        </g>

        <g transform="translate(376, 236)">
          <g className="bm-card">
            <rect className="bm-surface-fill" width="174" height="100" rx="12" />
            <rect
              className="bm-line-stroke"
              width="174"
              height="100"
              rx="12"
              fill="none"
              strokeWidth="1.5"
            />
            <text x="16" y="32" fill="currentColor" opacity="0.85" fontSize="16" fontWeight="600">
              Possible
            </text>
            <text
              x="16"
              y="70"
              className="bm-mono"
              fill="currentColor"
              fontSize="28"
              fontWeight="700"
            >
              2
            </text>
            <text x="16" y="90" className="bm-ink3-fill" fontSize="12">
              of 9 notices
            </text>
          </g>
        </g>
      </g>

      <text
        x="280"
        y="352"
        textAnchor="middle"
        className="bm-mono bm-ink3-fill"
        fontSize="11"
        letterSpacing="0.06em"
      >
        ILLUSTRATIVE EXAMPLE — NOT LIVE DATA
      </text>
    </svg>
  );
}
