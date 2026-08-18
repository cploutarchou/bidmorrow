/**
 * Static onboarding reference data — CPV shorthand labels and a
 * region-grouped country list. Both are display-only wayfinding aids (fix
 * for ux-strategy.md F16: "CPV codes rendered as bare numbers... 30-item
 * flat country checkbox list"); neither changes what gets sent to the API
 * (`cpvCodes: string[]` / `geographies: [{kind, code}]}` stay byte-identical
 * to today). No API call needed — this is data already known at build time.
 */
import { COMPANY_PRESETS } from '@bidmorrow/domain';

/**
 * Short, plain-language shorthand for the CPV codes that appear in the
 * bundled onboarding presets — NOT an official CPV vocabulary quotation.
 * A code outside this map (e.g. a manually-entered one) falls back to the
 * bare code, which is always honest even when a label isn't available.
 */
export const CPV_SHORTHAND_LABELS: Readonly<Record<string, string>> = {
  '72000000': 'IT services: consulting, development, support',
  '72200000': 'Software programming & consultancy',
  '72212000': 'Application-software programming',
  '72220000': 'Systems & technical consultancy',
  '72222300': 'Information-systems planning',
  '72267100': 'Software maintenance',
  '72315000': 'Data network management & support',
  '79417000': 'Safety consultancy',
  '48000000': 'Software packages & information systems',
  '48200000': 'Network / internet / intranet software',
  '48210000': 'Network operating-system software',
  '48730000': 'Security software',
  '48820000': 'Servers',
};

/** Every CPV code that appears in at least one bundled preset, de-duplicated. */
export const PRESET_CPV_CODES: readonly string[] = [
  ...new Set(COMPANY_PRESETS.flatMap((preset) => preset.cpvCodes)),
];

export interface CountryOption {
  readonly code: string;
  readonly name: string;
}

export interface CountryRegion {
  readonly label: string;
  readonly countries: readonly CountryOption[];
}

/**
 * EU + EEA opportunity-country options, grouped the way ux-strategy.md
 * §3.2 (screen 3.1) specifies, replacing the flat 30-item checkbox list.
 * Codes are ISO 3166-1 alpha-2 (same values the API already stores under
 * `geographies: [{kind: 'opportunity_country', code}]`).
 */
export const COUNTRY_REGIONS: readonly CountryRegion[] = [
  {
    label: 'Nordics',
    countries: [
      { code: 'DK', name: 'Denmark' },
      { code: 'FI', name: 'Finland' },
      { code: 'SE', name: 'Sweden' },
    ],
  },
  {
    label: 'Western Europe',
    countries: [
      { code: 'AT', name: 'Austria' },
      { code: 'BE', name: 'Belgium' },
      { code: 'DE', name: 'Germany' },
      { code: 'FR', name: 'France' },
      { code: 'IE', name: 'Ireland' },
      { code: 'LU', name: 'Luxembourg' },
      { code: 'NL', name: 'Netherlands' },
    ],
  },
  {
    label: 'Southern Europe',
    countries: [
      { code: 'CY', name: 'Cyprus' },
      { code: 'ES', name: 'Spain' },
      { code: 'GR', name: 'Greece' },
      { code: 'IT', name: 'Italy' },
      { code: 'MT', name: 'Malta' },
      { code: 'PT', name: 'Portugal' },
    ],
  },
  {
    label: 'Central & Eastern Europe',
    countries: [
      { code: 'BG', name: 'Bulgaria' },
      { code: 'CZ', name: 'Czechia' },
      { code: 'EE', name: 'Estonia' },
      { code: 'HR', name: 'Croatia' },
      { code: 'HU', name: 'Hungary' },
      { code: 'LT', name: 'Lithuania' },
      { code: 'LV', name: 'Latvia' },
      { code: 'PL', name: 'Poland' },
      { code: 'RO', name: 'Romania' },
      { code: 'SI', name: 'Slovenia' },
      { code: 'SK', name: 'Slovakia' },
    ],
  },
  {
    label: 'EEA (non-EU)',
    countries: [
      { code: 'IS', name: 'Iceland' },
      { code: 'LI', name: 'Liechtenstein' },
      { code: 'NO', name: 'Norway' },
    ],
  },
];

export const COUNTRY_NAME_BY_CODE: Readonly<Record<string, string>> = Object.fromEntries(
  COUNTRY_REGIONS.flatMap((region) => region.countries.map((c) => [c.code, c.name])),
);

/**
 * Union of every keyword term across the bundled onboarding presets
 * (`packages/domain`'s `COMPANY_PRESETS`), de-duplicated case-insensitively
 * and sorted — a public, static suggestion source for Settings' "Add
 * keyword" combobox. Same non-exhaustive posture as `CPV_SUGGESTIONS`
 * (`data/cpv-suggestions.ts`): a suggestion list only, any free-typed
 * keyword is still accepted.
 */
export const KEYWORD_SUGGESTIONS: readonly string[] = [
  ...new Map(
    COMPANY_PRESETS.flatMap((preset) => preset.keywords).map((k) => [k.term.toLowerCase(), k.term]),
  ).values(),
].sort((a, b) => a.localeCompare(b));
