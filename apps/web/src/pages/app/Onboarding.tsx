import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router';
import { COMPANY_PRESETS, CONTRACT_NATURES, type ContractNature } from '@bidmorrow/domain';
import { CPV_SECTORS, SECTOR_LABEL_NOTE, findSector } from '../../lib/cpv-sectors';
import { isIngestedCpvCode } from '../../lib/onboarding-scope';
import { ScopeEstimate } from '../../components/ScopeEstimate';
import { Combobox } from '../../components/Combobox';
import { Logo } from '../../components/Logo';
import { NoIndex } from '../../components/NoIndex';
import { ThemeToggle } from '../../components/ThemeToggle';
import { PRODUCT_NAME } from '../../copy';
import { CPV_SUGGESTIONS } from '../../data/cpv-suggestions';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { localComboboxSource, type ComboboxOption } from '../../lib/combobox-filter';
import {
  CPV_SHORTHAND_LABELS,
  COUNTRY_REGIONS,
  PRESET_CPV_CODES,
} from '../../lib/onboarding-reference-data';
import { computeCpvScopeOverlap } from '../../lib/onboarding-scope';
import {
  CERTIFICATION_CODES,
  type CertificationCode,
  type CertificationDto,
  type ExclusionDto,
  type GeographyDto,
  type KeywordDto,
  type OrgProfileResponse,
} from '../../lib/onboarding-types';

/**
 * Onboarding overhaul (M1, docs/redesign/ux-strategy.md §3): a 4-phase setup
 * assistant — Company, Coverage, Signals, Review — mapping 12 focused
 * screens one-to-one onto the SAME per-resource endpoints the old 9-step
 * wizard already called, with byte-identical payloads. No API change.
 */

type ScreenId =
  | 'workspace'
  | 'basics'
  | 'preset'
  | 'cpv'
  | 'countries'
  | 'value'
  | 'keywords'
  | 'capabilities'
  | 'exclusions'
  | 'digest'
  | 'review';

type ResourceKey =
  'profile' | 'cpv' | 'countries' | 'value' | 'keywords' | 'capabilities' | 'exclusions' | 'digest';

type ReviewState = 'saved' | 'will-save' | 'empty';

interface ScreenMeta {
  readonly id: ScreenId;
  readonly phase: 0 | 1 | 2 | 3;
  readonly title: string;
}

const SCREENS: readonly ScreenMeta[] = [
  { id: 'workspace', phase: 0, title: 'Create workspace' },
  { id: 'basics', phase: 0, title: 'Company basics' },
  { id: 'preset', phase: 1, title: 'Start from a preset' },
  { id: 'cpv', phase: 1, title: 'CPV codes' },
  { id: 'countries', phase: 1, title: 'Countries' },
  { id: 'value', phase: 1, title: 'Value & deadline' },
  { id: 'keywords', phase: 2, title: 'Keywords' },
  { id: 'capabilities', phase: 2, title: 'Capabilities & certifications' },
  { id: 'exclusions', phase: 2, title: 'Exclusions' },
  { id: 'digest', phase: 3, title: 'Digest' },
  { id: 'review', phase: 3, title: 'Review' },
];

type StepId = 'company' | 'sector' | 'scope' | 'fit' | 'digest';

interface StepMeta {
  readonly id: StepId;
  /** Stepper label. */
  readonly label: string;
  readonly title: string;
  readonly blurb: string;
  /** Existing screen bodies shown together under this step. */
  readonly screens: readonly ScreenId[];
  /**
   * Resources this step persists, in the order they must be written. The
   * step's single Continue runs them in sequence and stops at the first
   * failure, so an error surfaces next to the fields that caused it rather
   * than three steps later on Review.
   */
  readonly saves: readonly ResourceKey[];
}

/**
 * The 2026-08-21 handoff compresses the 12-screen assistant into five steps.
 *
 * The screen bodies themselves are unchanged: each step simply shows several
 * of them at once, so all of the existing per-resource state, validation,
 * dirty-tracking and resume behaviour carries over intact rather than being
 * rewritten. What changes is navigation — one Continue per step instead of
 * one per resource — and the progress model the stepper reports.
 */
const STEPS: readonly StepMeta[] = [
  {
    id: 'company',
    label: 'Company',
    title: 'Who is bidding?',
    blurb:
      'Your workspace name is the only required field. Everything else makes the matching better and stays editable in Settings.',
    screens: ['workspace', 'basics'],
    saves: ['profile'],
  },
  {
    id: 'sector',
    label: 'Starting point',
    title: 'What line of work are you in?',
    blurb:
      'Pick the sector closest to your work and BidMorrow fills in a starting set of CPV codes. Nothing is hidden — you see every code on the next step and can change all of it.',
    screens: ['preset'],
    saves: [],
  },
  {
    id: 'scope',
    label: 'Scope',
    title: 'What you sell, and where.',
    blurb:
      'This is the step that decides whether a tender is scored for you at all. The estimate shows what these choices would have returned over the last 30 days.',
    screens: ['cpv', 'countries'],
    saves: ['cpv', 'countries'],
  },
  {
    id: 'fit',
    label: 'Fit',
    title: 'What counts as a real opportunity.',
    blurb:
      'Contract size, how much runway you need before a deadline, the words that describe your work, and the phrases that mean a notice is never for you.',
    screens: ['value', 'keywords', 'capabilities', 'exclusions'],
    saves: ['value', 'keywords', 'capabilities', 'exclusions'],
  },
  {
    id: 'digest',
    label: 'Digest & review',
    title: 'How you hear about it.',
    blurb: 'One digest a day at most, then a look at everything you have set before it goes live.',
    screens: ['digest', 'review'],
    saves: ['digest'],
  },
];

function stepIndexOfScreen(id: ScreenId): number {
  const index = STEPS.findIndex((step) => step.screens.includes(id));
  if (index === -1) throw new Error(`onboarding screen ${id} belongs to no step`);
  return index;
}

function stepAt(index: number): StepMeta {
  const step = STEPS[index];
  if (step === undefined) throw new Error(`unknown onboarding step index: ${String(index)}`);
  return step;
}

function screenIndexOf(id: ScreenId): number {
  const index = SCREENS.findIndex((s) => s.id === id);
  if (index === -1) throw new Error(`unknown onboarding screen id: ${id}`);
  return index;
}

/** Safe indexed access into the static `SCREENS` array — `screenIndex`
 * state is always clamped to `[0, REVIEW_SCREEN_INDEX]` by `advance`/
 * `retreat`/the resume effect, so this never actually falls back; the
 * fallback only exists to satisfy `noUncheckedIndexedAccess`. */
function screenAt(index: number): ScreenMeta {
  return SCREENS[index] ?? SCREENS[0] ?? { id: 'workspace', phase: 0, title: 'Create workspace' };
}

const BASICS_SCREEN_INDEX = screenIndexOf('basics');
const REVIEW_SCREEN_INDEX = screenIndexOf('review');

/** Which screen a Review row's "Edit" link jumps to. */
/** Save order for the whole profile — used by Review's finish sweep. */
const RESOURCE_ORDER: readonly ResourceKey[] = [
  'profile',
  'cpv',
  'countries',
  'value',
  'keywords',
  'capabilities',
  'exclusions',
  'digest',
];

const RESOURCE_SCREEN_INDEX: Record<ResourceKey, number> = {
  profile: screenIndexOf('basics'),
  cpv: screenIndexOf('cpv'),
  countries: screenIndexOf('countries'),
  value: screenIndexOf('value'),
  keywords: screenIndexOf('keywords'),
  capabilities: screenIndexOf('capabilities'),
  exclusions: screenIndexOf('exclusions'),
  digest: screenIndexOf('digest'),
};

const EMPLOYEE_BAND_OPTIONS = ['1-10', '11-25', '26-50', '51-100', '101-250', '250+'];

