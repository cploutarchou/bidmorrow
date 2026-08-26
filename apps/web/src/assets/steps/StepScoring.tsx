import type { ReactElement } from 'react';
import '../../styles/illustrations.css';

/**
 * "How it works" step 3 — deterministic scoring: weighted bars sum to
 * one score. Deliberately abstract (unlabelled bars, round numbers) —
 * a stylized illustration of "how scoring works," not a rendering of
 * the real weighting scheme (that lives in the actual product UI and
 * docs/matching-engine.md's worked example). Decorative, same
 * convention as `StepSource.tsx`.
 *
 * viewBox 320×200. Source ~1.3 KB.
 */
export function StepScoring({ className }: { className?: string }): ReactElement {
  const bars: Array<{ y: number; w: number; label: string }> = [
    { y: 44, w: 96, label: '+24' },
    { y: 68, w: 76, label: '+18' },
    { y: 92, w: 58, label: '+14' },
    { y: 116, w: 38, label: '+9' },
  ];

  return (
    <svg
      className={['bm-illust', className].filter(Boolean).join(' ')}
      viewBox="0 0 320 200"
      fill="none"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="0"
        y="0"
        width="320"
        height="200"
        rx="14"
        className="bm-surface-fill"
        opacity="0.35"
      />

      <rect
        x="60"
        y="24"
        width="200"
        height="152"
        rx="12"
        className="bm-surface-fill"
        stroke="currentColor"
        strokeOpacity="0.6"
        strokeWidth="1.5"
      />

      <text x="78" y="40" className="bm-mono bm-ink3-fill" fontSize="9" letterSpacing="0.08em">
        SCORING
      </text>

      <g stroke="currentColor" strokeWidth="1.5">
        {bars.map((bar) => (
          <g key={bar.y}>
            <rect x="78" y={bar.y} width="144" height="6" rx="3" fill="none" strokeOpacity="0.25" />
            <rect
              x="78"
              y={bar.y}
              width={bar.w}
              height="6"
              rx="3"
              className="bm-accent-fill"
              stroke="none"
            />
            <text
              x="228"
              y={bar.y + 5.5}
              className="bm-mono"
              fontSize="9"
              fill="currentColor"
              opacity="0.75"
            >
              {bar.label}
            </text>
          </g>
        ))}
      </g>

      <line x1="78" y1="140" x2="238" y2="140" stroke="currentColor" strokeOpacity="0.15" />

      <text x="78" y="158" className="bm-mono bm-ink3-fill" fontSize="9" letterSpacing="0.04em">
        SCORE
      </text>
      <text
        x="196"
        y="160"
        className="bm-mono bm-accent-text"
        fontSize="16"
        fontWeight="700"
        textAnchor="end"
      >
        65
      </text>
    </svg>
  );
}
