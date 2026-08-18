/**
 * Onboarding preset profiles (docs/product-scope.md "3-5 editable preset
 * profiles" to defeat the empty-CPV-picker cold start; docs/matching-
 * engine.md CPV pre-filter). Static, versionless product content — every
 * field is a starting point the customer edits after applying it; nothing
 * here is hidden behavior. CPV codes are chosen to fall within/near the V1
 * ingestion scope (docs/ted-ingestion-scope.md: `72*`, `48*`, `79417000`) so
 * a customer who applies a preset unmodified does not immediately trip the
 * onboarding scope-overlap warning.
 */

export type PresetKey = 'cyber_consultancy' | 'cloud_devops' | 'software_house' | 'it_generalist';

export interface PresetKeyword {
  readonly kind: 'positive' | 'synonym';
  readonly term: string;
  /** Required for `kind: 'synonym'` — groups terms the engine counts once each. */
  readonly synonymGroup?: string;
  /** BCP-47; omit for language-agnostic terms. */
  readonly language?: string;
}

export interface CompanyPreset {
  readonly key: PresetKey;
  readonly label: string;
  readonly description: string;
  /** 8-digit CPV codes (within/near the default ingestion scope). */
  readonly cpvCodes: readonly string[];
  readonly capabilities: readonly string[];
  readonly keywords: readonly PresetKeyword[];
}

export const COMPANY_PRESETS: readonly CompanyPreset[] = [
  {
    key: 'cyber_consultancy',
    label: 'Cybersecurity consultancy',
    description:
      'Security assessments, penetration testing, ISO 27001 / compliance advisory, and safety-adjacent consultancy for public-sector buyers.',
    cpvCodes: ['79417000', '72222300', '72220000', '48730000'],
    capabilities: [
      'Penetration testing',
      'Security assessment',
      'ISO 27001 advisory',
      'Incident response',
      'Security operations centre (SOC) services',
    ],
    keywords: [
      { kind: 'positive', term: 'penetration testing', language: 'en' },
      { kind: 'positive', term: 'security assessment', language: 'en' },
      { kind: 'positive', term: 'vulnerability', language: 'en' },
      { kind: 'positive', term: 'audit', language: 'en' },
      { kind: 'synonym', term: 'SOC', synonymGroup: 'SOC', language: 'en' },
      { kind: 'synonym', term: 'security operations centre', synonymGroup: 'SOC', language: 'en' },
      { kind: 'synonym', term: 'security operations center', synonymGroup: 'SOC', language: 'en' },
      { kind: 'synonym', term: 'ISO 27001', synonymGroup: 'ISO27001', language: 'en' },
      { kind: 'synonym', term: 'ISMS', synonymGroup: 'ISO27001', language: 'en' },
    ],
  },
  {
    key: 'cloud_devops',
    label: 'Cloud / DevOps consultancy',
    description:
      'Cloud migration, infrastructure automation, managed hosting and network administration for public-sector IT estates.',
    cpvCodes: ['72000000', '72267100', '72315000', '48820000', '48210000'],
    capabilities: [
      'Cloud migration',
      'Infrastructure as code',
      'CI/CD pipeline design',
      'Managed hosting',
      'Network administration',
    ],
    keywords: [
      { kind: 'positive', term: 'cloud', language: 'en' },
      { kind: 'positive', term: 'devops', language: 'en' },
      { kind: 'positive', term: 'infrastructure', language: 'en' },
      { kind: 'positive', term: 'kubernetes', language: 'en' },
      { kind: 'synonym', term: 'CI/CD', synonymGroup: 'CICD', language: 'en' },
      { kind: 'synonym', term: 'continuous integration', synonymGroup: 'CICD', language: 'en' },
      { kind: 'synonym', term: 'continuous deployment', synonymGroup: 'CICD', language: 'en' },
      { kind: 'synonym', term: 'hosting', synonymGroup: 'HOSTING', language: 'en' },
      { kind: 'synonym', term: 'managed services', synonymGroup: 'HOSTING', language: 'en' },
    ],
  },
  {
    key: 'software_house',
    label: 'Software development house',
    description:
      'Bespoke application development, systems integration and software maintenance for public-sector clients.',
    cpvCodes: ['72200000', '72212000', '48000000', '48200000'],
    capabilities: [
      'Custom application development',
      'Systems integration',
      'API development',
      'Software maintenance and support',
    ],
    keywords: [
      { kind: 'positive', term: 'software development', language: 'en' },
      { kind: 'positive', term: 'application', language: 'en' },
      { kind: 'positive', term: 'integration', language: 'en' },
      { kind: 'positive', term: 'programming', language: 'en' },
      { kind: 'synonym', term: 'bespoke software', synonymGroup: 'CUSTOM', language: 'en' },
      { kind: 'synonym', term: 'custom development', synonymGroup: 'CUSTOM', language: 'en' },
      { kind: 'synonym', term: 'API', synonymGroup: 'API', language: 'en' },
      { kind: 'synonym', term: 'web service', synonymGroup: 'API', language: 'en' },
    ],
  },
  {
    key: 'it_generalist',
    label: 'IT services generalist',
    description:
      'Broad IT support, consultancy and software supply — a starting point for consultancies that do not specialize in one segment.',
    cpvCodes: ['72000000', '72222300', '48000000', '79417000'],
    capabilities: ['IT consultancy', 'IT support', 'Software supply', 'Technical consultancy'],
    keywords: [
      { kind: 'positive', term: 'IT services', language: 'en' },
      { kind: 'positive', term: 'consultancy', language: 'en' },
      { kind: 'positive', term: 'support', language: 'en' },
      { kind: 'synonym', term: 'help desk', synonymGroup: 'SUPPORT', language: 'en' },
      { kind: 'synonym', term: 'technical support', synonymGroup: 'SUPPORT', language: 'en' },
    ],
  },
];
