import { useEffect, useState, type ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { CONTRACT_NATURES, type ContractNature } from '@bidmorrow/domain';
import { Combobox } from '../../components/Combobox';
import { ConfirmAction } from '../../components/ConfirmAction';
import { CPV_SUGGESTIONS } from '../../data/cpv-suggestions';
import { api, ApiError } from '../../lib/api';
import { fetchBillingStatus, type BillingStatus } from '../../lib/billing';
import { openCheckout } from '../../lib/paddle';
import { usePublicConfig } from '../../lib/public-config';
import { useAuth } from '../../lib/auth-context';
import { localComboboxSource, type ComboboxOption } from '../../lib/combobox-filter';
import {
  formatCalendarDate,
  formatMinorUnitsAsCurrency,
  invoiceStatusLabel,
  paymentStateLabel,
  paymentStateTone,
} from '../../lib/format';
import { COUNTRY_REGIONS, KEYWORD_SUGGESTIONS } from '../../lib/onboarding-reference-data';
import {
  CERTIFICATION_CODES,
  type CertificationCode,
  type CertificationDto,
  type DigestPreferencesDto,
  type ExclusionDto,
  type GeographyDto,
  type KeywordDto,
  type MatchingPreferencesDto,
  type OrgProfileResponse,
} from '../../lib/onboarding-types';

/** Module-level (not per-render) Combobox option lists + sources — stable
 * references so `Combobox`'s `useEffect([..., source])` never re-fires on
 * every Settings render. All three datasets are static/public
 * (docs/redesign requirements: "no private data in suggestions"). */
const CPV_COMBOBOX_OPTIONS: readonly ComboboxOption[] = CPV_SUGGESTIONS.map((suggestion) => ({
  value: suggestion.code,
  label: suggestion.label,
  sublabel: suggestion.code,
}));
const cpvComboboxSource = localComboboxSource(CPV_COMBOBOX_OPTIONS);

const COUNTRY_COMBOBOX_OPTIONS: readonly ComboboxOption[] = COUNTRY_REGIONS.flatMap((region) =>
  region.countries.map((country) => ({
    value: country.code,
    label: country.name,
    sublabel: country.code,
  })),
);
const countryComboboxSource = localComboboxSource(COUNTRY_COMBOBOX_OPTIONS);

const KEYWORD_COMBOBOX_OPTIONS: readonly ComboboxOption[] = KEYWORD_SUGGESTIONS.map((term) => ({
  value: term,
  label: term,
}));
const keywordComboboxSource = localComboboxSource(KEYWORD_COMBOBOX_OPTIONS);

/**
 * Options for the digest timezone select. `Intl.supportedValuesOf` returns
 * canonical IANA zones only, so a stored legacy alias (still valid — the
 * server validates by constructing a formatter, which resolves aliases)
 * must be prepended or the select would silently display the wrong zone.
 */
function timezoneOptions(current: string): string[] {
  let zones: string[];
  try {
    zones = [...Intl.supportedValuesOf('timeZone')];
  } catch {
    zones = ['UTC', 'Europe/Nicosia', 'Europe/Athens', 'Europe/Berlin', 'Europe/Dublin'];
  }
  return zones.includes(current) ? zones : [current, ...zones];
}

/** Same shape checks the worker's schemas imply, run before the network
 * round-trip so a typo gets field-adjacent feedback instead of a 400. */
const CPV_CODE_PATTERN = /^\d{8}$/;
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
/** 2-letter country + up to 3 more characters; a bare country code is a
 * legitimate prefix (the engine matches preferred NUTS by prefix). */
const NUTS_CODE_PATTERN = /^[A-Z]{2}[A-Z0-9]{0,3}$/;

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
  return 'Could not save — please try again.';
}

/** `GET /api/billing/invoices`'s `InvoiceSummary` (`packages/billing/src/invoices.ts`). */
interface Invoice {
  readonly id: string;
  readonly number: string | null;
  /** Paddle transaction status: `billed | paid | completed | past_due`. */
  readonly status: string;
  readonly currency: string;
  readonly amountDue: number;
  readonly amountPaid: number;
  readonly createdAt: number;
  readonly periodStartAt: number | null;
  readonly periodEndAt: number | null;
  /** `true` once Paddle has issued an invoice — the PDF endpoint will work. */
  readonly hasInvoice: boolean;
}

type InvoicesState =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'not_configured' }
  | { kind: 'provider_error' }
  | { kind: 'error' }
  | { kind: 'ready'; invoices: readonly Invoice[]; hasBillingCustomer: boolean };

/** Mirrors the worker's `/api/billing/*` error shapes (apps/worker/src/routes/billing.ts). */
function describeBillingError(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 403) return 'Only the organization owner can manage billing.';
    if (cause.status === 409) {
      const body = cause.body as {
        error?: string;
        reason?: string;
        requiresCheckout?: boolean;
      } | null;
      if (body?.error === 'subscription_exists') {
        return 'This organization already has a subscription — use Manage billing to change it.';
      }
      if (body?.error === 'founding_unavailable') {
        return body.reason === 'cap_reached'
          ? 'The founding plan is full — please choose the standard plan.'
          : 'The founding plan is not open right now — please choose the standard plan.';
      }
      if (body?.error === 'no_subscription') {
        return body.requiresCheckout === true
          ? 'There is no subscription to reactivate — start a new one below.'
          : 'There is no subscription to cancel.';
      }
      if (body?.error === 'already_canceled') {
        return body.requiresCheckout === true
          ? 'Your subscription has already ended — start a new one below.'
          : 'This subscription is already canceled.';
      }
      if (body?.error === 'not_scheduled') {
        return 'This subscription is not scheduled to cancel — there is nothing to reactivate.';
      }
    }
    if (cause.status === 404) return 'No billing account on file yet — subscribe first.';
    if (cause.status === 503)
      return 'Billing is not available right now — please try again shortly.';
    if (cause.status === 502)
      return 'Could not reach the billing provider — please try again shortly.';
  }
  return 'Could not open billing — please try again.';
}

/** `true` when a 409 response's body carries `requiresCheckout: true` (`POST /api/billing/reactivate`'s "the subscription is truly gone, start over" outcome). */
function reactivateRequiresCheckout(cause: unknown): boolean {
  if (cause instanceof ApiError && cause.status === 409) {
    const body = cause.body as { requiresCheckout?: boolean } | null;
    return body?.requiresCheckout === true;
  }
  return false;
}

