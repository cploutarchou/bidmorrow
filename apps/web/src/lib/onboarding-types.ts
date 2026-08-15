import type { PresetKey } from '@bidmorrow/domain';

export interface CompanyProfileDto {
  id: string;
  organizationId: string;
  displayName: string | null;
  description: string | null;
  website: string | null;
  employeeBand: string | null;
  presetKey: string | null;
  onboardingCompletedAt: number | null;
}

export interface MatchingPreferencesDto {
  id: string;
  organizationId: string;
  minValueEur: number | null;
  maxValueEur: number | null;
  supportedContractNaturesJson: string;
  minimumDaysRemaining: number | null;
}

/** Raw D1 row shape — `enabled`/`sendEmpty` are stored as INTEGER 0/1. */
export interface DigestPreferencesDto {
  id: string;
  organizationId: string;
  enabled: 0 | 1;
  sendEmpty: 0 | 1;
  minClassification: string;
  timezone: string;
}

export interface OrgProfileResponse {
  profile: CompanyProfileDto | null;
  matching: MatchingPreferencesDto | null;
  digest: DigestPreferencesDto | null;
}

export interface KeywordDto {
  kind: 'positive' | 'synonym';
  term: string;
  synonymGroup: string | null;
  language: string | null;
}

export interface GeographyDto {
  kind: 'preferred_nuts' | 'opportunity_country' | 'country_served';
  code: string;
}

export interface ExclusionDto {
  kind: 'cpv_family' | 'country' | 'nuts' | 'phrase' | 'contract_nature';
  value: string;
}

/** Matches `packages/db` `CertificationCode` — kept as a local literal union
 * since `apps/web` depends only on `@bidmorrow/domain`, not `@bidmorrow/db`. */
export type CertificationCode = 'ISO_27001' | 'ISO_9001' | 'SOC2' | 'OTHER';

export const CERTIFICATION_CODES: readonly CertificationCode[] = [
  'ISO_27001',
  'ISO_9001',
  'SOC2',
  'OTHER',
];

export interface CertificationDto {
  certificationCode: CertificationCode;
  label: string | null;
}

export type { PresetKey };
