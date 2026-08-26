import type { ReactElement } from 'react';
import '../../styles/illustrations.css';

/**
 * "How it works" step 2 — the company profile: CPV codes + keyword
 * chips the matching engine scores every notice against. Decorative,
 * same convention as `StepSource.tsx`.
 *
 * viewBox 320×200. Source ~1.5 KB.
 */
export function StepProfile({ className }: { className?: string }): ReactElement {
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

      <g stroke="currentColor" strokeWidth="1.5">
        <rect
          x="60"
          y="26"
          width="200"
          height="148"
          rx="12"
          className="bm-surface-fill"
          strokeOpacity="0.6"
        />

        <rect
          x="80"
          y="44"
          width="34"
          height="34"
          rx="8"
          className="bm-accent-tint"
          stroke="none"
        />
        <path
          d="M90 68 L90 54 L98 54 L98 68 M90 60 L98 60"
          className="bm-accent-stroke"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line x1="122" y1="52" x2="188" y2="52" strokeOpacity="0.5" strokeLinecap="round" />
        <line x1="122" y1="66" x2="164" y2="66" strokeOpacity="0.3" strokeLinecap="round" />

        <line x1="80" y1="94" x2="240" y2="94" strokeOpacity="0.15" />

        <g className="bm-mono" fontSize="9" fontWeight="600" strokeWidth="1.3">
          <rect
            x="80"
            y="108"
            width="52"
            height="20"
            rx="10"
            className="bm-accent-tint"
            stroke="none"
          />
          <text x="88" y="121.5" className="bm-accent-text">
            72xxx
          </text>

          <rect x="138" y="108" width="70" height="20" rx="10" fill="none" strokeOpacity="0.5" />
          <text x="146" y="121.5" fill="currentColor" opacity="0.75">
            IT services
          </text>

          <rect x="80" y="136" width="40" height="20" rx="10" fill="none" strokeOpacity="0.5" />
          <text x="88" y="149.5" fill="currentColor" opacity="0.75">
            EU
          </text>

          <rect x="126" y="136" width="82" height="20" rx="10" fill="none" strokeOpacity="0.5" />
          <text x="134" y="149.5" fill="currentColor" opacity="0.75">
            cloud infra
          </text>
        </g>
      </g>
    </svg>
  );
}
