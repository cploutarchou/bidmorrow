/**
 * Human-readable explanation rendering. docs/matching-engine.md §Explanation
 * rendering — output format is table-exact for the worked example.
 */
import type { MatchResult, RiskFlag, RiskFlagType, ScoredResult } from './types';

function formatPoints(points: number): string {
  const sign = points >= 0 ? '+' : '';
  // Half-points render as e.g. "2.5"; whole points render without a decimal.
  const magnitude = Number.isInteger(points) ? String(points) : points.toFixed(1);
  return `${sign}${magnitude}`;
}

const GENERIC_TITLE: Record<RiskFlagType, string> = {
  certification: 'A certification',
  security_clearance: 'Security clearance',
  insurance: 'Insurance',
  financial_turnover: 'A minimum turnover',
  prior_experience: 'Prior experience',
  framework_membership: 'Framework membership',
  local_presence: 'Local presence',
  mandatory_references: 'References',
};

const CERT_TOKEN_PATTERN = /\biso(?:\/iec)?\s?(\d{4,5})\b|\ben\s?iso\s?(\d{4,5})\b|\b(soc\s?2)\b/iu;

/** Extract a short, specific subject (e.g. "ISO 27001") from a risk flag's evidence when possible. */
function subjectFor(flag: RiskFlag): string {
  if (flag.type === 'certification') {
    const match = CERT_TOKEN_PATTERN.exec(flag.evidence);
    if (match !== null) {
      if (match[1] !== undefined) return `ISO ${match[1]}`;
      if (match[2] !== undefined) return `EN ISO ${match[2]}`;
      if (match[3] !== undefined) return 'SOC 2';
    }
  }
  return GENERIC_TITLE[flag.type];
}

function renderRiskFlagLine(flag: RiskFlag): string {
  const subject = subjectFor(flag);
  const verb = flag.confidence === 'HIGH' ? 'is required' : 'may be required';
  return ` ⚠ ${subject} ${verb} — "${flag.evidence}" (${flag.confidence}) — verify in source documents`;
}

function renderScored(result: ScoredResult): string {
  const lines: string[] = [];
  const roundedScore = Number.isInteger(result.score)
    ? String(result.score)
    : result.score.toFixed(1);
  lines.push(`${roundedScore} / 100 — ${result.classification}        engine v1`);
  lines.push('');
  for (const component of result.components) {
    const label = formatPoints(component.points).padStart(5, ' ');
    lines.push(`${label}  ${component.explanation}`);
  }

  if (result.riskFlags.length > 0) {
    lines.push('');
    lines.push('Risk flags:');
    for (const flag of result.riskFlags) {
      lines.push(renderRiskFlagLine(flag));
    }
  }
  return lines.join('\n').trimEnd();
}

/** Render a `MatchResult` as the human-readable breakdown text. */
export function renderExplanation(result: MatchResult): string {
  if (result.kind === 'excluded') {
    return `EXCLUDED — rule: ${result.rule}, evidence: ${result.evidence}`;
  }
  return renderScored(result);
}
