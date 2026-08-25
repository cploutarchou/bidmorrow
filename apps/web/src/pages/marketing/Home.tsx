import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import { HEADLINE, SUBHEADLINE } from '../../copy';
import { PageMeta } from '../../components/PageMeta';
import { MARKETING_META } from '../../lib/seo';

/**
 * Homepage — 2026-08-21 handoff redesign (`BidMorrow Homepage.dc.html`).
 * Structure and copy follow the prototype: hero over a drifting grid,
 * a live-feed demo panel with a geo picker (country detected from the
 * browser's timezone/locale, never from a network call), the facts row,
 * an auto-advancing four-step "how it works" stepper with a stage
 * figure, the methodology truths, the eight-component split, the five
 * verdicts, coverage + exclusions, pricing, FAQ, and the closing CTA.
 * The prototype's typeface switcher and its in-page footer are not
 * ported (shared MarketingLayout owns the shell); its cookie banner
 * lives in components/CookieConsent.tsx, rendered by the layout.
 */

interface DemoComponent {
  name: string;
  pts: number;
  max: number;
}

interface DemoCard {
  country: string;
  score: number;
  fit: 'Strong fit' | 'Worth reviewing' | 'Possible';
  tone: 'strong' | 'mid' | 'neutral';
  deadline: string;
  deadlineTone: 'risk' | 'caution' | 'quiet';
  title: string;
  meta: string;
  comps: DemoComponent[];
  risk?: { kind: 'Blocker' | 'Caution'; text: string };
}

const DEMO_POOL: DemoCard[] = [
  {
    country: 'CY',
    score: 91,
    fit: 'Strong fit',
    tone: 'strong',
    deadline: 'closes in 6 days',
    deadlineTone: 'risk',
    title: 'Framework for cloud migration and managed hosting of national health records',
    meta: 'National health ministry · CY · €1.84M · open procedure',
    comps: [
      { name: 'CPV fit', pts: 32, max: 35 },
      { name: 'Capability & keyword fit', pts: 18, max: 20 },
      { name: 'Geography', pts: 14, max: 15 },
      { name: 'Eligibility & certifications', pts: 2, max: 5 },
    ],
    risk: {
      kind: 'Blocker',
      text: 'SC security clearance required for 3 named staff — none on file.',
    },
  },
  {
    country: 'CY',
    score: 84,
    fit: 'Strong fit',
    tone: 'strong',
    deadline: 'closes in 11 days',
    deadlineTone: 'caution',
    title: 'Cybersecurity operations centre — 24/7 monitoring, three years',
    meta: 'National police force · CY · €2.40M · restricted',
    comps: [
      { name: 'CPV fit', pts: 30, max: 35 },
      { name: 'Capability & keyword fit', pts: 17, max: 20 },
      { name: 'Geography', pts: 15, max: 15 },
      { name: 'Procedure & contract nature', pts: 3, max: 5 },
    ],
    risk: {
      kind: 'Caution',
      text: 'Two-stage procedure — the pre-qualification pack is due before the tender itself.',
    },
  },
  {
    country: 'CY',
    score: 58,
    fit: 'Possible',
    tone: 'neutral',
    deadline: 'closes in 9 days',
    deadlineTone: 'caution',
    title: 'GIS platform for water utility asset management',
    meta: 'Municipal water board · CY · €880k · open procedure',
    comps: [
      { name: 'CPV fit', pts: 16, max: 35 },
      { name: 'Capability & keyword fit', pts: 9, max: 20 },
      { name: 'Geography', pts: 15, max: 15 },
      { name: 'Contract value', pts: 7, max: 10 },
    ],
  },
  {
    country: 'GR',
    score: 88,
    fit: 'Strong fit',
    tone: 'strong',
    deadline: 'closes in 14 days',
    deadlineTone: 'quiet',
    title: 'Managed hosting and disaster recovery for the national land registry',
    meta: 'National land registry agency · GR · €3.10M · open procedure',
    comps: [
      { name: 'CPV fit', pts: 31, max: 35 },
      { name: 'Capability & keyword fit', pts: 17, max: 20 },
      { name: 'Geography', pts: 13, max: 15 },
      { name: 'Contract value', pts: 6, max: 10 },
    ],
    risk: {
      kind: 'Caution',
      text: 'Greek-language submission required — quoted from the notice text (confirmed pattern).',
    },
  },
  {
    country: 'MT',
    score: 76,
    fit: 'Worth reviewing',
    tone: 'mid',
    deadline: 'closes in 8 days',
    deadlineTone: 'caution',
    title: 'Service desk and endpoint management for government agencies',
    meta: 'Government IT agency · MT · €920k · restricted',
    comps: [
      { name: 'CPV fit', pts: 27, max: 35 },
      { name: 'Capability & keyword fit', pts: 14, max: 20 },
      { name: 'Geography', pts: 13, max: 15 },
      { name: 'Deadline runway', pts: 2, max: 5 },
    ],
  },
  {
    country: 'IT',
    score: 71,
    fit: 'Worth reviewing',
    tone: 'mid',
    deadline: 'closes in 21 days',
    deadlineTone: 'quiet',
    title: 'Identity federation for regional health authorities',
    meta: 'Regional health authority · IT · €2.40M · open procedure',
    comps: [
      { name: 'CPV fit', pts: 27, max: 35 },
      { name: 'Capability & keyword fit', pts: 13, max: 20 },
      { name: 'Geography', pts: 6, max: 15 },
      { name: 'Buyer & sector', pts: 5, max: 5 },
    ],
    risk: {
      kind: 'Caution',
      text: 'Local operating presence in the region expected — possible requirement, verify in source.',
    },
  },
  {
    country: 'DE',
    score: 69,
    fit: 'Worth reviewing',
    tone: 'mid',
    deadline: 'closes in 17 days',
    deadlineTone: 'quiet',
    title: 'Framework for cloud security operations, federal transport authority',
    meta: 'Federal transport authority · DE · €4.80M · restricted',
    comps: [
      { name: 'CPV fit', pts: 27, max: 35 },
      { name: 'Capability & keyword fit', pts: 15, max: 20 },
      { name: 'Geography', pts: 6, max: 15 },
      { name: 'Contract value', pts: 3, max: 10 },
    ],
    risk: {
      kind: 'Blocker',
      text: 'BSI C5 attestation required — not held on file (confirmed pattern).',
    },
  },
];

