/**
 * Shared test-only fixtures for building minimal-but-valid `EngineInput`
 * values. Not exported from the package's public entry point.
 */
import type { EngineInput, LotInput, OrgProfile } from './types';

export const T0 = Date.parse('2026-08-15T00:00:00Z');

export function baseOrg(overrides: Partial<OrgProfile> = {}): OrgProfile {
  return {
    cpvPreferences: [],
    keywords: { positiveTerms: [], synonymGroups: [] },
    capabilities: [],
    certifications: [],
    geographies: { preferredNuts: [], opportunityCountries: [], countriesServed: [] },
    exclusions: {
      cpvFamilies: [],
      countries: [],
      nutsPrefixes: [],
      phrases: [],
      contractNatures: [],
    },
    valueRange: {},
    supportedContractNatures: [],
    matchableLanguages: [],
    ...overrides,
  };
}

export function baseLot(overrides: Partial<LotInput> = {}): LotInput {
  return {
    cpv: { main: '72000000', additional: [] },
    titleByLang: {},
    descriptionByLang: {},
    countries: [],
    nuts: [],
    valueEur: null,
    originalCurrency: null,
    valueIsDerived: false,
    deadlineAt: null,
    buyerLegalType: null,
    procedureType: null,
    contractNature: null,
    languages: [],
    ...overrides,
  };
}

export function baseInput(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    org: baseOrg(),
    lot: baseLot(),
    scoringTime: T0,
    ...overrides,
  };
}
