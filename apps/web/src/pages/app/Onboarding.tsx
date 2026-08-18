import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router';
import { COMPANY_PRESETS, CONTRACT_NATURES, type ContractNature } from '@bidmorrow/domain';
import { Combobox } from '../../components/Combobox';
import { Logo } from '../../components/Logo';
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
  | 'welcome'
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

const PHASE_LABELS = ['Company', 'Coverage', 'Signals', 'Review'] as const;

const SCREENS: readonly ScreenMeta[] = [
  { id: 'welcome', phase: 0, title: 'Welcome' },
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
  return SCREENS[index] ?? SCREENS[0] ?? { id: 'welcome', phase: 0, title: 'Welcome' };
}

const BASICS_SCREEN_INDEX = screenIndexOf('basics');
const REVIEW_SCREEN_INDEX = screenIndexOf('review');

/** Which screen a Review row's "Edit" link jumps to. */
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

/** Which resource a screen's Back/Skip actions mark dirty (screens with no
 * API-backed resource — welcome, workspace, preset, review — are omitted). */
const SCREEN_RESOURCE: Partial<Record<ScreenId, ResourceKey>> = {
  basics: 'profile',
  cpv: 'cpv',
  countries: 'countries',
  value: 'value',
  keywords: 'keywords',
  capabilities: 'capabilities',
  exclusions: 'exclusions',
  digest: 'digest',
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

  const minScreenIndex = hasOrg === true ? BASICS_SCREEN_INDEX : 0;

  function advance(): void {
    if (editingFromReview) {
      setEditingFromReview(false);
      setScreenIndex(REVIEW_SCREEN_INDEX);
      return;
    }
    setScreenIndex((i) => Math.min(i + 1, REVIEW_SCREEN_INDEX));
  }

  function retreat(): void {
    if (editingFromReview) {
      setEditingFromReview(false);
      setScreenIndex(REVIEW_SCREEN_INDEX);
      return;
    }
    setScreenIndex((i) => Math.max(i - 1, minScreenIndex));
  }

  function handleBack(): void {
    const key = SCREEN_RESOURCE[screenAt(screenIndex).id];
    if (key !== undefined) markDirty(key);
    retreat();
  }
  function handleSkip(): void {
    const key = SCREEN_RESOURCE[screenAt(screenIndex).id];
    if (key !== undefined) markDirty(key);
    advance();
  }
  function handleSaveAndContinue(key: ResourceKey, run: () => Promise<boolean>): () => void {
    return () => {
      void run().then((ok) => {
        if (ok) {
          markSaved(key);
          advance();
        }
      });
    };
  }
  function editRow(key: ResourceKey): void {
    setError(null);
    setEditingFromReview(true);
    setScreenIndex(RESOURCE_SCREEN_INDEX[key]);
  }

  async function createOrganization(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/org', { name: orgName });
      setHasOrg(true);
      advance();
    } catch {
      setError('Could not create your workspace. Please try again.');
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
   * Review "Finish setup" (fix for F14/§3.6): fires every outstanding PUT
   * for a resource whose local state was never explicitly saved — including
   * preset-prefilled-but-skipped resources — THEN calls
   * `POST /onboarding/complete`. Stops on the first failure and leaves the
   * user on Review with the failing resource named, per spec.
   */
  async function finishSetup(): Promise<void> {
    setError(null);
    setFailedResourceLabel(null);
    const outstanding: { key: ResourceKey; label: string; run: () => Promise<boolean> }[] = [
      // `profile` is never skipped in practice — `POST onboarding/complete`
      // 409s without an existing company_profiles row, so this always runs
      // at least once if the user never explicitly saved Company basics.
      { key: 'profile', label: 'Company profile', run: saveBasics },
      { key: 'cpv', label: 'CPV codes', run: saveCpv },
      { key: 'countries', label: 'Countries', run: saveGeographies },
      { key: 'value', label: 'Value & deadline', run: saveMatchingPreferences },
      { key: 'keywords', label: 'Keywords', run: saveKeywords },
      {
        key: 'capabilities',
        label: 'Capabilities & certifications',
        run: saveCapabilitiesAndCertifications,
      },
      { key: 'exclusions', label: 'Exclusions', run: saveExclusions },
      { key: 'digest', label: 'Digest', run: saveDigestPreferences },
    ];
    for (const item of outstanding) {
      if (saved[item.key]) continue;
      const ok = await item.run();
      if (!ok) {
        setFailedResourceLabel(item.label);
        setError(`Could not save "${item.label}" — please review it and try again.`);
        return;
      }
      markSaved(item.key);
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
  const currentScreen = screenAt(screenIndex);
  const screensInPhase = SCREENS.filter((s) => s.phase === currentScreen.phase);
  const positionInPhase = screensInPhase.findIndex((s) => s.id === currentScreen.id) + 1;
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
        <OnboardingHeader />
        <main id="main-content" className="assistant-main">
          <PhaseStepper currentPhase={3} />
          <div className="assistant-card">
            <h1 ref={headingRef} tabIndex={-1}>
              You're all set
            </h1>
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
      <title>{`${currentScreen.title} — Onboarding — ${PRODUCT_NAME}`}</title>
      <OnboardingHeader />
      <main id="main-content" className="assistant-main">
        <PhaseStepper currentPhase={currentScreen.phase} />
        {/* Decorative determinate fill under the stepper — the aria-live
            text below is the accessible source of truth (docs/redesign/
            app-interface-spec.md §7.2b). Native <progress>, never an inline
            width (CSP style-src 'self'). */}
        <progress
          className="score-bar assistant-meter"
          value={screenIndex}
          max={REVIEW_SCREEN_INDEX}
          aria-hidden="true"
        />
        <p className="assistant-progress" aria-live="polite">
          {PHASE_LABELS[currentScreen.phase]} · step {positionInPhase} of {screensInPhase.length}
        </p>
        <div className="assistant-card">
          {error !== null && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}

          <div className="assistant-screen" key={currentScreen.id}>
            {currentScreen.id === 'welcome' && (
              <>
                <h1 ref={headingRef} tabIndex={-1}>
                  Let's set up your scoring profile
                </h1>
                <p>
                  This takes about 5 minutes across 4 short phases — your company, what you cover,
                  the signals that refine your score, and a final review before anything goes live.
                  Nothing is required upfront: a preset can fill in a working starting profile for
                  you in one click.
                </p>
                <div className="step-actions">
                  <button className="cta" type="button" onClick={advance}>
                    Get started
                  </button>
                </div>
              </>
            )}

            {currentScreen.id === 'workspace' && (
              <>
                <h1 ref={headingRef} tabIndex={-1}>
                  Name your workspace
                </h1>
                <p>
                  This is your organization's account name — you can change it later in Settings.
                </p>
                <form onSubmit={(event) => void createOrganization(event)}>
                  <div className="form-field">
                    <label htmlFor="org-name">Organization name</label>
                    <input
                      id="org-name"
                      required
                      value={orgName}
                      onChange={(event) => setOrgName(event.target.value)}
                    />
                  </div>
                  <div className="step-actions">
                    <button className="cta" type="submit" disabled={busy}>
                      Create workspace
                    </button>
                  </div>
                </form>
              </>
            )}

            {currentScreen.id === 'basics' && (
              <>
                <h1 ref={headingRef} tabIndex={-1}>
                  Tell us about your company
                </h1>
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
                <StepActions
                  busy={busy}
                  onBack={handleBack}
                  onSkip={editingFromReview ? undefined : handleSkip}
                  onSave={handleSaveAndContinue('profile', saveBasics)}
                  saveLabel={editingFromReview ? 'Save & return to review' : undefined}
                />
              </>
            )}

            {currentScreen.id === 'preset' && (
              <>
                <h1 ref={headingRef} tabIndex={-1}>
                  Start from a preset
                </h1>
                <p className="assistant-why">
                  A preset only pre-fills CPV codes, keywords, and capabilities — the next few
                  screens save each one to your account, and you can edit everything before it's
                  used.
                </p>
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
                      one CPV code on the next screen.
                    </p>
                  </div>
                </div>
                <div className="step-actions">
                  <button type="button" className="btn-quiet" onClick={handleBack} disabled={busy}>
                    Back
                  </button>
                  <button className="cta" type="button" onClick={advance} disabled={busy}>
                    Continue
                  </button>
                </div>
              </>
            )}

            {currentScreen.id === 'cpv' && (
              <>
                <h1 ref={headingRef} tabIndex={-1}>
                  Which CPV codes describe your work?
                </h1>
                <p className="assistant-why">
                  CPV codes drive up to 35 of your 100 points — and decide which tenders get scored
                  at all.
                </p>
                <p>
                  There's no skip on this screen: without at least one CPV code, BidMorrow has
                  nothing to match you against. The fastest way to a valid list is a preset (go Back
                  to pick one) — every preset code is chosen to sit inside BidMorrow's current
                  ingestion scope.
                </p>
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
                  <legend>CPV codes from the bundled presets</legend>
                  {/* Client-side filter only — selected codes filtered out of
                    view stay selected (state is the source of truth), same
                    behavior as the country search above. */}
                  {(() => {
                    const query = cpvSearch.trim().toLowerCase();
                    const visibleCodes =
                      query.length === 0
                        ? PRESET_CPV_CODES
                        : PRESET_CPV_CODES.filter(
                            (code) =>
                              code.toLowerCase().includes(query) ||
                              (CPV_SHORTHAND_LABELS[code] ?? '').toLowerCase().includes(query),
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
                                {CPV_SHORTHAND_LABELS[code] ?? 'CPV code'}
                              </span>
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
                  <button type="button" className="btn-add" onClick={addManualCpv}>
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
                <div className="step-actions">
                  <button type="button" className="btn-quiet" onClick={handleBack} disabled={busy}>
                    Back
                  </button>
                  <button
                    className="cta"
                    type="button"
                    disabled={busy || cpvCodes.length === 0}
                    onClick={handleSaveAndContinue('cpv', saveCpv)}
                  >
                    {editingFromReview ? 'Save & return to review' : 'Save & continue'}
                  </button>
                </div>
              </>
            )}

            {currentScreen.id === 'countries' && (
              <>
                <h1 ref={headingRef} tabIndex={-1}>
                  Which countries' opportunities do you want to see?
                </h1>
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
                    <button type="button" className="btn-add" onClick={addNuts}>
                      Add
                    </button>
                  </div>
                </details>
                <StepActions
                  busy={busy}
                  onBack={handleBack}
                  onSkip={editingFromReview ? undefined : handleSkip}
                  onSave={handleSaveAndContinue('countries', saveGeographies)}
                  saveLabel={editingFromReview ? 'Save & return to review' : undefined}
                />
              </>
            )}

            {currentScreen.id === 'value' && (
              <>
                <h1 ref={headingRef} tabIndex={-1}>
                  What contract value and timing work for you?
                </h1>
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
                <StepActions
                  busy={busy || minValueOverMax}
                  onBack={handleBack}
                  onSkip={editingFromReview ? undefined : handleSkip}
                  onSave={handleSaveAndContinue('value', saveMatchingPreferences)}
                  saveLabel={editingFromReview ? 'Save & return to review' : undefined}
                />
              </>
            )}

            {currentScreen.id === 'keywords' && (
              <>
                <h1 ref={headingRef} tabIndex={-1}>
                  What keywords describe the work you want?
                </h1>
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
                <StepActions
                  busy={busy}
                  onBack={handleBack}
                  onSkip={editingFromReview ? undefined : handleSkip}
                  onSave={handleSaveAndContinue('keywords', saveKeywords)}
                  saveLabel={editingFromReview ? 'Save & return to review' : undefined}
                />
              </>
            )}

            {currentScreen.id === 'capabilities' && (
              <>
                <h1 ref={headingRef} tabIndex={-1}>
                  Capabilities & certifications
                </h1>
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
                <StepActions
                  busy={busy}
                  onBack={handleBack}
                  onSkip={editingFromReview ? undefined : handleSkip}
                  onSave={handleSaveAndContinue('capabilities', saveCapabilitiesAndCertifications)}
                  saveLabel={editingFromReview ? 'Save & return to review' : undefined}
                />
              </>
            )}

            {currentScreen.id === 'exclusions' && (
              <>
                <h1 ref={headingRef} tabIndex={-1}>
                  Anything you want to exclude?
                </h1>
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
                <StepActions
                  busy={busy}
                  onBack={handleBack}
                  onSkip={editingFromReview ? undefined : handleSkip}
                  onSave={handleSaveAndContinue('exclusions', saveExclusions)}
                  saveLabel={editingFromReview ? 'Save & return to review' : undefined}
                />
              </>
            )}

            {currentScreen.id === 'digest' && (
              <>
                <h1 ref={headingRef} tabIndex={-1}>
                  Your daily digest
                </h1>
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
                <StepActions
                  busy={busy}
                  onBack={handleBack}
                  onSkip={editingFromReview ? undefined : handleSkip}
                  onSave={handleSaveAndContinue('digest', saveDigestPreferences)}
                  saveLabel={editingFromReview ? 'Save & return to review' : undefined}
                />
              </>
            )}

            {currentScreen.id === 'review' && (
              <ReviewScreen
                headingRef={headingRef}
                busy={busy}
                failedResourceLabel={failedResourceLabel}
                onBack={() => setScreenIndex((i) => Math.max(i - 1, minScreenIndex))}
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

function PhaseStepper({ currentPhase }: { currentPhase: number }): ReactElement {
  return (
    <ol className="assistant-phases" aria-label="Setup phases">
      {PHASE_LABELS.map((label, index) => (
        <li
          key={label}
          className="assistant-phase"
          data-state={index < currentPhase ? 'done' : undefined}
          aria-current={index === currentPhase ? 'step' : undefined}
        >
          {index < currentPhase && <span aria-hidden="true">✓ </span>}
          {label}
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
      <button type="button" onClick={() => void signOut()}>
        Log out
      </button>
      {signOutError !== null && (
        <p role="alert" className="form-error">
          {signOutError}
        </p>
      )}
    </header>
  );
}

function StepActions({
  busy,
  onBack,
  onSkip,
  onSave,
  saveLabel,
}: {
  busy: boolean;
  onBack: () => void;
  onSkip?: (() => void) | undefined;
  onSave: () => void;
  saveLabel?: string | undefined;
}): ReactElement {
  return (
    <div className="step-actions">
      <button type="button" className="btn-quiet" onClick={onBack} disabled={busy}>
        Back
      </button>
      {onSkip !== undefined && (
        <button type="button" className="btn-quiet" onClick={onSkip} disabled={busy}>
          Skip
        </button>
      )}
      <button className="cta" type="button" onClick={onSave} disabled={busy}>
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
  headingRef,
  busy,
  failedResourceLabel,
  onBack,
  onFinish,
  onEdit,
  presetLabel,
  rows,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
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
      <h1 ref={headingRef} tabIndex={-1}>
        Review your scoring profile
      </h1>
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