const COUNTRY_NAMES: Record<string, string> = {
  CY: 'Cyprus',
  GR: 'Greece',
  MT: 'Malta',
  IT: 'Italy',
  DE: 'Germany',
  ES: 'Spain',
  FR: 'France',
  NL: 'Netherlands',
};

const GEO_OPTIONS = ['EU', 'CY', 'GR', 'MT', 'IT', 'DE'];

/** Country from timezone/locale only — never a network lookup. */
function detectCountry(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const byZone: Record<string, string> = {
      'Asia/Nicosia': 'CY',
      'Europe/Nicosia': 'CY',
      'Europe/Athens': 'GR',
      'Europe/Malta': 'MT',
      'Europe/Rome': 'IT',
      'Europe/Madrid': 'ES',
      'Europe/Lisbon': 'PT',
      'Europe/Berlin': 'DE',
      'Europe/Paris': 'FR',
      'Europe/Amsterdam': 'NL',
      'Europe/Brussels': 'BE',
      'Europe/Dublin': 'IE',
      'Europe/Vienna': 'AT',
      'Europe/Warsaw': 'PL',
      'Europe/Bucharest': 'RO',
      'Europe/Sofia': 'BG',
      'Europe/Stockholm': 'SE',
      'Europe/Copenhagen': 'DK',
      'Europe/Helsinki': 'FI',
      'Europe/Oslo': 'NO',
    };
    const zoned = byZone[tz];
    if (zoned !== undefined) return zoned;
    const langs = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
    for (const lang of langs) {
      const parts = String(lang).split('-');
      const last = parts[parts.length - 1]?.toUpperCase();
      if (parts.length > 1 && last !== undefined && /^[A-Z]{2}$/.test(last)) return last;
    }
  } catch {
    // Locale unavailable.
  }
  return null;
}

const STEPS = [
  {
    title: 'TED, ingested daily',
    body: 'Competition notices from Tenders Electronic Daily — the Publications Office of the European Union — within a documented CPV scope.',
  },
  {
    title: 'Your company profile',
    body: 'CPV codes, capabilities, keywords, geography, value range and exclusions — set once in onboarding, editable forever after.',
  },
  {
    title: 'Deterministic scoring',
    body: 'Eight components, published weights, same engine version, same score. No LLM anywhere in the scoring path.',
  },
  {
    title: 'Verdict + explanation',
    body: 'Strong match, worth reviewing or possible — with the reasoning for every point, quoted evidence, and a link to the notice on TED.',
  },
];

const STAGE_CAPTIONS = [
  '01 · The source',
  '02 · Your profile',
  '03 · The score',
  '04 · The verdict',
];

const NOTICE_LINES = ['92%', '76%', '84%', '61%', '88%', '48%'];

const PROFILE_CHIPS = [
  '72000000 IT services',
  '48730000 Security software',
  'CY · GR · MT',
  '€250k – €5M',
  'penetration testing',
  '7 days runway',
];

