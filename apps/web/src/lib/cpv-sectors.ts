/**
 * Sector shortcuts for onboarding's "what line of work are you in?" step,
 * 2026-08-21 handoff (`BidMorrow Onboarding.dc.html`).
 *
 * WHY THIS EXISTS. Onboarding used to offer only the bundled IT presets, so a
 * construction or catering company reaching the CPV screen had nothing to
 * start from and no explanation of why. These twelve sectors cover the CPV
 * vocabulary broadly enough that anyone can begin, and each one pre-fills a
 * handful of codes the user then edits.
 *
 * WHAT IT IS NOT. Picking a sector does not widen what BidMorrow ingests.
 * Ingestion runs on the CPV families in the live `ingestion_cpv_scope` flag
 * (`72*`, `48*`, `79417000` by default, per docs/ted-ingestion-scope.md), and a
 * code outside those is saved to the profile but scores nothing until an
 * operator widens the scope. That is a real limitation, so the UI marks those
 * codes out of scope and the estimate panel shows the resulting count
 * honestly rather than letting it be discovered later as an empty feed.
 *
 * LABEL PROVENANCE. The 48/72/79 titles are the official CPV 2008 wording,
 * carried over from the app's existing suggestion list. Every other label
 * here is OUR OWN plain-language wording, not a quotation from the CPV
 * codelist, a distinction `SECTOR_LABEL_NOTE` states in the UI rather than
 * leaving the impression that all of it is official vocabulary.
 */

export interface SectorCode {
  readonly code: string;
  readonly label: string;
}

export interface Sector {
  readonly id: string;
  readonly label: string;
  /** CPV divisions this sector draws on, for the one-line summary. */
  readonly divisions: string;
  readonly codes: readonly SectorCode[];
}

const code = (c: string, label: string): SectorCode => ({ code: c, label });

export const CPV_SECTORS: readonly Sector[] = [
  {
    id: 'tech',
    label: 'Technology, software and telecoms',
    divisions: '72 · 48 · 64 · 32',
    codes: [
      code('72000000', 'IT services: consulting, software development, Internet and support'),
      code('48000000', 'Software package and information systems'),
      code('72220000', 'Systems and technical consultancy services'),
      code('64200000', 'Telecommunications services'),
      code('32420000', 'Network equipment'),
    ],
  },
  {
    id: 'construction',
    label: 'Construction and civil engineering',
    divisions: '45 · 44',
    codes: [
      code('45000000', 'Construction work'),
      code('45200000', 'Building and civil engineering works'),
      code('45300000', 'Building installation works'),
      code('44000000', 'Construction materials and structures'),
    ],
  },
  {
    id: 'engineering',
    label: 'Architecture and engineering',
    divisions: '71',
    codes: [
      code('71000000', 'Architecture, engineering and inspection'),
      code('71200000', 'Architectural services'),
      code('71300000', 'Engineering services'),
      code('71600000', 'Technical testing and analysis'),
    ],
  },
  {
    id: 'health',
    label: 'Health, medical and social care',
    divisions: '85 · 33',
    codes: [
      code('85000000', 'Health and social care services'),
      code('85100000', 'Health services'),
      code('33000000', 'Medical equipment and pharmaceuticals'),
      code('33600000', 'Pharmaceutical products'),
    ],
  },
  {
    id: 'education',
    label: 'Education and training',
    divisions: '80',
    codes: [
      code('80000000', 'Education and training services'),
      code('80500000', 'Training services'),
      code('80530000', 'Vocational training services'),
      code('80533100', 'Computer training services'),
    ],
  },
  {
    id: 'business',
    label: 'Business, legal and financial services',
    divisions: '79 · 66',
    codes: [
      code(
        '79000000',
        'Business services: law, marketing, consulting, recruitment, printing and security',
      ),
      code('79400000', 'Business and management consultancy and related services'),
      code('79417000', 'Safety consultancy services'),
      code('66000000', 'Financial and insurance services'),
    ],
  },
  {
    id: 'transport',
    label: 'Transport and logistics',
    divisions: '60 · 63 · 34',
    codes: [
      code('60000000', 'Transport services'),
      code('60100000', 'Road transport services'),
      code('63000000', 'Supporting transport and travel services'),
      code('34000000', 'Transport equipment'),
    ],
  },
  {
    id: 'energy',
    label: 'Energy, water and utilities',
    divisions: '65 · 09 · 31 · 41',
    codes: [
      code('65000000', 'Public utilities'),
      code('09000000', 'Fuel, electricity and energy'),
      code('31000000', 'Electrical equipment and lighting'),
      code('41000000', 'Water supply'),
    ],
  },
  {
    id: 'facilities',
    label: 'Facilities, property and security',
    divisions: '90 · 50 · 79 · 70',
    codes: [
      code('90000000', 'Cleaning, refuse and environmental services'),
      code('90900000', 'Cleaning and sanitation services'),
      code('50000000', 'Repair and maintenance services'),
      code('79710000', 'Security services'),
      code('70000000', 'Real estate services'),
    ],
  },
  {
    id: 'food',
    label: 'Food, catering and hospitality',
    divisions: '15 · 55',
    codes: [
      code('15000000', 'Food, beverages and tobacco products'),
      code('55000000', 'Hotel, restaurant and retail services'),
      code('55300000', 'Restaurant and food-serving services'),
      code('15800000', 'Miscellaneous food products'),
    ],
  },
  {
    id: 'equipment',
    label: 'Machinery, equipment and supplies',
    divisions: '42 · 39 · 30 · 38',
    codes: [
      code('42000000', 'Industrial machinery'),
      code('39000000', 'Furniture, furnishings and domestic appliances'),
      code('30000000', 'Office and computing machinery and supplies'),
      code('38000000', 'Laboratory, optical and precision equipment'),
    ],
  },
  {
    id: 'environment',
    label: 'Agriculture, forestry and environment',
    divisions: '03 · 77 · 90',
    codes: [
      code('03000000', 'Agricultural, farming, fishing and forestry products'),
      code('77000000', 'Agricultural, forestry and horticultural services'),
      code('90700000', 'Environmental services'),
    ],
  },
];

export const SECTOR_LABEL_NOTE =
  'Codes in divisions 72, 48 and 79417000 carry their official CPV 2008 titles. The other sector labels are our own plain-language wording, not quotations from the CPV codelist.';

/** Divisions whose labels above are official CPV 2008 wording. */
const OFFICIAL_LABEL_DIVISIONS = new Set(['72', '48', '79']);

export function hasOfficialCpvLabel(cpvCode: string): boolean {
  return OFFICIAL_LABEL_DIVISIONS.has(cpvCode.slice(0, 2));
}

export function findSector(id: string | null): Sector | null {
  if (id === null) return null;
  return CPV_SECTORS.find((sector) => sector.id === id) ?? null;
}
