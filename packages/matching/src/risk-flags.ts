/**
 * Risk-flag detection. docs/matching-engine.md §Risk flags.
 *
 * Deterministic, conservative pattern detection over matchable-language
 * text plus language-independent tokens (ISO/EN standard numbers, currency
 * amounts near turnover terms). English pattern set + a small reviewed
 * multilingual set for tokens that are inherently language-independent
 * (standard numbers). No machine translation, no stemming.
 *
 * ReDoS safety: every pattern below is linear-time (no nested quantifiers,
 * no catastrophic backtracking shapes) and every scan target is capped by
 * `capForScan` before matching.
 */
import { capForScan, MAX_SCAN_CHARS } from './text';
import type { LotInput, RiskFlag, RiskFlagType } from './types';

const EVIDENCE_MAX_CHARS = 200;

interface FieldSource {
  readonly text: string;
  readonly fieldPath: string;
}

/** All language-independent-relevant fields the risk scanner looks at. */
function fieldSources(lot: LotInput): readonly FieldSource[] {
  const sources: FieldSource[] = [];
  for (const [lang, text] of Object.entries(lot.titleByLang).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    sources.push({ text: capForScan(text), fieldPath: `lot.titleByLang.${lang}` });
  }
  for (const [lang, text] of Object.entries(lot.descriptionByLang).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    sources.push({ text: capForScan(text), fieldPath: `lot.descriptionByLang.${lang}` });
  }
  return sources;
}

function quoteEvidence(raw: string, matchIndex: number, matchLength: number): string {
  const contextRadius = 80;
  const start = Math.max(0, matchIndex - contextRadius);
  const end = Math.min(raw.length, matchIndex + matchLength + contextRadius);
  const snippet = raw.slice(start, end).trim();
  return snippet.length > EVIDENCE_MAX_CHARS
    ? `${snippet.slice(0, EVIDENCE_MAX_CHARS - 1)}…`
    : snippet;
}

function possibleExplanation(): string {
  return 'Possible requirement detected — verify in source documents.';
}

function highExplanation(): string {
  return 'Requirement detected in source text — verify against source documents.';
}

interface PatternRule {
  readonly type: RiskFlagType;
  readonly pattern: RegExp;
  readonly confidence: 'HIGH' | 'POSSIBLE';
  readonly summary: string;
}

// Requirement-indicating verbs (English) used to lift a token match from
// POSSIBLE to HIGH confidence when they co-occur nearby.
const REQUIREMENT_VERB = 'must|shall|required|require[sd]?|mandatory|obligat(?:ory|ion)';