const STAGE_SCORE_BARS = [
  { label: 'CPV fit', pts: 30, max: 35 },
  { label: 'Capability & keyword fit', pts: 17, max: 20 },
  { label: 'Geography', pts: 15, max: 15 },
  { label: 'Contract value', pts: 10, max: 10 },
  { label: 'Buyer & sector', pts: 5, max: 5 },
  { label: 'Procedure & nature', pts: 5, max: 5 },
  { label: 'Deadline runway', pts: 2, max: 5 },
  { label: 'Eligibility & certs', pts: 2.5, max: 5 },
];

const FACTS = [
  {
    value: '0–100',
    label: 'A score per tender, with the points broken out component by component.',
  },
  {
    value: '5 rules',
    label: 'The only grounds on which a tender is excluded outright — all of them yours to set.',
  },
  {
    value: '3 tiers',
    label: 'Strong match, worth reviewing, possible. Your feed leads with the first.',
  },
  { value: '1 email', label: 'Per day, and only on days when something scored worth reading.' },
];

const TRUTHS = [
  {
    title: 'Missing data is never guessed',
    body: 'When a notice omits something a score component needs — no value, no deadline — BidMorrow does not score it as zero or as a perfect match. It applies a documented neutral score, half that component’s maximum points, and marks the component Unknown with an explanation of what was missing.',
  },
  {
    title: 'Every risk flag quotes its source',
    body: 'Risk flags are deterministic pattern matches over the notice text: certifications, security clearance, insurance, turnover, prior experience, framework membership, local presence, mandatory references. Each flag quotes the exact text it was detected from and is labelled either a confirmed pattern or a possible requirement to verify in the source documents.',
  },
  {
    title: 'Exclusions fire only on known values',
    body: 'A tender is excluded outright — no score shown — only when a known value trips one of five rules: excluded geography, excluded CPV family, an excluded phrase in the notice text, an unsupported contract nature, or a deadline runway below your threshold. Unknown fields never trigger an exclusion.',
  },
  {
    title: 'Coverage is scoped and published',
    body: 'Ingestion covers a documented CPV scope, not all of TED: IT services, software and information systems, and a small reviewed extras list. A notice outside that scope is never ingested or scored, however well it might otherwise fit your profile.',
  },
];

const COMPONENTS = [
  { label: 'CPV fit', max: 35 },
  { label: 'Capability & keyword fit', max: 20 },
  { label: 'Geography', max: 15 },
  { label: 'Contract value', max: 10 },
  { label: 'Buyer & sector', max: 5 },
  { label: 'Procedure & contract nature', max: 5 },
  { label: 'Deadline runway', max: 5 },
  { label: 'Eligibility & certifications', max: 5 },
];

const STATUSES = [
  {
    label: 'Matched',
    note: 'The notice states something that fits your profile, and the component takes full or near-full points.',
  },
  {
    label: 'Partial match',
    note: 'Some overlap — a secondary CPV code, a neighbouring region — scored proportionally rather than all or nothing.',
  },
  {
    label: 'No match',
    note: 'The notice is explicit and it does not fit. Zero points, and the breakdown says which fact decided it.',
  },
  {
    label: 'Unknown — neutral score applied',
    note: 'The notice never published the field. Half the component’s points, marked Unknown, with a note on what was missing.',
  },
];

const TIERS = [
  {
    range: '80 – 100',
    label: 'Strong match',
    note: 'Read it today. This is the top of your feed.',
    tone: 'strong',
  },
  {
    range: '65 – 79',
    label: 'Worth reviewing',
    note: 'Worth twenty minutes before you decide.',
    tone: 'mid',
  },
  {
    range: '45 – 64',
    label: 'Possible match',
    note: 'Adjacent work. Skim it when the week is quiet.',
    tone: '',
  },
  {
    range: '0 – 44',
    label: 'Low fit',
    note: 'Scored and kept, not surfaced. Useful when you widen your profile.',
    tone: '',
  },
  {
    range: 'no score',
    label: 'Excluded',
    note: 'A rule you set fired on a known value. The rule is named on the card.',
    tone: '',
  },
];

const RISK_TYPES = [
  'Certifications',
  'Security clearance',
  'Insurance',
  'Financial turnover',
  'Prior experience',
  'Framework membership',
  'Local presence',
  'Mandatory references',
];

const RULES = [
  'The lot’s country or region is in your excluded geographies.',
  'Its CPV code falls in a CPV family you excluded.',
  'An excluded phrase appears in the notice text.',
  'Its contract nature is one you marked unsupported.',
  'Its deadline runway is below your configured threshold.',
];