/**
 * Fix for C4 (docs/redesign/ux-strategy.md §5.3): the 11-section wall
 * collapses into 5 navigable groups mirroring the onboarding phase model
 * (Company / Coverage+Signals -> "Matching profile" / Review+Digest). Every
 * existing `<section>`/heading/id/save-button below is preserved verbatim —
 * this is grouping and navigation only, never a form refactor. IDs double as
 * the URL hash the 402 notice links to (`/app/settings#billing`).
 */
const SETTINGS_GROUPS: { id: string; label: string }[] = [
  { id: 'billing', label: 'Billing' },
  { id: 'company', label: 'Company' },
  { id: 'matching-profile', label: 'Matching profile' },
  { id: 'digest', label: 'Digest' },
  { id: 'danger-zone', label: 'Danger zone' },
];

export function Settings(): ReactElement {
  const publicConfig = usePublicConfig();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [employeeBand, setEmployeeBand] = useState('');

  const [cpvCodes, setCpvCodes] = useState<string[]>([]);
  const [newCpv, setNewCpv] = useState('');
  const [cpvAddError, setCpvAddError] = useState<string | null>(null);

  const [keywords, setKeywords] = useState<KeywordDto[]>([]);
  const [newKeyword, setNewKeyword] = useState('');

  const [geographies, setGeographies] = useState<GeographyDto[]>([]);
  const [newGeography, setNewGeography] = useState('');
  const [countryAddError, setCountryAddError] = useState<string | null>(null);
  const [newNuts, setNewNuts] = useState('');
  const [nutsAddError, setNutsAddError] = useState<string | null>(null);

  const [exclusions, setExclusions] = useState<ExclusionDto[]>([]);
  const [newExclusion, setNewExclusion] = useState('');

  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [newCapability, setNewCapability] = useState('');
  const [certifications, setCertifications] = useState<CertificationDto[]>([]);
  const [newCertCode, setNewCertCode] = useState<CertificationCode>('ISO_27001');
  const [newCertLabel, setNewCertLabel] = useState('');

  const [matching, setMatching] = useState<MatchingPreferencesDto | null>(null);
  const [digest, setDigest] = useState<DigestPreferencesDto | null>(null);
  const [supportedNatures, setSupportedNatures] = useState<ContractNature[]>([...CONTRACT_NATURES]);

  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  const [invoicesState, setInvoicesState] = useState<InvoicesState>({ kind: 'loading' });
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [reactivateBusy, setReactivateBusy] = useState(false);
  const [reactivateError, setReactivateError] = useState<string | null>(null);
  const [reactivateNeedsCheckout, setReactivateNeedsCheckout] = useState(false);

  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [activeGroup, setActiveGroup] = useState<string>('billing');

  // Transient toast auto-clear (docs/redesign/app-interface-spec.md §8.2) —
  // purely visual; the accessible `role="status"` live region below reads
  // `statusMessage` independently and is unaffected by this timeout.
  useEffect(() => {
    if (statusMessage === null) return;
    const timeout = window.setTimeout(() => setStatusMessage(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const [profileRes, cpvRes, kwRes, geoRes, exRes, capRes, certRes, billingRes] =
          await Promise.all([
            api.get<OrgProfileResponse>('/api/org/profile'),
            api.get<{ cpvPreferences: { cpvCode: string }[] }>('/api/org/cpv-preferences'),
            api.get<{ keywords: KeywordDto[] }>('/api/org/keywords'),
            api.get<{ geographies: GeographyDto[] }>('/api/org/geographies'),
            api.get<{ exclusions: ExclusionDto[] }>('/api/org/exclusions'),
            api.get<{ capabilities: { label: string }[] }>('/api/org/capabilities'),
            api.get<{ certifications: CertificationDto[] }>('/api/org/certifications'),
            api.get<BillingStatus>('/api/billing/status'),
          ]);
        setBilling(billingRes);
        if (profileRes.profile !== null) {
          setDisplayName(profileRes.profile.displayName ?? '');
          setDescription(profileRes.profile.description ?? '');
          setWebsite(profileRes.profile.website ?? '');
          setEmployeeBand(profileRes.profile.employeeBand ?? '');
        }
        setMatching(profileRes.matching);
        setDigest(profileRes.digest);
        if (profileRes.matching !== null) {
          setSupportedNatures(
            JSON.parse(profileRes.matching.supportedContractNaturesJson) as ContractNature[],
          );
        }
        setCpvCodes(cpvRes.cpvPreferences.map((c) => c.cpvCode));
        setKeywords(kwRes.keywords);
        setGeographies(geoRes.geographies);
        setExclusions(exRes.exclusions);
        setCapabilities(capRes.capabilities.map((c) => c.label));
        setCertifications(certRes.certifications);
      } catch {
        setSaveError('Could not load your settings. Please refresh the page and try again.');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  // Invoices are fetched independently of the main Promise.all above:
  // `GET /api/billing/invoices` is OWNER-only (403 for a member), while
  // every other endpoint in that batch is member-visible — a 403 here must
  // never fail the rest of Settings' load (Promise.all is fail-fast). A
  // 403 also doubles as this component's only client-side signal of "the
  // current user is not the organization owner" (the app has no other
  // client-side role state — see the mutation-gating comments below).
  useEffect(() => {
    let cancelled = false;
    async function loadInvoices(): Promise<void> {
      try {
        const res = await api.get<{ invoices: Invoice[]; hasBillingCustomer: boolean }>(
          '/api/billing/invoices',
        );
        if (cancelled) return;
        setInvoicesState({
          kind: 'ready',
          invoices: res.invoices,
          hasBillingCustomer: res.hasBillingCustomer,
        });
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof ApiError) {
          if (cause.status === 403) {
            setInvoicesState({ kind: 'forbidden' });
            return;
          }
          if (cause.status === 503) {
            setInvoicesState({ kind: 'not_configured' });
            return;
          }
          if (cause.status === 502) {
            setInvoicesState({ kind: 'provider_error' });
            return;
          }
        }
        setInvoicesState({ kind: 'error' });
      }
    }
    void loadInvoices();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Only known non-owner signal available client-side (see the invoices-effect comment above) — used to hide/disable owner-only mutation controls as a UX nicety, never as the security boundary (the server independently 403s every mutation for a non-owner regardless of what this renders). */
  const knownNonOwner = invoicesState.kind === 'forbidden';

  const minValueOverMax =
    matching !== null &&
    matching.minValueEur !== null &&
    matching.maxValueEur !== null &&
    matching.minValueEur > matching.maxValueEur;

  /**
   * The prototype's "N to fix before the next run" layer — only conditions
   * that are verifiably always wrong belong here: with zero CPV codes the
   * division pre-filter (packages/procurement score.ts) intersects nothing,
   * so nothing is ever scored; and no tender's value can fall inside an
   * inverted range, so the value component can never score it (the server
   * rejects the save too). Computed from the live edit state — this is what
   * saving right now would produce.
   */
  const profileIssues: string[] = [];
  if (!loading && cpvCodes.length === 0) {
    profileIssues.push('No CPV codes — without at least one, no tender is ever scored for you.');
  }
  if (minValueOverMax) {
    profileIssues.push(
      "Minimum contract value is above the maximum — no tender's value can fall inside that range.",
    );
  }
  const flaggedGroups = new Set(profileIssues.length > 0 ? ['matching-profile'] : []);

  async function refreshBillingStatus(): Promise<void> {
    try {
      const res = await fetchBillingStatus();
      setBilling(res);
    } catch {
      // Best-effort refresh after cancel/reactivate — the mutation itself
      // already succeeded (or the caller wouldn't have reached this point);
      // a failed re-fetch just means the plan card shows slightly stale
      // data until the next load, never a lost mutation.
    }
  }

  // Header "Billing" link and other `#section` deep links: the sections
  // mount only after the profile loads, so the browser's own anchor jump
  // has nothing to land on. Scroll once, after load, to the requested group.
  const { hash } = useLocation();
  useEffect(() => {
    if (loading) return;
    const id = hash.slice(1);
    if (id.length === 0 || !SETTINGS_GROUPS.some((group) => group.id === id)) return;
    const el = document.getElementById(id);
    if (el === null) return;
    el.scrollIntoView({ block: 'start' });
    setActiveGroup(id);
  }, [loading, hash]);

  // Fix for requirement C ("current-section indication"): scrollspy over the
  // 5 group anchors. Best-effort — degrades to a static (non-highlighting)
  // nav in environments without IntersectionObserver; never blocks render.
  useEffect(() => {
    if (loading) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0];
        if (top !== undefined) setActiveGroup(top.target.id);
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    for (const group of SETTINGS_GROUPS) {
      const el = document.getElementById(group.id);
      if (el !== null) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [loading]);

  async function saveProfile(): Promise<void> {
    setSaveError(null);
    try {
      await api.put('/api/org/profile', {
        displayName: displayName.length > 0 ? displayName : null,
        description: description.length > 0 ? description : null,
        website: website.length > 0 ? website : null,
        employeeBand: employeeBand.length > 0 ? employeeBand : null,
        presetKey: null,
        onboardingCompletedAt: Date.now(),
      });
      setStatusMessage('Company profile saved.');
    } catch (cause) {
      setSaveError(describeSaveError(cause));
    }
  }

  async function saveCpv(): Promise<void> {
    setSaveError(null);
    try {
      await api.put('/api/org/cpv-preferences', { cpvCodes });
      setStatusMessage('CPV preferences saved.');
    } catch (cause) {
      setSaveError(describeSaveError(cause));
    }
  }

  async function saveKeywords(): Promise<void> {
    setSaveError(null);
    try {
      await api.put('/api/org/keywords', { keywords });
      setStatusMessage('Keywords saved.');
    } catch (cause) {
      setSaveError(describeSaveError(cause));
    }
  }

  async function saveGeographies(): Promise<void> {
    setSaveError(null);
    try {
      await api.put('/api/org/geographies', { geographies });
      setStatusMessage('Geographies saved.');
    } catch (cause) {
      setSaveError(describeSaveError(cause));
    }
  }

  async function saveExclusions(): Promise<void> {
    setSaveError(null);
    try {
      await api.put('/api/org/exclusions', { exclusions });
      setStatusMessage('Exclusions saved.');
    } catch (cause) {
      setSaveError(describeSaveError(cause));
    }
  }

  async function saveCapabilities(): Promise<void> {
    setSaveError(null);
    try {
      await api.put('/api/org/capabilities', { labels: capabilities });
      setStatusMessage('Capabilities saved.');
    } catch (cause) {
      setSaveError(describeSaveError(cause));
    }
  }

  async function saveCertifications(): Promise<void> {
    setSaveError(null);
    try {
      await api.put('/api/org/certifications', { certifications });
      setStatusMessage('Certifications saved.');
    } catch (cause) {
      setSaveError(describeSaveError(cause));
    }
  }

  async function saveMatching(): Promise<void> {
    if (matching === null) return;
    if (minValueOverMax) {
      // The server now rejects an inverted range too; catching it here keeps
      // the feedback next to the fields instead of a generic 400 message.
      setSaveError('Fix the value range first — the minimum is above the maximum.');
      return;
    }
    setSaveError(null);
    try {
      await api.put('/api/org/matching-preferences', {
        minValueEur: matching.minValueEur,
        maxValueEur: matching.maxValueEur,
        supportedContractNatures: supportedNatures,
        minimumDaysRemaining: matching.minimumDaysRemaining,
      });
      setStatusMessage('Matching preferences saved.');
    } catch (cause) {
      setSaveError(describeSaveError(cause));
    }
  }

  async function saveDigest(): Promise<void> {
    if (digest === null) return;
    setSaveError(null);
    try {
      await api.put('/api/org/digest-preferences', {
        enabled: digest.enabled === 1,
        sendEmpty: digest.sendEmpty === 1,
        minClassification: digest.minClassification,
        timezone: digest.timezone,
      });
      setStatusMessage('Digest preferences saved.');
    } catch (cause) {
      setSaveError(describeSaveError(cause));
    }
  }

  /**
   * The server creates the Paddle transaction (items + org binding are
   * server-authoritative); the SPA only opens the Paddle overlay for it.
   * `billingBusy` is released when the customer dismisses the overlay;
   * a completed payment navigates away to the success page.
   */
  async function startCheckout(plan: 'founding' | 'standard'): Promise<void> {
    setBillingError(null);
    setBillingBusy(true);
    try {
      const { transactionId, customerEmail, successPath } = await api.post<{
        transactionId: string;
        customerEmail: string;
        successPath: string;
      }>('/api/billing/checkout', { plan });
      const opened = await openCheckout({
        transactionId,
        customerEmail,
        successUrl: window.location.origin + successPath,
        onClosed: () => setBillingBusy(false),
      });
      if (!opened) {
        setBillingError('Billing is not available right now — please try again shortly.');
        setBillingBusy(false);
      }
    } catch (cause) {
      setBillingError(describeBillingError(cause));
      setBillingBusy(false);
    }
  }

  async function openPortal(): Promise<void> {
    setBillingError(null);
    setBillingBusy(true);
    try {
      const { url } = await api.post<{ url: string }>('/api/billing/portal');
      window.location.href = url;
    } catch (cause) {
      setBillingError(describeBillingError(cause));
      setBillingBusy(false);
    }
  }

  /** Cancellation always takes effect at the CURRENT period end, never
   * immediately (`POST /api/billing/cancel`'s `effective: 'period_end'`) —
   * the confirm UI states this explicitly before the request ever fires. */
  async function handleCancel(): Promise<void> {
    setCancelError(null);
    setCancelBusy(true);
    try {
      await api.post<{ cancelAtPeriodEnd: true; currentPeriodEndAt: number | null }>(
        '/api/billing/cancel',
        { confirm: 'CANCEL_SUBSCRIPTION' },
      );
      setStatusMessage(
        'Cancellation scheduled — access continues until the end of your billing period.',
      );
      await refreshBillingStatus();
    } catch (cause) {
      setCancelError(describeBillingError(cause));
    } finally {
      setCancelBusy(false);
    }
  }

  async function handleReactivate(): Promise<void> {
    setReactivateError(null);
    setReactivateNeedsCheckout(false);
    setReactivateBusy(true);
    try {
      await api.post('/api/billing/reactivate');
      setStatusMessage('Subscription reactivated.');
      await refreshBillingStatus();
    } catch (cause) {
      setReactivateError(describeBillingError(cause));
      setReactivateNeedsCheckout(reactivateRequiresCheckout(cause));
    } finally {
      setReactivateBusy(false);
    }
  }

  async function deleteAccount(): Promise<void> {
    setDeleteError(null);
    try {
      await api.delete('/api/account');
      await refresh();
      void navigate('/');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setDeleteError(
          'You are the sole owner of an organization. Transfer or delete the organization before deleting your account.',
        );
      } else {
        setDeleteError('Could not delete your account. Please try again or contact support.');
      }
    }
  }

  if (loading) {
    return (
      <div className="feed-skeleton-list" aria-hidden="true">
        <div className="feed-skeleton-card" />
        <div className="feed-skeleton-card" />
        <div className="feed-skeleton-card" />
      </div>
    );
  }

  return (
    <>
      <title>Settings — BidMorrow</title>
      <h1>Settings</h1>
      <p role="status" aria-live="polite" className="visually-hidden-status">
        {statusMessage}
      </p>
      {statusMessage !== null && (
        <div className="app-toast" aria-hidden="true">
          {statusMessage}
        </div>
      )}
      {saveError !== null && (
        <p role="alert" className="form-error">
          {saveError}
        </p>
      )}

      {/* role=status (polite): present at load for a broken profile and
          appears live while editing — assertive interruption is not
          warranted for a persistent condition. */}
      {profileIssues.length > 0 && (
        <div className="settings-issues" role="status">
          <p className="settings-issues__title">
            {profileIssues.length === 1 ? '1 thing' : `${String(profileIssues.length)} things`} to
            fix in your matching profile
          </p>
          <ul>
            {profileIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="settings-shell">
        <nav className="settings-nav" aria-label="Settings sections">
          <ul>
            {SETTINGS_GROUPS.map((group) => (
              <li key={group.id}>
                <a
                  href={`#${group.id}`}
                  aria-current={activeGroup === group.id ? 'true' : undefined}
                >
                  {group.label}
                  {flaggedGroups.has(group.id) && (
                    <span className="settings-nav__flag" aria-label="has an issue to fix" />
                  )}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="settings-content">
          <section id="billing" className="settings-group">
            <h2>Billing</h2>
            {billingError !== null && (
              <p role="alert" className="form-error">
                {billingError}
              </p>
            )}
            <div id="billing-print-area">
              {billing === null ? (
                <p className="hint">Could not load billing status. Please refresh the page.</p>
              ) : billing.subscription === null ? (
                <>
                  <p>No active subscription.</p>
                  <p className="hint">
                    Founding price is locked in for the life of your subscription — it never
                    migrates to the standard price later. Prices include VAT — what you see is what
                    you pay. Payments and invoices are handled by Paddle, our Merchant of Record.
                  </p>
                  {publicConfig?.prelaunch === true ? (
                    /* Pre-launch: new checkouts are refused server-side
                       (403 subscriptions_closed) — show the honest state
                       instead of a button that can only fail. */
                    <p className="hint">
                      Subscriptions open at launch, at the end of August. Your account and profile
                      are ready — nothing to do until then.
                    </p>
                  ) : (
                    <div className="button-row">
                      {billing.foundingAvailable && (
                        <button
                          className="cta"
                          type="button"
                          disabled={billingBusy}
                          onClick={() => void startCheckout('founding')}
                        >
                          Subscribe — Founding (€29/mo incl. VAT, limited spots)
                        </button>
                      )}
                      <button
                        className="cta"
                        type="button"
                        disabled={billingBusy}
                        onClick={() => void startCheckout('standard')}
                      >
                        Subscribe — Standard (€49/mo incl. VAT)
                      </button>
                    </div>
                  )}
                  <BillingInvoiceHistory state={invoicesState} />
                </>
              ) : (
                (() => {
                  const subscription = billing.subscription;
                  if (subscription === null) return null;
                  return (
                    <BillingActiveSubscription
                      subscription={subscription}
                      entitlementActive={billing.entitlement.active}
                      entitlementReason={billing.entitlement.reason}
                      billingBusy={billingBusy}
                      cancelBusy={cancelBusy}
                      cancelError={cancelError}
                      reactivateBusy={reactivateBusy}
                      reactivateError={reactivateError}
                      reactivateNeedsCheckout={reactivateNeedsCheckout}
                      knownNonOwner={knownNonOwner}
                      invoicesState={invoicesState}
                      onManagePayment={() => void openPortal()}
                      onCancel={() => void handleCancel()}
                      onReactivate={() => void handleReactivate()}
                      onStartCheckout={() => void startCheckout(subscription.plan)}
                    />
                  );
                })()
              )}
            </div>
          </section>

          <section id="company" className="settings-group">
            <h2>Company profile</h2>
            <div className="form-field">
              <label htmlFor="settings-name">Company name</label>
              <input
                id="settings-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="settings-description">Description</label>
              <textarea
                id="settings-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="settings-website">Website</label>
              <input
                id="settings-website"
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="settings-employees">Company size</label>
              <input
                id="settings-employees"
                value={employeeBand}
                onChange={(e) => setEmployeeBand(e.target.value)}
              />
            </div>
            <div className="form-actions">
              <button className="cta" type="button" onClick={() => void saveProfile()}>
                Save profile
              </button>
            </div>
          </section>

          <section id="matching-profile" className="settings-group">
            <h2>Matching profile</h2>
            <p className="hint">
              Everything below is what the scoring engine matches against — CPV codes, keywords,
              geographies, capabilities, certifications, exclusions, and your value/deadline range.
            </p>

            <section className="settings-subsection">
              <h3>CPV codes</h3>
              <ul className="chip-list">
                {cpvCodes.map((code) => (
                  <li key={code}>
                    {code}
                    <button
                      type="button"
                      aria-label={`Remove CPV ${code}`}
                      onClick={() => setCpvCodes((cs) => cs.filter((c) => c !== code))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <div className="combobox-add-row">
                <Combobox
                  id="new-cpv"
                  label="Add CPV code"
                  value={newCpv}
                  onValueChange={(value) => {
                    setNewCpv(value);
                    setCpvAddError(null);
                  }}
                  source={cpvComboboxSource}
                  placeholder="e.g. 72220000 or software"
                  hint="A curated shortlist, not exhaustive — any 8-digit CPV code is still accepted below."
                  isChosen={(option) => cpvCodes.includes(option.value)}
                  describedBy={cpvAddError !== null ? 'new-cpv-error' : undefined}
                  onCommit={(option) => {
                    // Suggestions are known-good 8-digit codes by dataset
                    // construction — no shape re-check needed here.
                    if (!cpvCodes.includes(option.value) && cpvCodes.length < 30) {
                      setCpvCodes((cs) => [...cs, option.value]);
                    }
                    setNewCpv('');
                    setCpvAddError(null);
                  }}
                />
                <button
                  type="button"
                  className="btn-add"
                  onClick={() => {
                    const trimmed = newCpv.trim();
                    if (trimmed.length === 0) return;
                    if (!CPV_CODE_PATTERN.test(trimmed)) {
                      setCpvAddError('CPV codes are 8 digits (for example 72220000).');
                      return;
                    }
                    if (!cpvCodes.includes(trimmed) && cpvCodes.length < 30) {
                      setCpvCodes((cs) => [...cs, trimmed]);
                    }
                    setNewCpv('');
                    setCpvAddError(null);
                  }}
                >
                  Add
                </button>
              </div>
              {cpvAddError !== null && (
                <p id="new-cpv-error" role="alert" className="form-error">
                  {cpvAddError}
                </p>
              )}
              <div className="form-actions">
                <button className="cta" type="button" onClick={() => void saveCpv()}>
                  Save CPV codes
                </button>
              </div>
            </section>

            <section className="settings-subsection">
              <h3>Keywords</h3>
              <ul className="chip-list">
                {keywords.map((keyword, index) => (
                  <li key={`${keyword.term}-${index}`}>
                    {keyword.term}
                    <button
                      type="button"
                      aria-label={`Remove keyword ${keyword.term}`}
                      onClick={() => setKeywords((ks) => ks.filter((_, i) => i !== index))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <div className="combobox-add-row">
                <Combobox
                  id="new-keyword"
                  label="Add keyword"
                  value={newKeyword}
                  onValueChange={setNewKeyword}
                  source={keywordComboboxSource}
                  placeholder="e.g. penetration testing"
                  hint="Suggestions from BidMorrow's bundled presets — any term is still accepted below."
                  isChosen={(option) => keywords.some((k) => k.term === option.value)}
                  onCommit={(option) => {
                    if (!keywords.some((k) => k.term === option.value)) {
                      setKeywords((ks) => [
                        ...ks,
                        {
                          kind: 'positive',
                          term: option.value,
                          synonymGroup: null,
                          language: null,
                        },
                      ]);
                    }
                    setNewKeyword('');
                  }}
                />
                <button
                  type="button"
                  className="btn-add"
                  onClick={() => {
                    if (newKeyword.trim().length > 0) {
                      setKeywords((ks) => [
                        ...ks,
                        {
                          kind: 'positive',
                          term: newKeyword.trim(),
                          synonymGroup: null,
                          language: null,
                        },
                      ]);
                      setNewKeyword('');
                    }
                  }}
                >
                  Add
                </button>
              </div>
              <div className="form-actions">
                <button className="cta" type="button" onClick={() => void saveKeywords()}>
                  Save keywords
                </button>
              </div>
            </section>

            <section className="settings-subsection">
              <h3>Geographies</h3>
              <ul className="chip-list">
                {geographies
                  .map((geo, index) => ({ geo, index }))
                  .filter(({ geo }) => geo.kind !== 'preferred_nuts')
                  .map(({ geo, index }) => (
                    <li key={`${geo.kind}-${geo.code}-${String(index)}`}>
                      {geo.code}
                      {geo.kind === 'country_served' ? ' · served' : ''}
                      <button
                        type="button"
                        aria-label={`Remove geography ${geo.code}`}
                        onClick={() => setGeographies((gs) => gs.filter((_, i) => i !== index))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
              </ul>
              <div className="combobox-add-row">
                <Combobox
                  id="new-geo"
                  label="Add country code (opportunity country)"
                  value={newGeography}
                  onValueChange={(v) => {
                    setNewGeography(v.toUpperCase());
                    setCountryAddError(null);
                  }}
                  source={countryComboboxSource}
                  placeholder="e.g. Germany or DE"
                  hint="EU/EEA countries shown here — any 2-letter country code is still accepted below."
                  isChosen={(option) =>
                    geographies.some(
                      (g) => g.kind === 'opportunity_country' && g.code === option.value,
                    )
                  }
                  describedBy={countryAddError !== null ? 'new-geo-error' : undefined}
                  onCommit={(option) => {
                    if (
                      !geographies.some(
                        (g) => g.kind === 'opportunity_country' && g.code === option.value,
                      )
                    ) {
                      setGeographies((gs) => [
                        ...gs,
                        { kind: 'opportunity_country', code: option.value },
                      ]);
                    }
                    setNewGeography('');
                    setCountryAddError(null);
                  }}
                />
                <button
                  type="button"
                  className="btn-add"
                  onClick={() => {
                    const trimmed = newGeography.trim();
                    if (trimmed.length === 0) return;
                    if (!COUNTRY_CODE_PATTERN.test(trimmed)) {
                      setCountryAddError('Country codes are 2 letters (for example DE).');
                      return;
                    }
                    if (
                      !geographies.some(
                        (g) => g.kind === 'opportunity_country' && g.code === trimmed,
                      )
                    ) {
                      setGeographies((gs) => [
                        ...gs,
                        { kind: 'opportunity_country', code: trimmed },
                      ]);
                    }
                    setNewGeography('');
                    setCountryAddError(null);
                  }}
                >
                  Add
                </button>
              </div>
              {countryAddError !== null && (
                <p id="new-geo-error" role="alert" className="form-error">
                  {countryAddError}
                </p>
              )}

              <h4 className="settings-subheading">Preferred NUTS regions</h4>
              <p className="hint">
                Scored as a bonus, never a filter — a lot inside a preferred region scores the full
                geography points; anywhere else still scores by country.
              </p>
              <ul className="chip-list">
                {geographies
                  .map((geo, index) => ({ geo, index }))
                  .filter(({ geo }) => geo.kind === 'preferred_nuts')
                  .map(({ geo, index }) => (
                    <li key={`${geo.kind}-${geo.code}-${String(index)}`}>
                      {geo.code}
                      <button
                        type="button"
                        aria-label={`Remove NUTS region ${geo.code}`}
                        onClick={() => setGeographies((gs) => gs.filter((_, i) => i !== index))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
              </ul>
              <div className="form-field inline">
                <label htmlFor="new-nuts">Add NUTS region code</label>
                <input
                  id="new-nuts"
                  type="text"
                  value={newNuts}
                  placeholder="e.g. DE30"
                  aria-invalid={nutsAddError !== null}
                  aria-describedby={nutsAddError !== null ? 'new-nuts-error' : undefined}
                  onChange={(e) => {
                    setNewNuts(e.target.value.toUpperCase());
                    setNutsAddError(null);
                  }}
                />
                <button
                  type="button"
                  className="btn-add"
                  onClick={() => {
                    const trimmed = newNuts.trim();
                    if (trimmed.length === 0) return;
                    if (!NUTS_CODE_PATTERN.test(trimmed)) {
                      setNutsAddError(
                        'NUTS codes are a 2-letter country plus up to 3 characters (for example DE30 — DE alone covers all of Germany).',
                      );
                      return;
                    }
                    if (
                      !geographies.some((g) => g.kind === 'preferred_nuts' && g.code === trimmed)
                    ) {
                      setGeographies((gs) => [...gs, { kind: 'preferred_nuts', code: trimmed }]);
                    }
                    setNewNuts('');
                    setNutsAddError(null);
                  }}
                >
                  Add
                </button>
              </div>
              {nutsAddError !== null && (
                <p id="new-nuts-error" role="alert" className="form-error">
                  {nutsAddError}
                </p>
              )}
              <div className="form-actions">
                <button className="cta" type="button" onClick={() => void saveGeographies()}>
                  Save geographies
                </button>
              </div>
            </section>

            <section className="settings-subsection">
              <h3>Exclusions</h3>
              <ul className="chip-list">
                {exclusions.map((exclusion, index) => (
                  <li key={`${exclusion.kind}-${exclusion.value}-${index}`}>
                    {exclusion.kind}: {exclusion.value}
                    <button
                      type="button"
                      aria-label={`Remove exclusion ${exclusion.value}`}
                      onClick={() => setExclusions((ex) => ex.filter((_, i) => i !== index))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <div className="form-field inline">
                <label htmlFor="new-exclusion">Add excluded phrase</label>
                <input
                  id="new-exclusion"
                  value={newExclusion}
                  onChange={(e) => setNewExclusion(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-add"
                  onClick={() => {
                    if (newExclusion.trim().length > 0) {
                      setExclusions((ex) => [
                        ...ex,
                        { kind: 'phrase', value: newExclusion.trim() },
                      ]);
                      setNewExclusion('');
                    }
                  }}
                >
                  Add
                </button>
              </div>
              <div className="form-actions">
                <button className="cta" type="button" onClick={() => void saveExclusions()}>
                  Save exclusions
                </button>
              </div>
            </section>

            <section className="settings-subsection">
              <h3>Capabilities</h3>
              <ul className="chip-list">
                {capabilities.map((label, index) => (
                  <li key={`${label}-${index}`}>
                    {label}
                    <button
                      type="button"
                      aria-label={`Remove capability ${label}`}
                      onClick={() => setCapabilities((cs) => cs.filter((_, i) => i !== index))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <div className="form-field inline">
                <label htmlFor="new-capability">Add capability</label>
                <input
                  id="new-capability"
                  value={newCapability}
                  onChange={(e) => setNewCapability(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-add"
                  onClick={() => {
                    if (newCapability.trim().length > 0) {
                      setCapabilities((cs) => [...cs, newCapability.trim()]);
                      setNewCapability('');
                    }
                  }}
                >
                  Add
                </button>
              </div>
              <div className="form-actions">
                <button className="cta" type="button" onClick={() => void saveCapabilities()}>
                  Save capabilities
                </button>
              </div>
            </section>

            <section className="settings-subsection">
              <h3>Certifications</h3>
              <ul className="chip-list">
                {certifications.map((cert, index) => (
                  <li key={`${cert.certificationCode}-${index}`}>
                    {cert.certificationCode}
                    {cert.label !== null ? `: ${cert.label}` : ''}
                    <button
                      type="button"
                      aria-label={`Remove certification ${cert.certificationCode}`}
                      onClick={() => setCertifications((cs) => cs.filter((_, i) => i !== index))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <div className="form-field inline">
                <label htmlFor="settings-cert-code">Certification</label>
                <select
                  id="settings-cert-code"
                  value={newCertCode}
                  onChange={(e) => setNewCertCode(e.target.value as CertificationCode)}
                >
                  {CERTIFICATION_CODES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
                {newCertCode === 'OTHER' && (
                  <>
                    <label htmlFor="settings-cert-label">Certification name</label>
                    <input
                      id="settings-cert-label"
                      value={newCertLabel}
                      onChange={(e) => setNewCertLabel(e.target.value)}
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
                  }}
                >
                  Add
                </button>
              </div>
              <div className="form-actions">
                <button className="cta" type="button" onClick={() => void saveCertifications()}>
                  Save certifications
                </button>
              </div>
            </section>

            {matching !== null && (
              <section className="settings-subsection">
                <h3>Value range & deadline threshold</h3>
                <div className="form-field">
                  <label htmlFor="settings-min-value">Minimum contract value (EUR)</label>
                  <input
                    id="settings-min-value"
                    type="number"
                    min={0}
                    value={matching.minValueEur ?? ''}
                    aria-invalid={minValueOverMax}
                    aria-describedby={minValueOverMax ? 'settings-value-range-error' : undefined}
                    onChange={(e) =>
                      setMatching({
                        ...matching,
                        minValueEur: e.target.value.length > 0 ? Number(e.target.value) : null,
                      })
                    }
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="settings-max-value">Maximum contract value (EUR)</label>
                  <input
                    id="settings-max-value"
                    type="number"
                    min={0}
                    value={matching.maxValueEur ?? ''}
                    aria-invalid={minValueOverMax}
                    aria-describedby={minValueOverMax ? 'settings-value-range-error' : undefined}
                    onChange={(e) =>
                      setMatching({
                        ...matching,
                        maxValueEur: e.target.value.length > 0 ? Number(e.target.value) : null,
                      })
                    }
                  />
                </div>
                {minValueOverMax && (
                  <p id="settings-value-range-error" role="alert" className="form-error">
                    Minimum value must not exceed the maximum.
                  </p>
                )}
                <fieldset className="field-group">
                  <legend>Contract types you support</legend>
                  {CONTRACT_NATURES.map((nature) => (
                    <label key={nature} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={supportedNatures.includes(nature)}
                        onChange={() =>
                          setSupportedNatures((ns) =>
                            ns.includes(nature) ? ns.filter((n) => n !== nature) : [...ns, nature],
                          )
                        }
                      />
                      {nature}
                    </label>
                  ))}
                </fieldset>
                <div className="form-field">
                  <label htmlFor="settings-min-days">
                    Minimum days remaining you're willing to bid
                  </label>
                  <input
                    id="settings-min-days"
                    type="number"
                    min={0}
                    value={matching.minimumDaysRemaining ?? ''}
                    onChange={(e) =>
                      setMatching({
                        ...matching,
                        minimumDaysRemaining:
                          e.target.value.length > 0 ? Number(e.target.value) : null,
                      })
                    }
                  />
                </div>
                <div className="form-actions">
                  <button className="cta" type="button" onClick={() => void saveMatching()}>
                    Save matching preferences
                  </button>
                </div>
              </section>
            )}
          </section>

          {digest !== null && (
            <section id="digest" className="settings-group">
              <h2>Digest preferences</h2>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={digest.enabled === 1}
                  onChange={(e) => setDigest({ ...digest, enabled: e.target.checked ? 1 : 0 })}
                />
                Send me a daily digest email
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={digest.sendEmpty === 1}
                  onChange={(e) => setDigest({ ...digest, sendEmpty: e.target.checked ? 1 : 0 })}
                />
                Send the digest even on days with no matches
              </label>
              <div className="form-field">
                <label htmlFor="settings-digest-min">Minimum classification to include</label>
                <select
                  id="settings-digest-min"
                  value={digest.minClassification}
                  onChange={(e) => setDigest({ ...digest, minClassification: e.target.value })}
                >
                  <option value="STRONG_MATCH">Strong match only</option>
                  <option value="WORTH_REVIEWING">Worth reviewing or better</option>
                  <option value="POSSIBLE_MATCH">Possible match or better</option>
                  <option value="LOW_FIT">Everything</option>
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="settings-digest-timezone">Timezone</label>
                <select
                  id="settings-digest-timezone"
                  value={digest.timezone}
                  onChange={(e) => setDigest({ ...digest, timezone: e.target.value })}
                >
                  {timezoneOptions(digest.timezone).map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
                <p className="hint">
                  Used for digest timing — your digest sends once a day from 06:00 in this timezone.
                </p>
              </div>
              <div className="form-actions">
                <button className="cta" type="button" onClick={() => void saveDigest()}>
                  Save digest preferences
                </button>
              </div>
            </section>
          )}

          <section id="danger-zone" className="settings-group settings-danger">
            <h2>Delete account</h2>
            <p>
              This permanently deletes your account. If you're the sole owner of an organization,
              you must transfer or delete it first.
            </p>
            {deleteError !== null && (
              <p role="alert" className="form-error">
                {deleteError}
              </p>
            )}
            <div className="form-field">
              <label htmlFor="delete-confirm">Type DELETE to confirm</label>
              <input
                id="delete-confirm"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="danger"
              disabled={deleteConfirmText !== 'DELETE'}
              onClick={() => void deleteAccount()}
            >
              Permanently delete my account
            </button>
          </section>
        </div>
      </div>
    </>
  );
}

/** Non-null `BillingStatus['subscription']` — extracted so the plan
 * card/cancel-reactivate panel/invoice history below share one type instead
 * of each re-narrowing the parent's nullable field. */
type ActiveSubscription = NonNullable<BillingStatus['subscription']>;

/**
 * Plan card + cancel/reactivate controls + payment/print actions + invoice
 * history for an organization WITH a subscription (`billing.subscription !==
 * null`). Split out of `Settings` purely to keep that component's JSX
 * readable — same "local helper component in the page file" idiom already
 * used by `Onboarding.tsx` (`PhaseStepper`/`OnboardingHeader`/`StepActions`).
 */
function BillingActiveSubscription({
  subscription,
  entitlementActive,
  entitlementReason,
  billingBusy,
  cancelBusy,
  cancelError,
  reactivateBusy,
  reactivateError,
  reactivateNeedsCheckout,
  knownNonOwner,
  invoicesState,
  onManagePayment,
  onCancel,
  onReactivate,
  onStartCheckout,
}: {
  subscription: ActiveSubscription;
  entitlementActive: boolean;
  entitlementReason: string;
  billingBusy: boolean;
  cancelBusy: boolean;
  cancelError: string | null;
  reactivateBusy: boolean;
  reactivateError: string | null;
  reactivateNeedsCheckout: boolean;
  knownNonOwner: boolean;
  invoicesState: InvoicesState;
  onManagePayment: () => void;
  onCancel: () => void;
  onReactivate: () => void;
  onStartCheckout: () => void;
}): ReactElement {
  const overdue = subscription.paymentState === 'past_due';
  const paused = subscription.paymentState === 'paused';
  const planLabel = subscription.plan === 'founding' ? 'Founding' : 'Standard';
  const tone = paymentStateTone(subscription.paymentState);

  return (
    <>
      <div className="billing-plan-card">
        <div className="billing-plan-card__row">
          <span className="billing-plan-card__plan">{planLabel} plan</span>
          <span>
            {formatMinorUnitsAsCurrency(
              subscription.price.amountMinorUnits,
              subscription.price.currency,
            )}{' '}
            / {subscription.price.interval}
            {subscription.price.taxInclusive ? ' incl. VAT' : ''}
          </span>
          <span className={`billing-status-badge billing-status-badge--${tone}`}>
            {paymentStateLabel(subscription.paymentState)}
          </span>
        </div>
        <p>
          {subscription.cancelAtPeriodEnd
            ? `Cancels on ${formatCalendarDate(subscription.currentPeriodEndAt)} — access continues until then.`
            : `Renews on ${formatCalendarDate(subscription.currentPeriodEndAt)}.`}
        </p>
        {!entitlementActive && (
          <p className="hint">
            Feed and digest are currently paused: {entitlementReason.replace(/_/g, ' ')}.
          </p>
        )}
        {overdue && (
          <div className="billing-overdue-notice" role="alert">
            <p>
              We couldn't process your last payment — your subscription is past due. Update your
              payment details to keep your feed and digest active.
            </p>
            {!knownNonOwner && (
              <button
                className="cta no-print"
                type="button"
                disabled={billingBusy}
                onClick={onManagePayment}
              >
                Fix payment details
              </button>
            )}
          </div>
        )}
      </div>

      {paused && (
        <p className="hint" role="status">
          Your subscription is paused — nothing is billed and the feed is off. Resume it from Manage
          payment details.
        </p>
      )}

      {!subscription.cancelAtPeriodEnd ? (
        <div className="billing-cancel-panel">
          <h3>Cancel subscription</h3>
          <p className="hint">
            Canceling takes effect at the end of your current billing period (
            {formatCalendarDate(subscription.currentPeriodEndAt)}) — you keep full access until
            then, and nothing is charged again after that date.
          </p>
          {cancelError !== null && (
            <p role="alert" className="form-error">
              {cancelError}
            </p>
          )}
          {knownNonOwner ? (
            <p className="hint">Only the organization owner can cancel billing.</p>
          ) : (
            <ConfirmAction
              label="Cancel subscription"
              confirmText="CANCEL_SUBSCRIPTION"
              variant="danger"
              busy={cancelBusy}
              onConfirm={onCancel}
            />
          )}
        </div>
      ) : (
        <div className="billing-cancel-panel">
          <h3>Subscription ending</h3>
          <p>
            Cancels on <strong>{formatCalendarDate(subscription.currentPeriodEndAt)}</strong> —
            access continues until then.
          </p>
          {reactivateError !== null && (
            <p role="alert" className="form-error">
              {reactivateError}
            </p>
          )}
          {knownNonOwner ? (
            <p className="hint">Only the organization owner can reactivate billing.</p>
          ) : reactivateNeedsCheckout ? (
            <div className="button-row">
              <p className="hint">This subscription has already ended.</p>
              <button
                className="cta"
                type="button"
                disabled={billingBusy}
                onClick={onStartCheckout}
              >
                Start a new subscription
              </button>
            </div>
          ) : (
            <button className="cta" type="button" disabled={reactivateBusy} onClick={onReactivate}>
              {reactivateBusy ? 'Working…' : 'Keep my subscription'}
            </button>
          )}
        </div>
      )}

      <div className="button-row">
        {!knownNonOwner && (
          <button
            className="btn-quiet"
            type="button"
            disabled={billingBusy}
            onClick={onManagePayment}
          >
            Manage payment details
          </button>
        )}
        <button className="btn-quiet no-print" type="button" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <BillingInvoiceHistory state={invoicesState} />
    </>
  );
}

/**
 * Invoice history table: loading/empty/error/forbidden states and a
 * per-invoice "Download PDF" action that resolves the Paddle-hosted PDF on
 * demand (`GET /api/billing/invoices/:id/pdf` — never a client-fabricated
 * PDF; the URL is temporary so it is fetched at click time, not listed).
 * `hasBillingCustomer: false` with zero invoices is a normal "never
 * checked out" state, not an error (mirrors
 * `packages/billing/src/invoices.ts`'s own framing).
 */
function InvoicePdfButton({ transactionId }: { transactionId: string }): ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function download(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.get<{ url: string }>(
        `/api/billing/invoices/${encodeURIComponent(transactionId)}/pdf`,
      );
      window.open(url, '_blank', 'noopener');
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 404
          ? 'No PDF available for this invoice yet.'
          : 'Could not fetch the invoice PDF — please try again shortly.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="billing-invoice-actions">
      <button
        type="button"
        className="btn-quiet btn-sm"
        disabled={busy}
        onClick={() => void download()}
      >
        {busy ? 'Fetching…' : 'Download PDF'}
      </button>
      {error !== null && (
        <span role="alert" className="form-error">
          {error}
        </span>
      )}
    </span>
  );
}

function BillingInvoiceHistory({ state }: { state: InvoicesState }): ReactElement {
  return (
    <section className="settings-subsection" aria-labelledby="billing-invoices-heading">
      <h3 id="billing-invoices-heading">Invoice history</h3>
      {state.kind === 'loading' && <p className="hint">Loading invoices…</p>}
      {state.kind === 'forbidden' && (
        <p className="hint">Only the organization owner can view billing invoices.</p>
      )}
      {state.kind === 'not_configured' && (
        <p className="hint">Billing is not available right now — please try again shortly.</p>
      )}
      {state.kind === 'provider_error' && (
        <p role="alert" className="form-error">
          Could not reach the billing provider — please try again shortly.
        </p>
      )}
      {state.kind === 'error' && (
        <p role="alert" className="form-error">
          Could not load invoices — please try again.
        </p>
      )}
      {state.kind === 'ready' && state.invoices.length === 0 && (
        <p className="hint">No invoices yet.</p>
      )}
      {state.kind === 'ready' && state.invoices.length > 0 && (
        <div className="admin-table-scroll">
          <table>
            <caption className="visually-hidden-status">Invoice history</caption>
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col">Date</th>
                <th scope="col">Period</th>
                <th scope="col">Amount</th>
                <th scope="col">Status</th>
                <th scope="col" className="no-print">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {state.invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>{invoice.number ?? invoice.id}</td>
                  <td>{formatCalendarDate(invoice.createdAt)}</td>
                  <td>
                    {formatCalendarDate(invoice.periodStartAt)} –{' '}
                    {formatCalendarDate(invoice.periodEndAt)}
                  </td>
                  <td>
                    {/* Paid invoices show what was paid; open/past-due show
                        what is owed (PR-M6-01 — a €0.00 "amount" on an unpaid
                        invoice reads as ambiguous next to its status). */}
                    {formatMinorUnitsAsCurrency(
                      invoice.status === 'paid' || invoice.status === 'completed'
                        ? invoice.amountPaid
                        : invoice.amountDue,
                      invoice.currency,
                    )}
                  </td>
                  <td>{invoiceStatusLabel(invoice.status)}</td>
                  <td className="no-print">
                    {invoice.hasInvoice && <InvoicePdfButton transactionId={invoice.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
