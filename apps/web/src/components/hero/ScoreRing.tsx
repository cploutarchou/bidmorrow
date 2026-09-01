import type { ReactElement } from 'react';

/**
 * Score ring: a track circle and a value arc drawn with `pathLength="100"`,
 * so `stroke-dasharray` is expressed directly in score points out of 100.
 *
 * Three modes:
 * - `static` (default): the arc is set from `value` as an SVG attribute,
 *   nothing moves; used wherever a score is simply displayed.
 * - `draw`: same attribute as the no-script baseline, plus the value is
 *   written to `--de-target` through the CSSOM so the stylesheet can draw
 *   the arc from 0 once, when the surrounding section reveals
 *   (`styles/hero.css`, `.score-ring--draw`). Reduced motion shows it
 *   drawn.
 * - `engine`: the arc reads the animated `--de-value` custom property from
 *   the hero's cycle, so the decision-engine visual can draw it in step
 *   with its count-up without any inline style.
 *
 * Decorative by contract: the number next to it (or the parent's
 * `role="img"` label) carries the meaning, so the SVG is `aria-hidden`.
 */
export function ScoreRing({
  value,
  mode = 'static',
  className,
}: {
  readonly value: number;
  readonly mode?: 'static' | 'engine' | 'draw';
  readonly className?: string;
}): ReactElement {
  const bounded = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <svg
      className={['score-ring', mode === 'static' ? '' : `score-ring--${mode}`, className]
        .filter(Boolean)
        .join(' ')}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      ref={
        mode === 'draw'
          ? (el) => {
              el?.style.setProperty('--de-target', String(bounded));
            }
          : undefined
      }
    >
      <circle className="score-ring__track" cx="24" cy="24" r="20" pathLength="100" />
      <circle
        className="score-ring__value"
        cx="24"
        cy="24"
        r="20"
        pathLength="100"
        strokeDasharray={mode === 'engine' ? undefined : `${String(bounded)} 100`}
        transform="rotate(-90 24 24)"
      />
    </svg>
  );
}