const FAQS = [
  {
    q: 'Is this a bid-writing tool?',
    a: 'No. BidMorrow decides what deserves your time — discovery, scoring and a defensible bid/no-bid call. The writing stays with your team.',
  },
  {
    q: 'Which sectors can I profile?',
    a: 'Any CPV sector: construction, health, catering, transport, education, facilities, IT. Ingestion covers CPV 72*, 48* and 79417000 today, and codes outside that are saved to your profile and shown as out of scope until ingestion widens.',
  },
  {
    q: 'Where does the data come from?',
    a: 'Tenders Electronic Daily, the Publications Office of the European Union, ingested daily within a documented CPV scope.',
  },
  {
    q: 'Is any of this AI?',
    a: 'Not in the scoring path. Scores and risk flags are deterministic: same notice, same engine version, same result, with the evidence quoted. That is what makes a bid/no-bid call defensible to a partner.',
  },
  {
    q: 'How much noise should I expect?',
    a: 'One digest a day, only when something clears the floor you set, and Strong matches lead the feed. You choose the floor: Strong match, Worth reviewing, or everything scored.',
  },
  {
    q: 'What if the score is wrong?',
    a: 'Every component can be disagreed with in one click, and the breakdown names the fact behind each point. Feedback tunes your own weighting; it never rewrites history.',
  },
];

const FOUNDING_POINTS = [
  'The same product every customer gets — no separate pilot feature set',
  'Direct access to the team building BidMorrow',
  'Cancel any time from account settings',
];

const STANDARD_POINTS = [
  'Same feed, matching engine, daily digest and support',
  'Monthly subscription via Paddle',
  'Cancel any time from account settings',
];

/** SVG ring: circumference of r=17 is ~106.8. */
function ringDash(score: number): string {
  return `${((score / 100) * 106.8).toFixed(1)} 106.8`;
}