const RULES: readonly PatternRule[] = [
  // Certification: ISO/EN standard numbers are language-independent tokens.
  {
    type: 'certification',
    pattern: new RegExp(
      `(?:${REQUIREMENT_VERB})[^.\\n]{0,60}\\b(?:iso(?:\\/iec)?\\s?\\d{4,5}|en\\s?iso\\s?\\d{4,5})\\b`,
      'iu',
    ),
    confidence: 'HIGH',
    summary: 'ISO/EN certification requirement',
  },
  {
    type: 'certification',
    pattern: /\b(?:iso(?:\/iec)?\s?\d{4,5}|en\s?iso\s?\d{4,5}|soc\s?2)\b/iu,
    confidence: 'POSSIBLE',
    summary: 'ISO/EN certification mention',
  },
  // Security clearance.
  {
    type: 'security_clearance',
    pattern:
      /\bsecurity\s+clearance\b|\bvetting\b|\bnato\s+secret\b|\bconfidentiel\s+d[ée]fense\b/iu,
    confidence: 'POSSIBLE',
    summary: 'Security clearance mention',
  },
  {
    type: 'security_clearance',
    pattern: new RegExp(`(?:${REQUIREMENT_VERB})[^.\\n]{0,60}\\bsecurity\\s+clearance\\b`, 'iu'),
    confidence: 'HIGH',
    summary: 'Security clearance requirement',
  },
  // Insurance.
  {
    type: 'insurance',
    pattern: new RegExp(
      `(?:${REQUIREMENT_VERB})[^.\\n]{0,60}\\b(?:professional\\s+indemnity|liability)\\s+insurance\\b`,
      'iu',
    ),
    confidence: 'HIGH',
    summary: 'Insurance requirement',
  },
  {
    type: 'insurance',
    pattern: /\b(?:professional\s+indemnity|liability)\s+insurance\b/iu,
    confidence: 'POSSIBLE',
    summary: 'Insurance mention',
  },
  // Financial turnover: currency amount near "turnover"/"annual turnover".
  {
    type: 'financial_turnover',
    pattern: /\b(?:annual\s+)?turnover\b[^.\n]{0,40}?[€$£]\s?\d[\d.,]*(?:\s?(?:million|m|k))?/iu,
    confidence: 'HIGH',
    summary: 'Minimum annual turnover requirement',
  },
  {
    type: 'financial_turnover',
    pattern: /[€$£]\s?\d[\d.,]*(?:\s?(?:million|m|k))?[^.\n]{0,40}?\b(?:annual\s+)?turnover\b/iu,
    confidence: 'HIGH',
    summary: 'Minimum annual turnover requirement',
  },
  {
    type: 'financial_turnover',
    pattern: /\b(?:annual\s+)?turnover\b/iu,
    confidence: 'POSSIBLE',
    summary: 'Turnover mention',
  },
  // Prior experience.
  {
    type: 'prior_experience',
    pattern: new RegExp(
      `(?:${REQUIREMENT_VERB})[^.\\n]{0,60}\\b(?:prior|previous|relevant)\\s+experience\\b`,
      'iu',
    ),
    confidence: 'HIGH',
    summary: 'Prior experience requirement',
  },
  {
    type: 'prior_experience',
    pattern: /\b(?:prior|previous|relevant)\s+experience\b/iu,
    confidence: 'POSSIBLE',
    summary: 'Prior experience mention',
  },
  // Framework membership.
  {
    type: 'framework_membership',
    pattern: /\bframework\s+(?:agreement|membership)\b/iu,
    confidence: 'POSSIBLE',
    summary: 'Framework agreement mention',
  },
  {
    type: 'framework_membership',
    pattern: new RegExp(
      `(?:${REQUIREMENT_VERB})[^.\\n]{0,60}\\bframework\\s+(?:agreement|membership)\\b`,
      'iu',
    ),
    confidence: 'HIGH',
    summary: 'Framework membership requirement',
  },
  // Local presence.
  {
    type: 'local_presence',
    pattern: new RegExp(
      `(?:${REQUIREMENT_VERB})[^.\\n]{0,60}\\blocal\\s+(?:presence|office|establishment)\\b`,
      'iu',
    ),
    confidence: 'HIGH',
    summary: 'Local presence requirement',
  },
  {
    type: 'local_presence',
    pattern: /\blocal\s+(?:presence|office|establishment)\b/iu,
    confidence: 'POSSIBLE',
    summary: 'Local presence mention',
  },
  // Mandatory references.
  {
    type: 'mandatory_references',
    pattern: new RegExp(`(?:${REQUIREMENT_VERB})[^.\\n]{0,60}\\breferences?\\b`, 'iu'),
    confidence: 'HIGH',
    summary: 'Reference requirement',
  },
  {
    type: 'mandatory_references',
    pattern: /\b(?:client\s+)?references?\b(?:\s+(?:from|of)\s+(?:similar|previous))?/iu,
    confidence: 'POSSIBLE',
    summary: 'References mention',
  },
];

/**
 * Detect risk flags across the lot's matchable text. At most one flag per
 * (type, confidence-tier) is emitted per field to keep output bounded and
 * deterministic; when both a HIGH and POSSIBLE pattern would fire for the
 * same type on the same field, only the HIGH one is kept (it is strictly
 * more specific/confident evidence).
 */
export function detectRiskFlags(lot: LotInput): readonly RiskFlag[] {
  const sources = fieldSources(lot);
  const flags: RiskFlag[] = [];
  const seenTypesByField = new Map<string, Set<RiskFlagType>>();

  for (const source of sources) {
    const capped = source.text.slice(0, MAX_SCAN_CHARS);
    const seen = seenTypesByField.get(source.fieldPath) ?? new Set<RiskFlagType>();
    seenTypesByField.set(source.fieldPath, seen);

    // HIGH-confidence rules first so they win over POSSIBLE for the same type/field.
    const ordered = [...RULES].sort((a, b) =>
      a.confidence === b.confidence ? 0 : a.confidence === 'HIGH' ? -1 : 1,
    );
    for (const rule of ordered) {
      if (seen.has(rule.type)) {
        continue;
      }
      const match = rule.pattern.exec(capped);
      if (match === null) {
        continue;
      }
      seen.add(rule.type);
      const evidence = quoteEvidence(capped, match.index, match[0].length);
      flags.push({
        type: rule.type,
        evidence,
        sourceField: source.fieldPath,
        confidence: rule.confidence,
        explanation: rule.confidence === 'HIGH' ? highExplanation() : possibleExplanation(),
      });
    }
  }

  return flags;
}