/** Module-level (not per-render) Combobox options/source for the CPV
 * screen's "add another code" field — the FULL curated CPV suggestion set
 * (`data/cpv-suggestions.ts`, 141 entries), distinct from the smaller
 * `PRESET_CPV_CODES` checkbox list above (codes that appear in a bundled
 * preset) since this field is specifically for codes beyond the presets. */
const CPV_COMBOBOX_OPTIONS: readonly ComboboxOption[] = CPV_SUGGESTIONS.map((suggestion) => ({
  value: suggestion.code,
  label: suggestion.label,
  sublabel: suggestion.code,
}));
const cpvComboboxSource = localComboboxSource(CPV_COMBOBOX_OPTIONS);

interface BillingStatusLite {
  entitlement: { active: boolean };
}

/** Mirrors the worker's own 422 `cap_exceeded` shape (packages/db repos). */
function describeSaveError(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 422) {
    const body = cause.body as { error?: string; cap?: number } | null;
    if (body?.error === 'cap_exceeded') {
      return body.cap !== undefined
        ? `You've reached the limit of ${String(body.cap)} items for this list — remove one before adding another.`
        : "You've reached the limit for this list — remove an item before adding another.";
    }
  }
  return 'Could not save this step. Please try again.';
}

function pluralize(count: number, word: string): string {
  if (count === 1) return `1 ${word}`;
  const plural = word.endsWith('y') ? `${word.slice(0, -1)}ies` : `${word}s`;
  return `${String(count)} ${plural}`;
}

