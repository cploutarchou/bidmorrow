/**
 * CPV fit (35 pts) — hierarchical gradient. docs/matching-engine.md §CPV fit.
 *
 * CPV codes here are 8-digit strings (check digit already stripped, per
 * `company_cpv_preferences`). Hierarchy = leading-digit prefix length:
 * division (2), group (3), class (4), category (5+), exact (8/full match).
 */
import { COMPONENT_MAX } from '../index';
import type { ComponentResult, LotCpv, OrgProfile } from '../types';

const TABLE = { exact: 35, category: 31, class: 27, group: 21, division: 12, none: 0 } as const;
const MULTI_MATCH_BONUS = 2;
const ADDITIONAL_CPV_FACTOR = 0.85;

interface Level {
  readonly points: number;
  readonly label: string;
  /** Shared prefix used in the explanation, e.g. `7215`. */
  readonly sharedPrefix: string;
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) {
    i += 1;
  }
  return i;
}

function levelFor(lotCode: string, orgCode: string): Level {
  if (lotCode === orgCode) {
    return { points: TABLE.exact, label: 'exact match', sharedPrefix: lotCode };
  }
  const len = commonPrefixLength(lotCode, orgCode);
  if (len >= 5) {
    return { points: TABLE.category, label: 'same category', sharedPrefix: lotCode.slice(0, 5) };
  }
  if (len >= 4) {
    return { points: TABLE.class, label: 'same class', sharedPrefix: lotCode.slice(0, 4) };
  }
  if (len >= 3) {
    return { points: TABLE.group, label: 'same group', sharedPrefix: lotCode.slice(0, 3) };
  }
  if (len >= 2) {
    return {
      points: TABLE.division,
      label: 'same division',
      sharedPrefix: lotCode.slice(0, 2),
    };
  }
  return { points: TABLE.none, label: 'no relationship', sharedPrefix: '' };
}

/** Round half up (ties away from zero), matching the spec's "rounded half up". */
function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

interface Candidate {
  readonly points: number;
  readonly level: Level;
  readonly lotCode: string;
  readonly orgCode: string;
  readonly isAdditional: boolean;
}

export function scoreCpv(lotCpv: LotCpv, org: OrgProfile): ComponentResult {
  const maxPoints = COMPONENT_MAX.cpv;
  if (org.cpvPreferences.length === 0) {
    return {
      key: 'cpv',
      points: 0,
      maxPoints,
      status: 'NO_MATCH',
      explanation: 'No CPV preferences configured, so no relationship to the lot CPV.',
    };
  }

  const candidates: Candidate[] = [];
  for (const orgCode of org.cpvPreferences) {
    const mainLevel = levelFor(lotCpv.main, orgCode);
    candidates.push({
      points: mainLevel.points,
      level: mainLevel,
      lotCode: lotCpv.main,
      orgCode,
      isAdditional: false,
    });
    for (const additional of lotCpv.additional) {
      const level = levelFor(additional, orgCode);
      candidates.push({
        points: roundHalfUp(level.points * ADDITIONAL_CPV_FACTOR),
        level,
        lotCode: additional,
        orgCode,
        isAdditional: true,
      });
    }
  }

  let best = candidates[0] as Candidate;
  for (const candidate of candidates) {
    if (candidate.points > best.points) {
      best = candidate;
    }
  }

  // Bonus: >=2 distinct org preferences match at class level or better,
  // across ANY lot CPV (main or additional), using the un-reduced level.
  const qualifyingPrefs = new Set<string>();
  for (const orgCode of org.cpvPreferences) {
    const bestForPref = Math.max(
      levelFor(lotCpv.main, orgCode).points,
      ...lotCpv.additional.map((code) => levelFor(code, orgCode).points),
    );
    if (bestForPref >= TABLE.class) {
      qualifyingPrefs.add(orgCode);
    }
  }
  const bonus = qualifyingPrefs.size >= 2 ? MULTI_MATCH_BONUS : 0;
  const points = Math.min(maxPoints, best.points + bonus);

  const status = points > 0 ? 'MATCHED' : 'NO_MATCH';
  const kindLabel = best.isAdditional ? ' (additional CPV)' : '';
  const relationshipText =
    best.level.label === 'no relationship'
      ? 'no relationship to any of your CPV preferences'
      : `${best.level.label} (${best.level.sharedPrefix})`;
  const bonusText = bonus > 0 ? ` +${String(bonus)} for multiple independent matches` : '';
  const explanation =
    best.level.label === 'no relationship'
      ? `CPV: lot ${lotCpv.main} has no relationship to your CPV preferences.`
      : `CPV: lot ${best.lotCode}${kindLabel} vs your preference ${best.orgCode}, ${relationshipText}${bonusText}`;

  return { key: 'cpv', points, maxPoints, status, explanation };
}