export function Home(): ReactElement {
  const [detected] = useState<string | null>(() => detectCountry());
  const [geoPicked, setGeoPicked] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [stepHeld, setStepHeld] = useState(0);
  const [playing, setPlaying] = useState(true);
  const tickRef = useRef<number | null>(null);

  // Auto-advancing stepper: 5 ticks × 900ms per step; never starts under
  // prefers-reduced-motion; pauses on manual step selection.
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !playing) return;
    tickRef.current = window.setInterval(() => {
      setStepHeld((held) => {
        if (held < 4) return held + 1;
        setStep((s) => (s + 1) % 4);
        return 0;
      });
    }, 900);
    return () => {
      if (tickRef.current !== null) window.clearInterval(tickRef.current);
    };
  }, [playing]);

  const picked =
    geoPicked ??
    (detected !== null && DEMO_POOL.some((d) => d.country === detected) ? detected : 'EU');
  const shown =
    picked === 'EU'
      ? DEMO_POOL.slice(0, 3)
      : [
          ...DEMO_POOL.filter((d) => d.country === picked),
          ...DEMO_POOL.filter((d) => d.country !== picked),
        ].slice(0, 3);

  // Product-truth (docs/product-scope.md): this panel is ILLUSTRATIVE —
  // invented example tenders with anonymized buyers, never live data, and
  // the visible copy must say so (production review PR-001).
  const geoHeadline =
    picked === 'EU'
      ? 'Example verdicts · illustrative, not live notices · EU-wide'
      : `Example verdicts · illustrative, not live notices · ${COUNTRY_NAMES[picked] ?? picked}`;
  const geoNote =
    detected === null
      ? 'Pick a country to see examples there:'
      : picked === detected
        ? `Detected ${COUNTRY_NAMES[detected] ?? detected} from your browser — change it:`
        : `Showing ${COUNTRY_NAMES[picked] ?? picked}:`;

  return (
    <>
      <PageMeta {...MARKETING_META.home} />

      <div className="hp-hero-wrap">
        <div className="hp-grid-bg" aria-hidden="true">
          <span className="hp-grid-bg__cols" />
          <span className="hp-grid-bg__rows" />
          <span className="hp-grid-bg__dot hp-grid-bg__dot--1" />
          <span className="hp-grid-bg__dot hp-grid-bg__dot--2" />
          <span className="hp-grid-bg__dot hp-grid-bg__dot--3" />
          <span className="hp-grid-bg__dot hp-grid-bg__dot--4" />
        </div>
        <section className="mkt-wrap hp-hero" aria-labelledby="hero-h">
          <p className="mkt-eyebrow">Bid/no-bid qualification · EU public procurement · TED</p>
          <h1 id="hero-h">{HEADLINE}</h1>
          <p className="hp-hero__sub">{SUBHEADLINE}</p>
          <div className="mkt-cta-row">
            <Link className="cta" to="/pilot">
              Join the founding pilot
            </Link>
            <a className="mkt-btn-quiet" href="#how">
              See how it works
            </a>
            <span className="mkt-cta-note">€29/month · first 50 customers</span>
          </div>
        </section>
      </div>

      <section className="mkt-wrap hp-section" aria-label="Example feed — illustrative data">
        <div className="hp-demo">
          <div className="hp-demo__chrome" aria-hidden="true">
            <span className="hp-demo__dot" />
            <span className="hp-demo__dot" />
            <span className="hp-demo__dot" />
            <span className="hp-demo__crumb">{geoHeadline}</span>
          </div>
          <div className="hp-demo__geo">
            <span className="hp-demo__geo-note">{geoNote}</span>
            {GEO_OPTIONS.map((code) => (
              <button
                type="button"
                key={code}
                className={picked === code ? 'hp-geo-chip is-active' : 'hp-geo-chip'}
                onClick={() => setGeoPicked(code)}
              >
                {code === 'EU' ? 'EU-wide' : (COUNTRY_NAMES[code] ?? code)}
              </button>
            ))}
          </div>
          <div className="hp-demo__cards">
            <p className="hp-demo__disclaimer">
              Illustrative examples with anonymized buyers — this is what a scored feed looks like,
              not live TED data.
            </p>
            {shown.map((card) => (
              <article className={`hp-card hp-card--${card.tone}`} key={card.title}>
                <div className="hp-card__gutter" aria-hidden="true" />
                <div className="hp-card__body">
                  <div className="hp-card__head">
                    <span className="hp-ring" aria-hidden="true">
                      <svg width="40" height="40" viewBox="0 0 40 40">
                        <circle
                          cx="20"
                          cy="20"
                          r="17"
                          fill="none"
                          className="hp-ring__track"
                          strokeWidth="3"
                        />
                        <circle
                          cx="20"
                          cy="20"
                          r="17"
                          fill="none"
                          className="hp-ring__fill"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeDasharray={ringDash(card.score)}
                          transform="rotate(-90 20 20)"
                        />
                      </svg>
                      <span className="hp-ring__num">{card.score}</span>
                    </span>
                    <span className="hp-card__chip">{card.fit}</span>
                    <span className={`hp-card__deadline hp-card__deadline--${card.deadlineTone}`}>
                      {card.deadline}
                    </span>
                  </div>
                  <div>
                    <p className="hp-card__title">{card.title}</p>
                    <p className="hp-card__meta">{card.meta}</p>
                  </div>
                  <div className="hp-card__comps">
                    {card.comps.map((comp) => (
                      <div className="hp-comp" key={comp.name}>
                        <span className="hp-comp__name">{comp.name}</span>
                        {/* Native <progress> — CSP forbids inline style widths. */}
                        <progress
                          className="score-bar score-bar--sm"
                          value={comp.pts}
                          max={comp.max}
                          aria-hidden="true"
                        />
                        <span className="hp-comp__pts">
                          +{comp.pts}/{comp.max}
                        </span>
                      </div>
                    ))}
                  </div>
                  {card.risk !== undefined && (
                    <p
                      className={
                        card.risk.kind === 'Blocker'
                          ? 'hp-risk hp-risk--blocker'
                          : 'hp-risk hp-risk--caution'
                      }
                    >
                      <span className="hp-risk__kind">{card.risk.kind}</span>
                      <span>{card.risk.text}</span>
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mkt-wrap hp-section" aria-label="Product facts">
        <div className="hp-facts">
          {FACTS.map((fact) => (
            <div className="hp-fact" key={fact.value}>
              <p className="hp-fact__value">{fact.value}</p>
              <p className="hp-fact__label">{fact.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="mkt-wrap hp-section hp-section--major" aria-labelledby="how-h">
        <p className="mkt-eyebrow">How it works</p>
        <h2 id="how-h" className="hp-h2">
          From official journal to defensible decision
        </h2>
        <p className="hp-lede">
          Four steps, no black box: the source is official, the profile is yours, the scoring is
          deterministic, and the verdict is explained. It runs while you read.
        </p>
        <div className="hp-how">
          <div className="hp-how__steps">
            {STEPS.map((s, i) => (
              <button
                type="button"
                key={s.title}
                className={step === i ? 'hp-step is-active' : 'hp-step'}
                aria-expanded={step === i}
                onClick={() => {
                  setPlaying(false);
                  setStep(i);
                  setStepHeld(0);
                }}
              >
                <span className="hp-step__head">
                  <span className="hp-step__num">{i + 1}</span>
                  <span className="hp-step__title">{s.title}</span>
                </span>
                {step === i && (
                  <span className="hp-step__detail">
                    <span className="hp-step__body">{s.body}</span>
                    <progress
                      className="score-bar score-bar--sm hp-step__progress"
                      value={playing ? stepHeld + 1 : 0}
                      max={5}
                      aria-hidden="true"
                    />
                  </span>
                )}
              </button>
            ))}
            <div className="hp-how__controls">
              <button
                type="button"
                className="hp-how__play"
                onClick={() => {
                  setPlaying((p) => !p);
                  setStepHeld(0);
                }}
              >
                {playing ? 'Pause' : 'Play'}
              </button>
              <span className="hp-how__counter">Step {step + 1} of 4</span>
            </div>
          </div>

          <div className="hp-stage">
            <p className="hp-stage__caption">{STAGE_CAPTIONS[step]}</p>
            {step === 0 && (
              <>
                <div className="hp-stage__scan" aria-hidden="true">
                  {NOTICE_LINES.map((w) => (
                    <span className="hp-stage__line" key={w} />
                  ))}
                  <span className="hp-stage__scanline" />
                </div>
                <p className="hp-stage__note">
                  TED publishes; BidMorrow ingests inside the documented CPV scope and stores the
                  notice with its source URL.
                </p>
              </>
            )}
            {step === 1 && (
              <>
                <div className="hp-stage__chips">
                  {PROFILE_CHIPS.map((chip) => (
                    <span className="hp-stage__chip" key={chip}>
                      {chip}
                    </span>
                  ))}
                </div>
                <p className="hp-stage__note">
                  Your CPV codes, keywords, geography, value band and exclusions — the only inputs
                  that decide what gets scored.
                </p>
              </>
            )}
            {step === 2 && (
              <>
                <div className="hp-stage__bars">
                  {STAGE_SCORE_BARS.map((bar) => (
                    <span className="hp-sbar" key={bar.label}>
                      <span className="hp-sbar__label">{bar.label}</span>
                      <progress
                        className="score-bar score-bar--sm"
                        value={bar.pts}
                        max={bar.max}
                        aria-hidden="true"
                      />
                      <span className="hp-sbar__pts">
                        +{bar.pts}/{bar.max}
                      </span>
                    </span>
                  ))}
                </div>
                <p className="hp-stage__note">
                  Eight components, published weights, no LLM. Same notice and engine version, same
                  points every time.
                </p>
              </>
            )}
            {step === 3 && (
              <div className="hp-verdict">
                <div className="hp-verdict__head">
                  <span className="hp-ring hp-ring--lg" aria-hidden="true">
                    <svg width="56" height="56" viewBox="0 0 56 56">
                      <circle
                        cx="28"
                        cy="28"
                        r="24"
                        fill="none"
                        className="hp-ring__track"
                        strokeWidth="4"
                      />
                      <circle
                        cx="28"
                        cy="28"
                        r="24"
                        fill="none"
                        className="hp-ring__fill"
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeDasharray="127.2 150.8"
                        transform="rotate(-90 28 28)"
                      />
                    </svg>
                    <span className="hp-ring__num">84</span>
                  </span>
                  <span className="hp-verdict__id">
                    <span className="hp-verdict__chip">Strong match</span>
                    <span className="hp-verdict__band">84 / 100 · engine v1 · 80–100 band</span>
                  </span>
                </div>
                <p className="hp-risk hp-risk--caution">
                  <span className="hp-risk__kind">Flag</span>
                  <span>
                    ISO 27001 may be required — “certified to ISO 27001” · possible requirement,
                    verify in source documents.
                  </span>
                </p>
                <p className="hp-stage__note">
                  Verdict, component breakdown, quoted evidence and a link to the original notice —
                  the audit trail behind a bid/no-bid call.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section
        id="method"
        className="mkt-wrap hp-section hp-section--major"
        aria-labelledby="method-h"
      >
        <p className="mkt-eyebrow">Methodology</p>
        <h2 id="method-h" className="hp-h2">
          Deterministic on purpose
        </h2>
        <p className="hp-lede">
          A bid/no-bid call deserves a scoring engine you can audit, rerun, and disagree with —
          point by point. Not an AI black box.
        </p>
        <div className="hp-truths">
          {TRUTHS.map((truth) => (
            <article className="hp-truth" key={truth.title}>
              <h3>{truth.title}</h3>
              <p>{truth.body}</p>
            </article>
          ))}
        </div>
        <p className="mkt-section-link">
          <Link to="/methodology">Read the full methodology →</Link>
        </p>
      </section>

      <section
        id="score"
        className="mkt-wrap hp-section hp-section--major"
        aria-labelledby="score-h"
      >
        <p className="mkt-eyebrow">The score</p>
        <h2 id="score-h" className="hp-h2">
          Eight components. One hundred points.
        </h2>
        <p className="hp-lede">
          Every score is the sum of the same eight components, each capped at a published weight.
          Open any tender and you see what it earned, what it lost, and why.
        </p>
        <div className="hp-score">
          <div className="mkt-cellgrid mkt-cellgrid--rows hp-score__list">
            {COMPONENTS.map((comp) => (
              <div className="mkt-cell hp-scorerow" key={comp.label}>
                <span className="hp-scorerow__label">{comp.label}</span>
                {/* Bar length = the component's share of the biggest weight. */}
                <progress
                  className="score-bar score-bar--sm"
                  value={comp.max}
                  max={35}
                  aria-hidden="true"
                />
                <span className="hp-scorerow__max">{comp.max} pts</span>
              </div>
            ))}
          </div>
          <div className="hp-statuses">
            {STATUSES.map((status) => (
              <div className="hp-status" key={status.label}>
                <p className="hp-status__label">{status.label}</p>
                <p className="hp-status__note">{status.note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="tiers"
        className="mkt-wrap hp-section hp-section--major"
        aria-labelledby="tiers-h"
      >
        <p className="mkt-eyebrow">Your feed</p>
        <h2 id="tiers-h" className="hp-h2">
          Five verdicts, and no others.
        </h2>
        <p className="hp-lede">
          The bands are published, not tuned per customer: the vocabulary is fixed, printed as words
          next to every score, and never conveyed by colour alone.
        </p>
        <div className="hp-tiers">
          {TIERS.map((tier) => (
            <div
              className={`hp-tier${tier.tone === 'strong' ? ' hp-tier--strong' : ''}`}
              key={tier.range}
            >
              <p
                className={`hp-tier__range${tier.tone === 'strong' ? ' hp-tier__range--strong' : ''}`}
              >
                {tier.range}
              </p>
              <p className="hp-tier__label">{tier.label}</p>
              <p className="hp-tier__note">{tier.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section
        id="coverage"
        className="mkt-wrap hp-section hp-section--major"
        aria-labelledby="coverage-h"
      >
        <p className="mkt-eyebrow">Coverage and exclusions</p>
        <h2 id="coverage-h" className="hp-h2">
          What gets read, and what gets dropped.
        </h2>
        <div className="hp-coverage">
          <div>
            <p className="hp-coverage__cap">Requirements the engine detects in the notice text</p>
            <div className="mkt-pill-row hp-coverage__pills">
              {RISK_TYPES.map((risk) => (
                <span className="mkt-pill hp-pill" key={risk}>
                  {risk}
                </span>
              ))}
            </div>
            <p className="hp-coverage__note">
              Each detection quotes the sentence it came from and is labelled either{' '}
              <strong>Confirmed pattern</strong> or{' '}
              <strong>Possible requirement — verify in source documents</strong>. Pattern matching,
              not an LLM guess.
            </p>
          </div>
          <div>
            <p className="hp-coverage__cap">The only five rules that exclude a tender outright</p>
            <div className="hp-rules">
              {RULES.map((rule, index) => (
                <div className="hp-rule" key={rule}>
                  <span className="hp-rule__num" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <p>{rule}</p>
                </div>
              ))}
            </div>
            <p className="hp-coverage__note">
              Unknown fields never exclude anything. Every sector's CPV codes can be saved to your
              profile — ingestion covers 72*, 48* and 79417000 today, and anything outside it is
              shown as out of scope rather than dropped in silence.
            </p>
          </div>
        </div>
      </section>

      <section
        id="compare"
        className="mkt-wrap hp-section hp-section--major"
        aria-labelledby="compare-h"
      >
        <p className="mkt-eyebrow">How this compares</p>
        <h2 id="compare-h" className="hp-h2">
          The same category, without the usual habits.
        </h2>
        {/* The honest UNNAMED comparison module (docs/website-redesign-plan.md
            §7; named-competitor tables are owner-gated, decision D11). Every
            "typical" cell restates a finding documented in
            docs/redesign/competitor-findings.md (rendered-page captures of
            seven EU tender-alert services, 2026-08-17) — nothing here is
            asserted from memory, and the basis is stated to the reader below
            rather than left as an implied survey of the whole market. Every
            BidMorrow cell links to the page where that claim is kept true. */}
        <div className="mkt-table-card hp-compare">
          <table aria-labelledby="compare-h">
            <thead>
              <tr>
                <th scope="col">Compared on</th>
                <th scope="col">BidMorrow</th>
                <th scope="col">Typical tender-alert services</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Price</th>
                <td>
                  €29 or €49 a month, published <a href="#pricing">on this page</a>.
                </td>
                <td>Often behind a demo call, a quote form, or a &ldquo;from&rdquo; anchor.</td>
              </tr>
              <tr>
                <th scope="row">Billing</th>
                <td>Monthly. Cancel from settings; no annual lock-in.</td>
                <td>Discounts commonly steer toward paying a year upfront.</td>
              </tr>
              <tr>
                <th scope="row">Scoring</th>
                <td>
                  Deterministic 0&ndash;100 — the same inputs always produce the same score, and
                  every score decomposes into eight readable components.
                </td>
                <td>
                  &ldquo;AI-powered&rdquo; matching, with no published account of how a score or
                  ranking is produced.
                </td>
              </tr>
              <tr>
                <th scope="row">Methodology</th>
                <td>
                  <Link to="/methodology">Published in full</Link>, including how missing data is
                  scored.
                </td>
                <td>We found none published among the services we reviewed.</td>
              </tr>
              <tr>
                <th scope="row">Data source</th>
                <td>Named on every page: TED, the EU&rsquo;s official notice source.</td>
                <td>Rarely stated on the marketing pages we reviewed.</td>
              </tr>
              <tr>
                <th scope="row">Tracking</th>
                <td>
                  <Link to="/privacy">No third-party analytics, no session replay</Link>. Optional
                  cookies stay off until you opt in.
                </td>
                <td>Consent-gated tracker sets, sometimes covering the first screen you see.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="hp-compare__note">
          The right-hand column summarises our own review of the public marketing pages of seven EU
          tender-alert services, captured in August 2026. No service is named, and any individual
          service may differ — check the one you are considering. The left-hand column links to
          where each claim is kept true.
        </p>
      </section>

      <section
        id="pricing"
        className="mkt-wrap hp-section hp-section--major"
        aria-labelledby="pricing-h"
      >
        <p className="mkt-eyebrow">Pricing</p>
        <h2 id="pricing-h" className="hp-h2">
          Two monthly plans. Nothing hidden.
        </h2>
        <p className="hp-lede">
          Flat EUR pricing. No annual contract, no usage-based fees, no hidden tiers.
        </p>
        <div className="hp-plans">
          <article className="hp-plan hp-plan--founding">
            <p className="hp-plan__cap hp-plan__cap--accent">Founding — first 50 customers</p>
            <p className="hp-plan__price">
              €29<span className="hp-plan__per"> /month</span>
            </p>
            <p className="hp-plan__desc">
              Retained for the life of your subscription — it never auto-migrates to the standard
              price.
            </p>
            <ul className="hp-plan__list">
              {FOUNDING_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <Link className="cta" to="/pilot">
              Join the founding pilot
            </Link>
          </article>
          <article className="hp-plan">
            <p className="hp-plan__cap">Standard</p>
            <p className="hp-plan__price">
              €49<span className="hp-plan__per"> /month</span>
            </p>
            <p className="hp-plan__desc">
              Full access once the founding plan is full, or any time after.
            </p>
            <ul className="hp-plan__list">
              {STANDARD_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <Link className="mkt-btn-quiet" to="/signup">
              Sign up
            </Link>
          </article>
        </div>
        <p className="hp-plans__foot">
          Both plans include the same feed, matching engine, daily digest and support.{' '}
          <Link to="/pricing">See full pricing details →</Link>
        </p>
      </section>

      <section id="faq" className="mkt-wrap hp-section hp-section--major" aria-labelledby="faq-h">
        <p className="mkt-eyebrow">Questions</p>
        <h2 id="faq-h" className="hp-h2">
          Before you sign up.
        </h2>
        <div className="hp-faqs">
          {FAQS.map((faq) => (
            <div className="hp-faq" key={faq.q}>
              <p className="hp-faq__q">{faq.q}</p>
              <p className="hp-faq__a">{faq.a}</p>
            </div>
          ))}
        </div>
      </section>

      <section
        className="mkt-wrap hp-section hp-section--major hp-section--last"
        aria-labelledby="close-h"
      >
        <div className="hp-close">
          <div>
            <h2 id="close-h">Spend your bid hours on the tenders you can win.</h2>
            <p>
              Qualification is the cheapest stage to get right and the most expensive to get wrong.
              Start with the founding pilot and keep the price for good.
            </p>
          </div>
          <Link className="cta" to="/pilot">
            Join the founding pilot
          </Link>
        </div>
      </section>
    </>
  );
}