export function Onboarding(): ReactElement {
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const [screenIndex, setScreenIndex] = useState(0);
  const [editingFromReview, setEditingFromReview] = useState(false);
  const [hasOrg, setHasOrg] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Record<ResourceKey, boolean>>({
    profile: false,
    cpv: false,
    countries: false,
    value: false,
    keywords: false,
    capabilities: false,
    exclusions: false,
    digest: false,
  });

  // Workspace (org name)
  const [orgName, setOrgName] = useState('');

  // Company basics + preset
  const [presetKey, setPresetKey] = useState<string>('');
  /** Sector shortcut chosen on the preset screen; pre-fills CPV codes only. */
  const [sectorId, setSectorId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [employeeBand, setEmployeeBand] = useState('');

  // CPV codes
  const [cpvCodes, setCpvCodes] = useState<string[]>([]);
  const [manualCpv, setManualCpv] = useState('');
  const [manualCpvError, setManualCpvError] = useState<string | null>(null);
  const [cpvSearch, setCpvSearch] = useState('');

  // Countries / geographies
  const [countries, setCountries] = useState<string[]>([]);
  const [countrySearch, setCountrySearch] = useState('');
  const [nutsInput, setNutsInput] = useState('');
  const [nutsCodes, setNutsCodes] = useState<string[]>([]);

  // Value + deadline
  const [minValueEur, setMinValueEur] = useState('');
  const [maxValueEur, setMaxValueEur] = useState('');
  const [supportedNatures, setSupportedNatures] = useState<ContractNature[]>([...CONTRACT_NATURES]);
  const [minimumDaysRemaining, setMinimumDaysRemaining] = useState('');

  // Keywords
  const [keywords, setKeywords] = useState<KeywordDto[]>([]);
  const [keywordInput, setKeywordInput] = useState('');

  // Capabilities + certifications
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [capabilityInput, setCapabilityInput] = useState('');
  const [certifications, setCertifications] = useState<CertificationDto[]>([]);
  const [newCertCode, setNewCertCode] = useState<CertificationCode>('ISO_27001');
  const [newCertLabel, setNewCertLabel] = useState('');

  // Exclusions
  const [exclusions, setExclusions] = useState<ExclusionDto[]>([]);
  const [exclusionInput, setExclusionInput] = useState('');

  // Digest
  const [digestEnabled, setDigestEnabled] = useState(true);
  const [digestSendEmpty, setDigestSendEmpty] = useState(false);
  const [digestMinClassification, setDigestMinClassification] = useState('WORTH_REVIEWING');
  const [digestTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);

  // Review / finish
  const [failedResourceLabel, setFailedResourceLabel] = useState<string | null>(null);
  const [scopeOverlapWarning, setScopeOverlapWarning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [hasActiveSubscription, setHasActiveSubscription] = useState<boolean | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [screenIndex, completed]);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const res = await api.get<OrgProfileResponse>('/api/org/profile');
        if (cancelled) return;
        setHasOrg(true);

        if (res.profile === null) {
          setScreenIndex(BASICS_SCREEN_INDEX);
          return;
        }

        if (res.profile.onboardingCompletedAt !== null) {
          // R3 (docs/redesign/ux-strategy.md §1.3): never re-run the wizard
          // on an already-onboarded org — Settings is the editing surface.
          void navigate('/app', { replace: true });
          return;
        }

        setDisplayName(res.profile.displayName ?? '');
        setDescription(res.profile.description ?? '');
        setWebsite(res.profile.website ?? '');
        setEmployeeBand(res.profile.employeeBand ?? '');
        setPresetKey(res.profile.presetKey ?? '');
        setSaved((s) => ({ ...s, profile: true }));

        if (res.matching !== null) {
          setMinValueEur(res.matching.minValueEur !== null ? String(res.matching.minValueEur) : '');
          setMaxValueEur(res.matching.maxValueEur !== null ? String(res.matching.maxValueEur) : '');
          setMinimumDaysRemaining(
            res.matching.minimumDaysRemaining !== null
              ? String(res.matching.minimumDaysRemaining)
              : '',
          );
          setSupportedNatures(
            JSON.parse(res.matching.supportedContractNaturesJson) as ContractNature[],
          );
          setSaved((s) => ({ ...s, value: true }));
        }
        if (res.digest !== null) {
          setDigestEnabled(res.digest.enabled === 1);
          setDigestSendEmpty(res.digest.sendEmpty === 1);
          setDigestMinClassification(res.digest.minClassification);
          setSaved((s) => ({ ...s, digest: true }));
        }

        // Company phase is already complete — resume at the start of
        // Coverage. Resume granularity beyond these GETs is best-effort by
        // design (ux-strategy.md §3.3) — Review is the safety net.
        setScreenIndex(screenIndexOf('preset'));

        // Best-effort prefill of the remaining resources — a failure here
        // shouldn't block the rest of the wizard from rendering.
        void api
          .get<{ cpvPreferences: { cpvCode: string }[] }>('/api/org/cpv-preferences')
          .then((r) => {
            const codes = r.cpvPreferences.map((c) => c.cpvCode);
            setCpvCodes(codes);
            if (codes.length > 0) setSaved((s) => ({ ...s, cpv: true }));
          })
          .catch(() => undefined);
        void api
          .get<{ geographies: GeographyDto[] }>('/api/org/geographies')
          .then((r) => {
            const opportunityCountries = r.geographies
              .filter((g) => g.kind === 'opportunity_country')
              .map((g) => g.code);
            const preferredNuts = r.geographies
              .filter((g) => g.kind === 'preferred_nuts')
              .map((g) => g.code);
            setCountries(opportunityCountries);
            setNutsCodes(preferredNuts);
            if (opportunityCountries.length > 0 || preferredNuts.length > 0) {
              setSaved((s) => ({ ...s, countries: true }));
            }
          })
          .catch(() => undefined);
        void api
          .get<{ keywords: KeywordDto[] }>('/api/org/keywords')
          .then((r) => {
            setKeywords(r.keywords);
            if (r.keywords.length > 0) setSaved((s) => ({ ...s, keywords: true }));
          })
          .catch(() => undefined);
        void api
          .get<{ capabilities: { label: string }[] }>('/api/org/capabilities')
          .then((r) => {
            const labels = r.capabilities.map((c) => c.label);
            setCapabilities(labels);
            if (labels.length > 0) setSaved((s) => ({ ...s, capabilities: true }));
          })
          .catch(() => undefined);
        void api
          .get<{ certifications: CertificationDto[] }>('/api/org/certifications')
          .then((r) => {
            setCertifications(r.certifications);
            if (r.certifications.length > 0) setSaved((s) => ({ ...s, capabilities: true }));
          })
          .catch(() => undefined);
        void api
          .get<{ exclusions: ExclusionDto[] }>('/api/org/exclusions')
          .then((r) => {
            setExclusions(r.exclusions);
            if (r.exclusions.length > 0) setSaved((s) => ({ ...s, exclusions: true }));
          })
          .catch(() => undefined);
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof ApiError && (cause.status === 403 || cause.status === 401)) {
          setHasOrg(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  function markDirty(key: ResourceKey): void {
    setSaved((s) => ({ ...s, [key]: false }));
  }
  function markSaved(key: ResourceKey): void {
    setSaved((s) => ({ ...s, [key]: true }));
  }

  const stepIndex = stepIndexOfScreen(screenAt(screenIndex).id);
  const currentStep = stepAt(stepIndex);

  /** Is this screen body part of the step being shown? */
  function inStep(id: ScreenId): boolean {
    return currentStep.screens.includes(id);
  }

  function goToStep(index: number): void {
    const clamped = Math.min(Math.max(index, 0), STEPS.length - 1);
    const first = stepAt(clamped).screens[0];
    if (first !== undefined) setScreenIndex(screenIndexOf(first));
  }

  function advance(): void {
    if (editingFromReview) {
      setEditingFromReview(false);
      setScreenIndex(REVIEW_SCREEN_INDEX);
      return;
    }
    goToStep(stepIndex + 1);
  }

  function handleBack(): void {
    if (editingFromReview) {
      setEditingFromReview(false);
      setScreenIndex(REVIEW_SCREEN_INDEX);
      return;
    }
    goToStep(stepIndex - 1);
  }

  function editRow(key: ResourceKey): void {
    setError(null);
    setEditingFromReview(true);
    setScreenIndex(RESOURCE_SCREEN_INDEX[key]);
  }

  async function createOrganizationIfNeeded(): Promise<boolean> {
    if (hasOrg === true) return true;
    try {
      await api.post('/api/org', { name: orgName });
      setHasOrg(true);
      return true;
    } catch {
      setError('Could not create your workspace. Please try again.');
      return false;
    }
  }

  /**
   * The single Continue for a step: create the workspace if this is the first
   * step and there isn't one yet, then write each of the step's resources in
   * order, stopping at the first failure so the error lands next to the
   * fields that caused it. Only a fully-saved step advances.
   */
  async function continueStep(): Promise<void> {
    setBusy(true);
    setError(null);
    setFailedResourceLabel(null);
    try {
      if (currentStep.id === 'company' && !(await createOrganizationIfNeeded())) return;
      for (const key of currentStep.saves) {
        const saver = RESOURCE_SAVERS[key];
        const ok = await saver.run();
        if (!ok) {
          setFailedResourceLabel(saver.label);
          setError(`Could not save "${saver.label}" — please review it and try again.`);
          return;
        }
        markSaved(key);
      }
      advance();
    } finally {
      setBusy(false);
    }
  }

  async function putProfile(fields: {
    displayName: string;
    description: string;
    website: string;
    employeeBand: string;
    presetKey: string;
  }): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await api.put('/api/org/profile', {
        displayName: fields.displayName.length > 0 ? fields.displayName : null,
        description: fields.description.length > 0 ? fields.description : null,
        website: fields.website.length > 0 ? fields.website : null,
        employeeBand: fields.employeeBand.length > 0 ? fields.employeeBand : null,
        presetKey: fields.presetKey.length > 0 ? fields.presetKey : null,
        onboardingCompletedAt: null,
      });
      return true;
    } catch (cause) {
      setError(describeSaveError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function saveBasics(): Promise<boolean> {
    return putProfile({ displayName, description, website, employeeBand, presetKey });
  }

  /**
   * Fix for the F14 preset-prefill-loss defect: selecting a preset
   * immediately re-PUTs the profile with the new `presetKey` (same
   * endpoint/shape as every other profile save — idempotent), AND marks
   * cpv/keywords/capabilities dirty so the Review screen's reconciliation
   * (§3.6) will force-save them on finish even if their own screens get
   * Skipped afterward.
   */
  async function selectPreset(key: string): Promise<void> {
    setPresetKey(key);
    const preset = COMPANY_PRESETS.find((p) => p.key === key);
    if (preset !== undefined) {
      setCpvCodes([...preset.cpvCodes]);
      setKeywords(
        preset.keywords.map((k) => ({
          ...k,
          synonymGroup: k.synonymGroup ?? null,
          language: k.language ?? null,
        })),
      );
      setCapabilities([...preset.capabilities]);
    }
    setSaved((s) => ({ ...s, cpv: false, keywords: false, capabilities: false }));
    const ok = await putProfile({
      displayName,
      description,
      website,
      employeeBand,
      presetKey: key,
    });
    if (ok) setSaved((s) => ({ ...s, profile: true }));
  }

  /**
   * Sector shortcut — pre-fills CPV codes only.
   *
   * Deliberately narrower than `selectPreset`: a preset also carries keywords
   * and capabilities that were written for IT consultancies, and applying
   * those to a catering company would be worse than leaving them empty.
   * Sector selection is also not persisted as `presetKey`, because it is not
   * one of the bundled presets and claiming otherwise would misreport what
   * the profile was built from.
   */
  function selectSector(id: string): void {
    const sector = findSector(id);
    if (sector === null) return;
    setSectorId(id);
    setPresetKey('');
    setCpvCodes(sector.codes.map((entry) => entry.code));
    setSaved((s) => ({ ...s, cpv: false }));
  }

  async function saveCpv(): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await api.put('/api/org/cpv-preferences', { cpvCodes });
      return true;
    } catch (cause) {
      setError(describeSaveError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveGeographies(): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const geographies: GeographyDto[] = [
        ...countries.map((code): GeographyDto => ({ kind: 'opportunity_country', code })),
        ...nutsCodes.map((code): GeographyDto => ({ kind: 'preferred_nuts', code })),
      ];
      await api.put('/api/org/geographies', { geographies });
      return true;
    } catch (cause) {
      setError(describeSaveError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveMatchingPreferences(): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await api.put('/api/org/matching-preferences', {
        minValueEur: minValueEur.length > 0 ? Number(minValueEur) : null,
        maxValueEur: maxValueEur.length > 0 ? Number(maxValueEur) : null,
        supportedContractNatures: supportedNatures,
        minimumDaysRemaining: minimumDaysRemaining.length > 0 ? Number(minimumDaysRemaining) : null,
      });
      return true;
    } catch (cause) {
      setError(describeSaveError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveKeywords(): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await api.put('/api/org/keywords', { keywords });
      return true;
    } catch (cause) {
      setError(describeSaveError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveCapabilitiesAndCertifications(): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await api.put('/api/org/capabilities', { labels: capabilities });
      await api.put('/api/org/certifications', { certifications });
      return true;
    } catch (cause) {
      setError(describeSaveError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveExclusions(): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await api.put('/api/org/exclusions', { exclusions });
      return true;
    } catch (cause) {
      setError(describeSaveError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveDigestPreferences(): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await api.put('/api/org/digest-preferences', {
        enabled: digestEnabled,
        sendEmpty: digestSendEmpty,
        minClassification: digestMinClassification,
        timezone: digestTimezone,
      });
      return true;
    } catch (cause) {
      setError(describeSaveError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function complete(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ scopeOverlapWarning: boolean }>('/api/org/onboarding/complete');
      setScopeOverlapWarning(res.scopeOverlapWarning);
      // Best-effort: know whether the Done screen should show the
      // "start your subscription" step truthfully (ux-strategy.md §3.7). A
      // failure here just hides that one line — never blocks completion.
      void api
        .get<BillingStatusLite>('/api/billing/status')
        .then((b) => setHasActiveSubscription(b.entitlement.active))
        .catch(() => setHasActiveSubscription(null));
      // Deliberately no `refresh()` here: it flips `AuthContext.loading`,
      // which unmounts `ProtectedRoute`'s children (this component,
      // including its local `completed` state) and remounts them — the
      // fresh mount's own resume effect would then see the now-complete
      // profile and redirect to /app before the Done screen (§3.7's
      // subscribe-seam messaging) ever renders. Nothing about the identity
      // session itself changed by finishing onboarding, so there's nothing
      // for auth-context to refresh.
      setCompleted(true);
    } catch {
      setError('Could not finish setup. Please review your company profile and try again.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * One place naming every resource, its human label and how to persist it.
   * Both the per-step Continue and Review's "Finish setup" walk this, so a
   * resource cannot be saved by one path and forgotten by the other.
   *
   * `profile` leads: `POST /onboarding/complete` 409s without an existing
   * company_profiles row, so it always has to run at least once even if the
   * user never touched Company basics.
   */
  const RESOURCE_SAVERS: Record<ResourceKey, { label: string; run: () => Promise<boolean> }> = {
    profile: { label: 'Company profile', run: saveBasics },
    cpv: { label: 'CPV codes', run: saveCpv },
    countries: { label: 'Countries', run: saveGeographies },
    value: { label: 'Value & deadline', run: saveMatchingPreferences },
    keywords: { label: 'Keywords', run: saveKeywords },
    capabilities: {
      label: 'Capabilities & certifications',
      run: saveCapabilitiesAndCertifications,
    },
    exclusions: { label: 'Exclusions', run: saveExclusions },
    digest: { label: 'Digest', run: saveDigestPreferences },
  };

  /**
   * Review "Finish setup" (fix for F14/§3.6): fires every outstanding PUT
   * for a resource whose local state was never explicitly saved — including
   * preset-prefilled-but-skipped resources — THEN calls
   * `POST /onboarding/complete`. Stops on the first failure and leaves the
   * user on Review with the failing resource named, per spec.
   */
  async function finishSetup(): Promise<void> {
    setError(null);
    setFailedResourceLabel(null);
    for (const key of RESOURCE_ORDER) {
      if (saved[key]) continue;
      const saver = RESOURCE_SAVERS[key];
      const ok = await saver.run();
      if (!ok) {
        setFailedResourceLabel(saver.label);
        setError(`Could not save "${saver.label}" — please review it and try again.`);
        return;
      }
      markSaved(key);
    }
    await complete();
  }

  function toggleCpv(code: string): void {
    setCpvCodes((codes) =>
      codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code].slice(0, 30),
    );
    markDirty('cpv');
  }
  function addManualCpv(): void {
    const trimmed = manualCpv.trim();
    if (trimmed.length === 0) return;
    if (!/^\d{8}$/.test(trimmed)) {
      setManualCpvError('CPV codes are 8 digits (for example 72220000).');
      return;
    }
    setManualCpvError(null);
    toggleCpv(trimmed);
    setManualCpv('');
  }
  /** Combobox suggestion commit — an ADD only (never a toggle-off): a
   * suggestion is a known-good 8-digit code by dataset construction, so no
   * regex re-check is needed, but re-selecting an already-chosen one must
   * stay a no-op rather than silently removing it (unlike `toggleCpv`,
   * which the preset checkbox list intentionally treats as toggle-on/off). */
  function commitCpvSuggestion(option: ComboboxOption): void {
    if (!cpvCodes.includes(option.value) && cpvCodes.length < 30) {
      setCpvCodes((codes) => [...codes, option.value]);
      markDirty('cpv');
    }
    setManualCpv('');
    setManualCpvError(null);
  }

  function toggleCountry(code: string): void {
    setCountries((cs) => (cs.includes(code) ? cs.filter((c) => c !== code) : [...cs, code]));
    markDirty('countries');
  }
  function toggleRegion(codes: readonly string[], select: boolean): void {
    setCountries((cs) =>
      select ? [...new Set([...cs, ...codes])] : cs.filter((c) => !codes.includes(c)),
    );
    markDirty('countries');
  }
  function addNuts(): void {
    if (nutsInput.trim().length === 0) return;
    setNutsCodes((n) => [...n, nutsInput.trim()]);
    setNutsInput('');
    markDirty('countries');
  }

  const cpvScope = computeCpvScopeOverlap(cpvCodes);
  const minValueOverMax =
    minValueEur.length > 0 && maxValueEur.length > 0 && Number(minValueEur) > Number(maxValueEur);

  if (hasOrg === null) {
    return (
      <div className="assistant-frame">
        <main id="main-content" className="assistant-main">
          <p>Loading…</p>
        </main>
      </div>
    );
  }

  if (completed) {
    return (
      <div className="assistant-frame">
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <title>{`You're all set — Onboarding — ${PRODUCT_NAME}`}</title>
        <NoIndex />
        <OnboardingHeader />
        <main id="main-content" className="assistant-main">
          <StepStepper currentStepIndex={STEPS.length} />
          <div className="assistant-card">
            <h2 className="ob-section-title">You're all set</h2>
            {scopeOverlapWarning && (
              <p role="alert" className="form-warning scope-warning">
                <strong>Heads up:</strong> your CPV preferences don't currently overlap with
                BidMorrow's ingestion scope, so you may not see any matches yet. Review your CPV
                preferences in Settings, or read the <Link to="/methodology">methodology page</Link>{' '}
                to understand what's in scope.
              </p>
            )}
            <p>Your scoring profile is active.</p>
            <ul className="ob-checklist">
              <li>
                <span className="ob-checklist__mark ob-checklist__mark--done" aria-hidden="true">
                  ✓
                </span>
                Company profile saved
              </li>
              {hasActiveSubscription === false && (
                <li>
                  <span className="ob-checklist__mark" aria-hidden="true">
                    ○
                  </span>
                  Start your subscription — your feed and daily digest activate with it.
                </li>
              )}
              <li>
                <span className="ob-checklist__mark" aria-hidden="true">
                  ○
                </span>
                First matches: ingestion and matching run daily — expect your first scored tenders
                by tomorrow, and a digest email when there's something worth your attention.
              </li>
            </ul>
            <div className="step-actions">
              {hasActiveSubscription === false && (
                <button
                  className="cta"
                  type="button"
                  onClick={() => void navigate('/app/settings#billing')}
                >
                  Start subscription
                </button>
              )}
              <button
                type="button"
                className={hasActiveSubscription === true ? 'cta' : 'btn-quiet'}
                onClick={() => void navigate('/app')}
              >
                Go to your feed
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="assistant-frame">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <title>{`${currentStep.title} — Onboarding — ${PRODUCT_NAME}`}</title>
      <NoIndex />
      <OnboardingHeader />
      <main id="main-content" className="assistant-main">
        <StepStepper currentStepIndex={stepIndex} />
        {/* Decorative determinate fill under the stepper — the aria-live
            text below is the accessible source of truth (docs/redesign/
            app-interface-spec.md §7.2b). Native <progress>, never an inline
            width (CSP style-src 'self'). */}
        <progress
          className="score-bar assistant-meter"
          value={stepIndex}
          max={STEPS.length - 1}
          aria-hidden="true"
        />
        <p className="assistant-progress" aria-live="polite">
          Step {stepIndex + 1} of {STEPS.length} · {currentStep.label}
        </p>
        <div className="assistant-card">
          {error !== null && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}

          <div className="assistant-screen" key={currentStep.id}>
            <h1 ref={headingRef} tabIndex={-1}>
              {currentStep.title}
            </h1>
            <p className="assistant-why">{currentStep.blurb}</p>
            {inStep('workspace') && hasOrg !== true && (
              <>
                <h2 className="ob-section-title">Name your workspace</h2>
                <p>
                  This is your organization's account name — you can change it later in Settings.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void continueStep();
                  }}
                >
                  <div className="form-field">
                    <label htmlFor="org-name">Organization name</label>
                    <input
                      id="org-name"
                      required
                      value={orgName}
                      onChange={(event) => setOrgName(event.target.value)}
                    />
                  </div>
                </form>
              </>
            )}

            {inStep('basics') && (
              <>
                <h2 className="ob-section-title">Tell us about your company</h2>
                <p className="assistant-why">
                  Used to personalize your account — not a scoring input itself.
                </p>
                <div className="form-field">
                  <label htmlFor="display-name">Company name</label>
                  <input
                    id="display-name"
                    value={displayName}
                    onChange={(event) => {
                      setDisplayName(event.target.value);
                      markDirty('profile');
                    }}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="description">Description</label>
                  <textarea
                    id="description"
                    value={description}
                    onChange={(event) => {
                      setDescription(event.target.value);
                      markDirty('profile');
                    }}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="website">Website</label>
                  <input
                    id="website"
                    type="url"
                    value={website}
                    onChange={(event) => {
                      setWebsite(event.target.value);
                      markDirty('profile');
                    }}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="employee-band">Company size</label>
                  <select
                    id="employee-band"
                    value={employeeBand}
                    onChange={(event) => {
                      setEmployeeBand(event.target.value);
                      markDirty('profile');
                    }}
                  >
                    <option value="">Prefer not to say</option>
                    {(employeeBand.length > 0 && !EMPLOYEE_BAND_OPTIONS.includes(employeeBand)
                      ? [...EMPLOYEE_BAND_OPTIONS, employeeBand]
                      : EMPLOYEE_BAND_OPTIONS
                    ).map((band) => (
                      <option key={band} value={band}>
                        {band} employees
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {inStep('preset') && (
              <>
                <h2 className="ob-section-title">Start from a preset</h2>
                <p className="assistant-why">
                  A preset only pre-fills CPV codes, keywords, and capabilities — the next few
                  screens save each one to your account, and you can edit everything before it's
                  used.
                </p>

                <fieldset className="ob-sector-fieldset">
                  <legend>Not an IT company? Start from your sector</legend>
                  <p className="hint">
                    Every CPV sector, not just IT. Picking one fills in a starting set of CPV codes
                    on the next step — you see every code there and can change all of it.
                  </p>
                  <div className="ob-sector-grid">
                    {CPV_SECTORS.map((sector) => (
                      <label
                        key={sector.id}
                        className={
                          sectorId === sector.id
                            ? 'ob-sector-card ob-sector-card--selected'
                            : 'ob-sector-card'
                        }
                      >
                        <input
                          type="radio"
                          name="sector"
                          value={sector.id}
                          checked={sectorId === sector.id}
                          onChange={() => selectSector(sector.id)}
                        />
                        <span className="ob-sector-card__label">{sector.label}</span>
                        <span className="ob-sector-card__divisions num">
                          CPV {sector.divisions}
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="hint">{SECTOR_LABEL_NOTE}</p>
                </fieldset>

                <div className="ob-preset-grid" role="radiogroup" aria-label="Company preset">
                  {COMPANY_PRESETS.map((preset) => (
                    <div
                      key={preset.key}
                      className={
                        presetKey === preset.key
                          ? 'ob-preset-card ob-preset-card--selected'
                          : 'ob-preset-card'
                      }
                    >
                      <label>
                        <input
                          type="radio"
                          name="preset"
                          value={preset.key}
                          checked={presetKey === preset.key}
                          onChange={() => void selectPreset(preset.key)}
                        />{' '}
                        <span className="ob-preset-card__label">{preset.label}</span>
                      </label>
                      <p className="ob-preset-card__desc">{preset.description}</p>
                      <p className="ob-preset-card__stats">
                        {pluralize(preset.cpvCodes.length, 'CPV code')} ·{' '}
                        {pluralize(preset.keywords.length, 'keyword')} ·{' '}
                        {pluralize(preset.capabilities.length, 'capability')}
                      </p>
                      <details>
                        <summary>Preview what this fills in</summary>
                        <p>CPV codes: {preset.cpvCodes.join(', ')}</p>
                        <p>Keywords: {preset.keywords.map((k) => k.term).join(', ')}</p>
                        <p>Capabilities: {preset.capabilities.join(', ')}</p>
                      </details>
                    </div>
                  ))}
                  <div
                    className={
                      presetKey === ''
                        ? 'ob-preset-card ob-preset-card--selected'
                        : 'ob-preset-card'
                    }
                  >
                    <label>
                      <input
                        type="radio"
                        name="preset"
                        value=""
                        checked={presetKey === ''}
                        onChange={() => void selectPreset('')}
                      />{' '}
                      <span className="ob-preset-card__label">Start from scratch</span>
                    </label>
                    <p className="ob-preset-card__desc">
                      Build your own CPV, keyword, and capability list — you'll need to add at least
                      one CPV code on the next step.
                    </p>
                  </div>
                </div>
              </>
            )}

            {inStep('cpv') && (
              <>
                <h2 className="ob-section-title">Which CPV codes describe your work?</h2>
                <p className="assistant-why">
                  CPV codes drive up to 35 of your 100 points — and decide which tenders get scored
                  at all.
                </p>
                <p>
                  There's no skip on this screen: without at least one CPV code, BidMorrow has
                  nothing to match you against. The fastest way to a valid list is a preset or a
                  sector (go Back to pick one). Every <em>preset</em> code sits inside BidMorrow's
                  current ingestion scope; sector codes outside it are saved to your profile but
                  return nothing until ingestion is widened — the panel below shows exactly what
                  your current selection would have returned.
                </p>
                <ScopeEstimate cpvCodes={cpvCodes} countryCodes={countries} />
                <div className="form-field">
                  <label htmlFor="cpv-search">Search CPV codes</label>
                  <input
                    id="cpv-search"
                    type="search"
                    value={cpvSearch}
                    onChange={(event) => setCpvSearch(event.target.value)}
                    placeholder="e.g. software or 72220000"
                  />
                </div>
                <fieldset>
                  <legend>Suggested CPV codes</legend>
                  {/* Client-side filter only — selected codes filtered out of
                    view stay selected (state is the source of truth), same
                    behavior as the country search above. */}
                  {(() => {
                    // The bundled presets, plus the chosen sector's codes,
                    // plus anything already selected. Without the last two a
                    // sector pick would leave codes selected but invisible —
                    // and therefore impossible to remove here.
                    const labels = new Map<string, string>();
                    for (const code of PRESET_CPV_CODES) {
                      labels.set(code, CPV_SHORTHAND_LABELS[code] ?? 'CPV code');
                    }
                    for (const entry of findSector(sectorId)?.codes ?? []) {
                      labels.set(entry.code, entry.label);
                    }
                    for (const code of cpvCodes) {
                      if (!labels.has(code)) {
                        labels.set(code, CPV_SHORTHAND_LABELS[code] ?? 'CPV code');
                      }
                    }
                    const allCodes = [...labels.keys()];
                    const query = cpvSearch.trim().toLowerCase();
                    const visibleCodes =
                      query.length === 0
                        ? allCodes
                        : allCodes.filter(
                            (code) =>
                              code.toLowerCase().includes(query) ||
                              (labels.get(code) ?? '').toLowerCase().includes(query),
                          );
                    if (visibleCodes.length === 0) {
                      return <p className="hint">No codes match your search.</p>;
                    }
                    return (
                      <ul className="ob-chip-toggle-list">
                        {visibleCodes.map((code) => (
                          <li key={code}>
                            <label
                              className={
                                cpvCodes.includes(code)
                                  ? 'ob-chip-toggle ob-chip-toggle--on'
                                  : 'ob-chip-toggle'
                              }
                            >
                              <input
                                type="checkbox"
                                checked={cpvCodes.includes(code)}
                                onChange={() => toggleCpv(code)}
                              />
                              <span className="ob-chip-toggle__code num">{code}</span>
                              <span className="ob-chip-toggle__label">
                                {labels.get(code) ?? 'CPV code'}
                              </span>
                              {!isIngestedCpvCode(code) && (
                                <span className="ob-chip-toggle__oos">out of scope</span>
                              )}
                            </label>
                          </li>
                        ))}
                      </ul>
                    );
                  })()}
                </fieldset>
                {cpvCodes.some((c) => !PRESET_CPV_CODES.includes(c)) && (
                  <fieldset>
                    <legend>Manually added codes</legend>
                    <ul className="chip-list">
                      {cpvCodes
                        .filter((c) => !PRESET_CPV_CODES.includes(c))
                        .map((code) => (
                          <li key={code}>
                            <span className="num">{code}</span>
                            <button
                              type="button"
                              aria-label={`Remove CPV ${code}`}
                              onClick={() => toggleCpv(code)}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                    </ul>
                  </fieldset>
                )}
                <div className="combobox-add-row">
                  <Combobox
                    id="manual-cpv"
                    label="Add another 8-digit CPV code"
                    value={manualCpv}
                    onValueChange={(value) => {
                      setManualCpv(value);
                      setManualCpvError(null);
                    }}
                    source={cpvComboboxSource}
                    placeholder="e.g. 72220000 or software"
                    hint="A curated shortlist beyond the presets above — any 8-digit CPV code is still accepted."
                    isChosen={(option) => cpvCodes.includes(option.value)}
                    onCommit={commitCpvSuggestion}
                    describedBy={manualCpvError !== null ? 'manual-cpv-error' : undefined}
                  />
                  <button
                    type="button"
                    className="btn-add"
                    aria-label="Add CPV code"
                    onClick={addManualCpv}
                  >
                    Add
                  </button>
                </div>
                {manualCpvError !== null && (
                  <p id="manual-cpv-error" role="alert" className="form-error">
                    {manualCpvError}
                  </p>
                )}
                <p
                  className={
                    cpvCodes.length > 0 && cpvScope.hasOverlap
                      ? 'ob-scope-indicator ob-scope-indicator--ok'
                      : 'ob-scope-indicator ob-scope-indicator--warn'
                  }
                  aria-live="polite"
                >
                  {cpvCodes.length === 0
                    ? 'Select at least one CPV code to continue.'
                    : cpvScope.hasOverlap
                      ? `✓ ${String(cpvScope.inScopeCount)} of your ${String(cpvScope.totalCount)} code${cpvScope.totalCount === 1 ? '' : 's'} ${cpvScope.inScopeCount === 1 ? 'is' : 'are'} inside BidMorrow's current ingestion scope.`
                      : "None of these codes fall inside BidMorrow's current ingestion scope (IT services 72*, software 48*, and a small reviewed extras list). With this list you likely won't see any matches."}
                  {cpvCodes.length > 0 && !cpvScope.hasOverlap && (
                    <>
                      {' '}
                      <Link to="/methodology">What's covered →</Link>
                    </>
                  )}
                </p>
              </>
            )}

            {inStep('countries') && (
              <>
                <h2 className="ob-section-title">
                  Which countries' opportunities do you want to see?
                </h2>
                <p className="assistant-why">
                  Location match is worth up to 15 of your 100 points.
                </p>
                <div className="form-field">
                  <label htmlFor="country-search">Search countries</label>
                  <input
                    id="country-search"
                    value={countrySearch}
                    onChange={(event) => setCountrySearch(event.target.value)}
                    placeholder="e.g. Germany"
                  />
                </div>
                {COUNTRY_REGIONS.map((region) => {
                  const visible = region.countries.filter(
                    (c) =>
                      c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
                      c.code.toLowerCase().includes(countrySearch.toLowerCase()),
                  );
                  if (visible.length === 0) return null;
                  const allSelected = visible.every((c) => countries.includes(c.code));
                  return (
                    <fieldset key={region.label}>
                      <legend className="ob-region-legend">
                        <span>{region.label}</span>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() =>
                            toggleRegion(
                              visible.map((c) => c.code),
                              !allSelected,
                            )
                          }
                        >
                          {allSelected ? 'Clear all' : 'Select all'}
                        </button>
                      </legend>
                      {visible.map((c) => (
                        <label key={c.code} className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={countries.includes(c.code)}
                            onChange={() => toggleCountry(c.code)}
                          />
                          {c.name} <span className="hint num">({c.code})</span>
                        </label>
                      ))}
                    </fieldset>
                  );
                })}
                <details className="ob-advanced">
                  <summary>Advanced: preferred NUTS regions (optional)</summary>
                  <ul className="chip-list">
                    {nutsCodes.map((code, index) => (
                      <li key={`${code}-${index}`}>
                        {code}
                        <button
                          type="button"
                          aria-label={`Remove NUTS region ${code}`}
                          onClick={() => {
                            setNutsCodes((n) => n.filter((_, i) => i !== index));
                            markDirty('countries');
                          }}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="form-field inline">
                    <label htmlFor="nuts-input">Add a preferred NUTS code</label>
                    <input
                      id="nuts-input"
                      value={nutsInput}
                      onChange={(event) => setNutsInput(event.target.value)}
                    />
                    <button
                      type="button"
                      className="btn-add"
                      aria-label="Add NUTS region"
                      onClick={addNuts}
                    >
                      Add
                    </button>
                  </div>
                </details>
              </>
            )}

            {inStep('value') && (
              <>
                <h2 className="ob-section-title">What contract value and timing work for you?</h2>
                <p className="assistant-why">
                  Value fit is worth up to 10 points; a deadline runway below your threshold
                  excludes a tender outright.
                </p>
                <div className="form-field">
                  <label htmlFor="min-value">Minimum contract value (EUR)</label>
                  <input
                    id="min-value"
                    type="number"
                    min={0}
                    value={minValueEur}
                    aria-invalid={minValueOverMax}
                    aria-describedby={minValueOverMax ? 'value-range-error' : undefined}
                    onChange={(event) => {
                      setMinValueEur(event.target.value);
                      markDirty('value');
                    }}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="max-value">Maximum contract value (EUR)</label>
                  <input
                    id="max-value"
                    type="number"
                    min={0}
                    value={maxValueEur}
                    aria-invalid={minValueOverMax}
                    aria-describedby={minValueOverMax ? 'value-range-error' : undefined}
                    onChange={(event) => {
                      setMaxValueEur(event.target.value);
                      markDirty('value');
                    }}
                  />
                </div>
                {minValueOverMax && (
                  <p id="value-range-error" role="alert" className="form-error">
                    Minimum value must be less than or equal to maximum value.
                  </p>
                )}
                <fieldset>
                  <legend>Contract types you support</legend>
                  {CONTRACT_NATURES.map((nature) => (
                    <label key={nature} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={supportedNatures.includes(nature)}
                        onChange={() => {
                          setSupportedNatures((ns) =>
                            ns.includes(nature) ? ns.filter((n) => n !== nature) : [...ns, nature],
                          );
                          markDirty('value');
                        }}
                      />
                      {nature}
                    </label>
                  ))}
                </fieldset>
                <div className="form-field">
                  <label htmlFor="min-days">
                    Minimum days remaining before deadline you're willing to bid
                  </label>
                  <input
                    id="min-days"
                    type="number"
                    min={0}
                    value={minimumDaysRemaining}
                    onChange={(event) => {
                      setMinimumDaysRemaining(event.target.value);
                      markDirty('value');
                    }}
                  />
                </div>
              </>
            )}

            {inStep('keywords') && (
              <>
                <h2 className="ob-section-title">What keywords describe the work you want?</h2>
                <p className="assistant-why">
                  Capability and keyword fit is worth up to 20 of your 100 points.
                </p>
                <p>Your preset's keywords are pre-filled — edit freely.</p>
                <ul className="chip-list">
                  {keywords.map((keyword, index) => (
                    <li key={`${keyword.kind}-${keyword.term}-${index}`}>
                      {keyword.term}
                      <button
                        type="button"
                        aria-label={`Remove keyword ${keyword.term}`}
                        onClick={() => {
                          setKeywords((ks) => ks.filter((_, i) => i !== index));
                          markDirty('keywords');
                        }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="form-field inline">
                  <label htmlFor="keyword-input">Add a keyword</label>
                  <input
                    id="keyword-input"
                    value={keywordInput}
                    onChange={(event) => setKeywordInput(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-add"
                    aria-label="Add keyword"
                    onClick={() => {
                      if (keywordInput.trim().length > 0) {
                        setKeywords((ks) => [
                          ...ks,
                          {
                            kind: 'positive',
                            term: keywordInput.trim(),
                            synonymGroup: null,
                            language: null,
                          },
                        ]);
                        setKeywordInput('');
                        markDirty('keywords');
                      }
                    }}
                  >
                    Add
                  </button>
                </div>
              </>
            )}

            {inStep('capabilities') && (
              <>
                <h2 className="ob-section-title">Capabilities & certifications</h2>
                <p className="assistant-why">
                  Capability and keyword fit is worth up to 20 points; certifications also count
                  toward eligibility signals worth up to 5.
                </p>
                <p>Used in your score explanations — never shown to buyers.</p>
                <fieldset>
                  <legend>Capabilities</legend>
                  <ul className="chip-list">
                    {capabilities.map((label, index) => (
                      <li key={`${label}-${index}`}>
                        {label}
                        <button
                          type="button"
                          aria-label={`Remove capability ${label}`}
                          onClick={() => {
                            setCapabilities((cs) => cs.filter((_, i) => i !== index));
                            markDirty('capabilities');
                          }}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="form-field inline">
                    <label htmlFor="capability-input">Add a capability</label>
                    <input
                      id="capability-input"
                      value={capabilityInput}
                      onChange={(event) => setCapabilityInput(event.target.value)}
                    />
                    <button
                      type="button"
                      className="btn-add"
                      aria-label="Add capability"
                      onClick={() => {
                        if (capabilityInput.trim().length > 0) {
                          setCapabilities((cs) => [...cs, capabilityInput.trim()]);
                          setCapabilityInput('');
                          markDirty('capabilities');
                        }
                      }}
                    >
                      Add
                    </button>
                  </div>
                </fieldset>
                <fieldset>
                  <legend>Certifications</legend>
                  <ul className="chip-list">
                    {certifications.map((cert, index) => (
                      <li key={`${cert.certificationCode}-${index}`}>
                        {cert.certificationCode}
                        {cert.label !== null ? `: ${cert.label}` : ''}
                        <button
                          type="button"
                          aria-label={`Remove certification ${cert.certificationCode}`}
                          onClick={() => {
                            setCertifications((cs) => cs.filter((_, i) => i !== index));
                            markDirty('capabilities');
                          }}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="form-field inline">
                    <label htmlFor="cert-code">Certification</label>
                    <select
                      id="cert-code"
                      value={newCertCode}
                      onChange={(event) => setNewCertCode(event.target.value as CertificationCode)}
                    >
                      {CERTIFICATION_CODES.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                    {newCertCode === 'OTHER' && (
                      <>
                        <label htmlFor="cert-label">Certification name</label>
                        <input
                          id="cert-label"
                          value={newCertLabel}
                          onChange={(event) => setNewCertLabel(event.target.value)}
                        />
                      </>
                    )}
                    <button
                      type="button"
                      className="btn-add"
                      aria-label="Add certification"
                      onClick={() => {
                        if (newCertCode === 'OTHER' && newCertLabel.trim().length === 0) return;
                        setCertifications((cs) => [
                          ...cs,
                          {
                            certificationCode: newCertCode,
                            label: newCertCode === 'OTHER' ? newCertLabel.trim() : null,
                          },
                        ]);
                        setNewCertLabel('');
                        markDirty('capabilities');
                      }}
                    >
                      Add
                    </button>
                  </div>
                </fieldset>
              </>
            )}

            {inStep('exclusions') && (
              <>
                <h2 className="ob-section-title">Anything you want to exclude?</h2>
                <p className="assistant-why">
                  Exclusions remove tenders before scoring — you'll never see them.
                </p>
                <p>
                  Optional. Most companies add these later, once they've seen their feed and know
                  what they want to filter out.
                </p>
                <ul className="chip-list">
                  {exclusions.map((exclusion, index) => (
                    <li key={`${exclusion.kind}-${exclusion.value}-${index}`}>
                      {exclusion.kind}: {exclusion.value}
                      <button
                        type="button"
                        aria-label={`Remove exclusion ${exclusion.value}`}
                        onClick={() => {
                          setExclusions((ex) => ex.filter((_, i) => i !== index));
                          markDirty('exclusions');
                        }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="form-field inline">
                  <label htmlFor="exclusion-input">Add an excluded phrase</label>
                  <input
                    id="exclusion-input"
                    value={exclusionInput}
                    onChange={(event) => setExclusionInput(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-add"
                    aria-label="Add exclusion"
                    onClick={() => {
                      if (exclusionInput.trim().length > 0) {
                        setExclusions((ex) => [
                          ...ex,
                          { kind: 'phrase', value: exclusionInput.trim() },
                        ]);
                        setExclusionInput('');
                        markDirty('exclusions');
                      }
                    }}
                  >
                    Add
                  </button>
                </div>
              </>
            )}

            {inStep('digest') && (
              <>
                <h2 className="ob-section-title">Your daily digest</h2>
                <p className="assistant-why">
                  One email a day, only when there's something worth your attention.
                </p>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={digestEnabled}
                    onChange={(event) => {
                      setDigestEnabled(event.target.checked);
                      markDirty('digest');
                    }}
                  />
                  Send me a daily digest email
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={digestSendEmpty}
                    onChange={(event) => {
                      setDigestSendEmpty(event.target.checked);
                      markDirty('digest');
                    }}
                  />
                  Send the digest even on days with no matches
                </label>
                <div className="form-field">
                  <label htmlFor="digest-min">Minimum classification to include</label>
                  <select
                    id="digest-min"
                    value={digestMinClassification}
                    onChange={(event) => {
                      setDigestMinClassification(event.target.value);
                      markDirty('digest');
                    }}
                  >
                    <option value="STRONG_MATCH">Strong match only</option>
                    <option value="WORTH_REVIEWING">Worth reviewing or better</option>
                    <option value="POSSIBLE_MATCH">Possible match or better</option>
                    <option value="LOW_FIT">Everything</option>
                  </select>
                </div>
                <p className="hint">Your timezone: {digestTimezone} — used for digest timing.</p>
              </>
            )}

            {inStep('review') && (
              <ReviewScreen
                busy={busy}
                failedResourceLabel={failedResourceLabel}
                onBack={() => goToStep(stepIndex - 1)}
                onFinish={() => void finishSetup()}
                onEdit={editRow}
                presetLabel={COMPANY_PRESETS.find((p) => p.key === presetKey)?.label ?? null}
                rows={{
                  profile: {
                    state: rowState(saved, 'profile', false),
                    summary:
                      displayName.length > 0
                        ? displayName
                        : presetKey.length > 0
                          ? 'No company name yet'
                          : 'No company details yet — a blank profile will be created.',
                  },
                  cpv: {
                    state: rowState(saved, 'cpv', cpvCodes.length === 0),
                    summary:
                      cpvCodes.length > 0
                        ? pluralize(cpvCodes.length, 'CPV code')
                        : 'No CPV codes selected',
                  },
                  countries: {
                    state: rowState(
                      saved,
                      'countries',
                      countries.length === 0 && nutsCodes.length === 0,
                    ),
                    summary:
                      countries.length === 0 && nutsCodes.length === 0
                        ? 'No countries selected — matches from anywhere in scope.'
                        : [
                            countries.length > 0
                              ? `${String(countries.length)} ${countries.length === 1 ? 'country' : 'countries'}`
                              : null,
                            nutsCodes.length > 0
                              ? pluralize(nutsCodes.length, 'NUTS region')
                              : null,
                          ]
                            .filter((part): part is string => part !== null)
                            .join(', '),
                  },
                  value: {
                    state: rowState(
                      saved,
                      'value',
                      minValueEur.length === 0 &&
                        maxValueEur.length === 0 &&
                        minimumDaysRemaining.length === 0 &&
                        supportedNatures.length === CONTRACT_NATURES.length,
                    ),
                    summary: valueSummary({
                      minValueEur,
                      maxValueEur,
                      minimumDaysRemaining,
                      supportedNatures,
                    }),
                  },
                  keywords: {
                    state: rowState(saved, 'keywords', keywords.length === 0),
                    summary:
                      keywords.length > 0
                        ? pluralize(keywords.length, 'keyword')
                        : 'No keywords added',
                  },
                  capabilities: {
                    state: rowState(
                      saved,
                      'capabilities',
                      capabilities.length === 0 && certifications.length === 0,
                    ),
                    summary:
                      capabilities.length === 0 && certifications.length === 0
                        ? 'No capabilities or certifications added'
                        : `${pluralize(capabilities.length, 'capability')}, ${pluralize(certifications.length, 'certification')}`,
                  },
                  exclusions: {
                    state: rowState(saved, 'exclusions', exclusions.length === 0),
                    summary:
                      exclusions.length > 0
                        ? pluralize(exclusions.length, 'exclusion')
                        : 'None — you can add these anytime in Settings.',
                  },
                  digest: {
                    state: rowState(saved, 'digest', false),
                    summary: digestEnabled
                      ? `Daily digest on · ${digestMinClassification.replace(/_/g, ' ').toLowerCase()} or better`
                      : 'Daily digest off',
                  },
                }}
              />
            )}

            {/* One Continue per step. The last step is the exception: Review
                carries its own Finish, which additionally sweeps up anything
                still unsaved before completing. */}
            {currentStep.id !== 'digest' && (
              <StepActions
                busy={busy}
                onBack={stepIndex === 0 && hasOrg !== true ? undefined : handleBack}
                onSave={() => void continueStep()}
                saveDisabled={currentStep.id === 'scope' && cpvCodes.length === 0}
                saveLabel={
                  editingFromReview
                    ? 'Save & return to review'
                    : currentStep.id === 'company' && hasOrg !== true
                      ? 'Create workspace & continue'
                      : 'Save & continue'
                }
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function rowState(
  saved: Record<ResourceKey, boolean>,
  key: ResourceKey,
  isEmpty: boolean,
): ReviewState {
  if (saved[key]) return 'saved';
  return isEmpty ? 'empty' : 'will-save';
}

function valueSummary(fields: {
  minValueEur: string;
  maxValueEur: string;
  minimumDaysRemaining: string;
  supportedNatures: ContractNature[];
}): string {
  const parts: string[] = [];
  if (fields.minValueEur.length > 0 || fields.maxValueEur.length > 0) {
    parts.push(`€${fields.minValueEur || '0'}–€${fields.maxValueEur || '∞'}`);
  }
  if (fields.supportedNatures.length !== CONTRACT_NATURES.length) {
    parts.push(
      `${String(fields.supportedNatures.length)} of ${String(CONTRACT_NATURES.length)} contract types`,
    );
  }
  if (fields.minimumDaysRemaining.length > 0) {
    parts.push(`min ${fields.minimumDaysRemaining} days runway`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'No value or deadline limits set — using defaults.';
}

function StepStepper({ currentStepIndex }: { currentStepIndex: number }): ReactElement {
  return (
    <ol className="assistant-phases" aria-label="Setup steps">
      {STEPS.map((step, index) => (
        <li
          key={step.id}
          className="assistant-phase"
          data-state={index < currentStepIndex ? 'done' : undefined}
          aria-current={index === currentStepIndex ? 'step' : undefined}
        >
          {index < currentStepIndex && <span aria-hidden="true">✓ </span>}
          {step.label}
        </li>
      ))}
    </ol>
  );
}

function OnboardingHeader(): ReactElement {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function signOut(): Promise<void> {
    setSignOutError(null);
    try {
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error(`sign-out failed: ${String(response.status)}`);
      await refresh();
      void navigate('/login');
    } catch {
      setSignOutError('Could not log out — please try again.');
    }
  }

  return (
    <header className="assistant-header">
      <span className="wordmark">
        <Logo className="brand-mark" />
        <span className="product-name">{PRODUCT_NAME}</span>
      </span>
      <span className="assistant-header__actions">
        <ThemeToggle />
        <button type="button" onClick={() => void signOut()}>
          Log out
        </button>
      </span>
      {signOutError !== null && (
        <p role="alert" className="form-error">
          {signOutError}
        </p>
      )}
    </header>
  );
}

/**
 * A step's actions. There is no Skip: a step now covers several resources at
 * once, so "skip" had no single meaning — leaving a field blank and
 * continuing already saves nothing for it, which is what Skip did.
 */
function StepActions({
  busy,
  onBack,
  onSave,
  saveLabel,
  saveDisabled = false,
}: {
  busy: boolean;
  /** Omitted on the first step when there is nowhere to go back to. */
  onBack?: (() => void) | undefined;
  onSave: () => void;
  saveLabel?: string | undefined;
  saveDisabled?: boolean;
}): ReactElement {
  return (
    <div className="step-actions">
      {onBack !== undefined && (
        <button type="button" className="btn-quiet" onClick={onBack} disabled={busy}>
          Back
        </button>
      )}
      <button className="cta" type="button" onClick={onSave} disabled={busy || saveDisabled}>
        {saveLabel ?? 'Save & continue'}
      </button>
    </div>
  );
}

interface ReviewRowData {
  readonly state: ReviewState;
  readonly summary: string;
}

function ReviewScreen({
  busy,
  failedResourceLabel,
  onBack,
  onFinish,
  onEdit,
  presetLabel,
  rows,
}: {
  busy: boolean;
  failedResourceLabel: string | null;
  onBack: () => void;
  onFinish: () => void;
  onEdit: (key: ResourceKey) => void;
  presetLabel: string | null;
  rows: Record<ResourceKey, ReviewRowData>;
}): ReactElement {
  const labels: Record<ResourceKey, string> = {
    profile: 'Company profile',
    cpv: 'CPV codes',
    countries: 'Countries',
    value: 'Value & deadline',
    keywords: 'Keywords',
    capabilities: 'Capabilities & certifications',
    exclusions: 'Exclusions',
    digest: 'Digest',
  };
  const order: ResourceKey[] = [
    'profile',
    'cpv',
    'countries',
    'value',
    'keywords',
    'capabilities',
    'exclusions',
    'digest',
  ];

  return (
    <>
      <h2 className="ob-section-title">Review your scoring profile</h2>
      <p>
        This is exactly what will be saved when you finish — including anything a preset filled in
        that you haven't explicitly saved yet.
        {presetLabel !== null && ` Starting preset: ${presetLabel}.`}
      </p>
      {failedResourceLabel !== null && (
        <p role="alert" className="form-error">
          Could not save "{failedResourceLabel}" — nothing after it was saved. Fix it via Edit and
          try Finish setup again.
        </p>
      )}
      <ul className="ob-review-list">
        {order.map((key) => {
          const row = rows[key];
          const mark = row.state === 'saved' ? '✓' : row.state === 'will-save' ? '●' : '○';
          const stateLabel =
            row.state === 'saved'
              ? 'Saved'
              : row.state === 'will-save'
                ? 'Will be saved when you finish'
                : 'Not set — using defaults';
          return (
            <li key={key} className="ob-review-row">
              <span
                className={`ob-review-row__state ob-review-row__state--${row.state}`}
                aria-hidden="true"
              >
                {mark}
              </span>
              <span className="ob-review-row__body">
                <span className="ob-review-row__label">{labels[key]}</span>
                <span className="ob-review-row__summary">
                  <span className="visually-hidden-status">{stateLabel}. </span>
                  {row.summary}
                </span>
              </span>
              <button type="button" className="link-button" onClick={() => onEdit(key)}>
                Edit
              </button>
            </li>
          );
        })}
      </ul>
      <div className="step-actions">
        <button type="button" className="btn-quiet" onClick={onBack} disabled={busy}>
          Back
        </button>
        <button className="cta" type="button" onClick={onFinish} disabled={busy}>
          {busy ? 'Finishing…' : 'Finish setup'}
        </button>
      </div>
    </>
  );
}
