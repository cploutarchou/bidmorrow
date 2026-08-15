/**
 * Hard exclusions. docs/matching-engine.md §Hard exclusions.
 *
 * Applied only on KNOWN values — an unknown field never hard-excludes. Rule
 * order matches the spec's numbered list; the first firing rule wins (a lot
 * can only carry one exclusion evidence at a time).
 */
import { capForScan, containsWholeTerm, matchableCorpus } from './text';
import { DEFAULT_MATCHABLE_LANGUAGES } from './components/capability';
import type { ExcludedResult, LotInput, OrgProfile } from './types';

export function evaluateExclusions(
  lot: LotInput,
  org: OrgProfile,
  scoringTime: number,
): ExcludedResult | null {
  // 1. Geography.
  for (const country of lot.countries) {
    if (org.exclusions.countries.includes(country.toUpperCase())) {
      return { kind: 'excluded', rule: 'excluded_geography', evidence: country.toUpperCase() };
    }
  }
  for (const nuts of lot.nuts) {
    const matchedPrefix = org.exclusions.nutsPrefixes.find((prefix) =>
      nuts.toUpperCase().startsWith(prefix.toUpperCase()),
    );
    if (matchedPrefix !== undefined) {
      return { kind: 'excluded', rule: 'excluded_geography', evidence: nuts.toUpperCase() };
    }
  }

  // 2. CPV family (prefix match), main + additional.
  const lotCpvCodes = [lot.cpv.main, ...lot.cpv.additional];
  for (const code of lotCpvCodes) {
    const matchedFamily = org.exclusions.cpvFamilies.find((prefix) => code.startsWith(prefix));
    if (matchedFamily !== undefined) {
      return { kind: 'excluded', rule: 'excluded_cpv', evidence: code };
    }
  }

  // 3. Excluded phrase in matchable-language text.
  if (org.exclusions.phrases.length > 0) {
    const corpus = capForScan(
      `${matchableCorpus(lot.titleByLang, DEFAULT_MATCHABLE_LANGUAGES)}\n${matchableCorpus(
        lot.descriptionByLang,
        DEFAULT_MATCHABLE_LANGUAGES,
      )}`,
    );
    for (const phrase of org.exclusions.phrases) {
      if (containsWholeTerm(corpus, phrase)) {
        return { kind: 'excluded', rule: 'excluded_phrase', evidence: phrase };
      }
    }
  }

  // 4. Unsupported contract nature (explicitly marked unsupported).
  if (lot.contractNature !== null && org.exclusions.contractNatures.includes(lot.contractNature)) {
    return { kind: 'excluded', rule: 'unsupported_nature', evidence: lot.contractNature };
  }

  // 5. Deadline runway below threshold — only when BOTH are known.
  if (lot.deadlineAt !== null && org.minimumDaysRemaining !== undefined) {
    const days = (lot.deadlineAt - scoringTime) / 86_400_000;
    if (days < org.minimumDaysRemaining) {
      return {
        kind: 'excluded',
        rule: 'deadline_below_threshold',
        evidence: new Date(lot.deadlineAt).toISOString(),
      };
    }
  }

  return null;
}
