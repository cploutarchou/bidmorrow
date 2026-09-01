/**
 * Illustrative data for the homepage decision-engine visual
 * (`DecisionEngine.tsx`). Three invented tenders with anonymised buyers,
 * scored with the REAL component names and maximum weights
 * (docs/matching-engine.md, the eight components that sum to 100) and
 * placed in the REAL published bands (`TIERS` on the homepage): the visual
 * shows the product's arithmetic, not a marketing number. The points of
 * each tender sum to its score and the band follows from the score;
 * `decision-engine-data.test.ts` fails if either drifts.
 *
 * Product truth (docs/product-scope.md): every buyer is a generic
 * anonymised type, never a named institution; the caption in the visual
 * says "Illustrative example, not live data"; nothing here says "win".
 */

/** The engine's four component outcomes (docs/matching-engine.md). */
export type SignalState = 'matched' | 'partial' | 'missed' | 'unknown';

export interface IllustrativeSignal {
  /** Component name, verbatim from the published weights table. */
  readonly label: string;
  readonly state: SignalState;
  readonly pts: number;
  readonly max: number;
}

/** Published verdict bands (homepage `TIERS`, docs/matching-engine.md). */
export type VerdictBand = 'strong' | 'review' | 'possible' | 'low';

export interface IllustrativeTender {
  readonly id: string;
  /** Anonymised buyer type + country code, e.g. "National health ministry · CY". */
  readonly buyer: string;
  readonly title: string;
  readonly value: string;
  readonly deadline: string;
  readonly signals: readonly IllustrativeSignal[];
  readonly score: number;
  readonly band: VerdictBand;
  /** Optional detected risk flag, shown on the notice card in the product's wording. */
  readonly flag?: string;
}

/** The eight components and their maximum points, in display order. */
export const COMPONENT_WEIGHTS: readonly { readonly label: string; readonly max: number }[] = [
  { label: 'CPV fit', max: 35 },
  { label: 'Capability & keyword fit', max: 20 },
  { label: 'Geography', max: 15 },
  { label: 'Contract value', max: 10 },
  { label: 'Buyer & sector', max: 5 },
  { label: 'Procedure & contract nature', max: 5 },
  { label: 'Deadline runway', max: 5 },
  { label: 'Eligibility & certifications', max: 5 },
];

export const BAND_LABELS: Readonly<Record<VerdictBand, string>> = {
  strong: 'Strong match',
  review: 'Worth reviewing',
  possible: 'Possible match',
  low: 'Low fit',
};

/** Score to band, exactly the published ranges (80–100, 65–79, 45–64, 0–44). */
export function bandFor(score: number): VerdictBand {
  if (score >= 80) return 'strong';
  if (score >= 65) return 'review';
  if (score >= 45) return 'possible';
  return 'low';
}

function signals(points: readonly [SignalState, number][]): readonly IllustrativeSignal[] {
  return COMPONENT_WEIGHTS.map((component, index) => {
    const entry = points[index];
    if (entry === undefined) throw new Error(`missing signal for ${component.label}`);
    return { label: component.label, state: entry[0], pts: entry[1], max: component.max };
  });
}

/**
 * Cycle order matters: a strong match first (what the product is for), a
 * worth-reviewing second (the honest middle), a low fit third (what it
 * tells you to leave alone, which is most of the value).
 */
export const HERO_TENDERS: readonly IllustrativeTender[] = [
  {
    id: 'health-cloud',
    buyer: 'National health ministry · CY',
    title: 'Cloud migration and managed hosting for national health records',
    value: '€1.84M',
    deadline: 'closes in 11 days',
    signals: signals([
      ['matched', 32],
      ['matched', 18],
      ['matched', 14],
      ['matched', 9],
      ['matched', 4],
      ['partial', 3],
      ['partial', 2],
      ['partial', 2],
    ]),
    score: 84,
    band: 'strong',
    flag: 'ISO 27001 may be required: verify in source documents',
  },
  {
    id: 'water-gis',
    buyer: 'Regional water utility · GR',
    title: 'GIS platform for network asset management',
    value: '€880k',
    deadline: 'closes in 9 days',
    signals: signals([
      ['partial', 24],
      ['partial', 12],
      ['matched', 15],
      ['matched', 10],
      ['partial', 3],
      ['matched', 4],
      ['missed', 1],
      ['partial', 2],
    ]),
    score: 71,
    band: 'review',
  },
  {
    id: 'road-works',
    buyer: 'City council · DE',
    title: 'Road resurfacing and drainage works, district four',
    value: '€2.10M',
    deadline: 'closes in 18 days',
    signals: signals([
      ['missed', 5],
      ['missed', 3],
      ['partial', 6],
      ['matched', 8],
      ['matched', 5],
      ['matched', 4],
      ['matched', 5],
      ['partial', 2],
    ]),
    score: 38,
    band: 'low',
  },
];

/** Seconds per tender and the loop length the stylesheet is built around. */
export const SCENE_SECONDS = 4.5;
export const CYCLE_SECONDS = SCENE_SECONDS * HERO_TENDERS.length;
