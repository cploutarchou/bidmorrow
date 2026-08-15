/**
 * Capability/keyword fit (20 pts). docs/matching-engine.md §Capability/keyword
 * fit. Matchable languages = the languages the org's own keyword terms were
 * entered in, plus English always (V1 default matchable set: `eng` + any
 * language the org used). This is an interpretation of "practically English
 * + any language the customer entered keywords in" from the spec, since org
 * keyword terms don't carry a language tag in this package's input shape —
 * stage B is responsible for restricting `matchableLanguages` further if it
 * tracks per-term language.
 */
import { COMPONENT_MAX } from '../index';
import { capForScan, containsWholeTerm, isPhrase, matchableCorpus } from '../text';
import type { ComponentResult, LotInput, OrgProfile } from '../types';

const PHRASE_POINTS = 4;
const WORD_POINTS = 2;
const SYNONYM_GROUP_POINTS = 3;

/** Default matchable language set: English is always matchable. */
export const DEFAULT_MATCHABLE_LANGUAGES: ReadonlySet<string> = new Set(['eng']);

export interface CapabilityScoreResult {
  readonly component: ComponentResult;
  /** Set when the lot had no matchable-language text at all. */
  readonly sourceLanguageIndicator?: string;
}

export function scoreCapability(lot: LotInput, org: OrgProfile): CapabilityScoreResult {
  const maxPoints = COMPONENT_MAX.capability;
  const corpus = capForScan(
    `${matchableCorpus(lot.titleByLang, DEFAULT_MATCHABLE_LANGUAGES)}\n${matchableCorpus(
      lot.descriptionByLang,
      DEFAULT_MATCHABLE_LANGUAGES,
    )}`,
  ).trim();

  if (corpus.length === 0) {
    const availableLang = [...lot.languages].sort()[0] ?? 'unknown';
    const points = maxPoints * 0.5;
    return {
      component: {
        key: 'capability',
        points,
        maxPoints,
        status: 'UNKNOWN',
        explanation: `No matchable-language text on this lot (source language: ${availableLang}) — neutral score applied.`,
      },
      sourceLanguageIndicator: `source language: ${availableLang} — keyword matching limited`,
    };
  }

  // Term specificity applies uniformly to positive keywords and free-text
  // capability labels (spec: "Inputs: org keywords, synonym groups,
  // capabilities" — no separate scoring rule for capabilities, so they are
  // folded into the same phrase/word vocabulary, de-duplicated by term).
  const allTerms = [...new Set([...org.keywords.positiveTerms, ...org.capabilities])];
  const phraseHits: string[] = [];
  const wordHits: string[] = [];
  for (const term of allTerms) {
    if (!containsWholeTerm(corpus, term)) {
      continue;
    }
    if (isPhrase(term)) {
      phraseHits.push(term);
    } else {
      wordHits.push(term);
    }
  }

  const synonymGroupHits: string[] = [];
  for (const group of org.keywords.synonymGroups) {
    const hit = group.terms.some((term) => containsWholeTerm(corpus, term));
    if (hit) {
      synonymGroupHits.push(group.label);
    }
  }

  const rawPoints =
    phraseHits.length * PHRASE_POINTS +
    wordHits.length * WORD_POINTS +
    synonymGroupHits.length * SYNONYM_GROUP_POINTS;
  const points = Math.min(maxPoints, rawPoints);

  if (phraseHits.length === 0 && wordHits.length === 0 && synonymGroupHits.length === 0) {
    return {
      component: {
        key: 'capability',
        points: 0,
        maxPoints,
        status: 'NO_MATCH',
        explanation:
          'Capabilities: no configured keyword, synonym group, or capability term found in the lot text.',
      },
    };
  }

  const parts: string[] = [];
  if (phraseHits.length > 0) {
    parts.push(`phrases ${phraseHits.map((p) => `"${p}" (+${String(PHRASE_POINTS)})`).join(', ')}`);
  }
  if (synonymGroupHits.length > 0) {
    parts.push(
      synonymGroupHits
        .map((g) => `synonym group "${g}" (+${String(SYNONYM_GROUP_POINTS)})`)
        .join(', '),
    );
  }
  if (wordHits.length > 0) {
    parts.push(`words ${wordHits.map((w) => `"${w}" (+${String(WORD_POINTS)})`).join(', ')}`);
  }

  return {
    component: {
      key: 'capability',
      points,
      maxPoints,
      status: points >= maxPoints ? 'MATCHED' : 'PARTIAL',
      explanation: `Capabilities: ${parts.join(', ')}`,
    },
  };
}
