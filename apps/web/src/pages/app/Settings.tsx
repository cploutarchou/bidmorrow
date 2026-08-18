import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { CONTRACT_NATURES, type ContractNature } from '@bidmorrow/domain';
import { Combobox } from '../../components/Combobox';
import { ConfirmAction } from '../../components/ConfirmAction';
import { CPV_SUGGESTIONS } from '../../data/cpv-suggestions';
import { api, ApiError } from '../../lib/api';
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

/** `packages/billing/src/plans.ts` `SubscriptionPlan`/`SubscriptionStatus`/`PaymentState` — kept as string literals here rather than importing `@bidmorrow/billing` into the web bundle for a handful of enum values. */
type SubscriptionPlan = 'founding' | 'standard';
type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid';

interface BillingStatus {
  entitlement: {
    active: boolean;
    plan: SubscriptionPlan | null;
    status: SubscriptionStatus | null;
    reason: string;
  };
  subscription: {
    plan: SubscriptionPlan;
    status: SubscriptionStatus;
    cancelAtPeriodEnd: boolean;
    currentPeriodEndAt: number | null;
    price: { amountMinorUnits: number; currency: string; interval: string };
    paymentState: SubscriptionStatus;
  } | null;
  foundingAvailable: boolean;
}

/** `GET /api/billing/invoices`'s `InvoiceSummary` (`packages/billing/src/invoices.ts`). */
interface Invoice {
  readonly id: string;
  readonly number: string | null;
  readonly status: string | null;
  readonly currency: string;
  readonly amountDue: number;
  readonly amountPaid: number;
  readonly createdAt: number;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly hostedInvoiceUrl: string | null;
  readonly invoicePdf: string | null;
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

  const [keywords, setKeywords] = useState<KeywordDto[]>([]);
  const [newKeyword, setNewKeyword] = useState('');

  const [geographies, setGeographies] = useState<GeographyDto[]>([]);
  const [newGeography, setNewGeography] = useState('');

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

  async function refreshBillingStatus(): Promise<void> {
    try {
      const res = await api.get<BillingStatus>('/api/billing/status');
      setBilling(res);
    } catch {
      // Best-effort refresh after cancel/reactivate — the mutation itself
      // already succeeded (or the caller wouldn't have reached this point);
      // a failed re-fetch just means the plan card shows slightly stale
      // data until the next load, never a lost mutation.
    }
  }

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

  async function startCheckout(plan: 'founding' | 'standard'): Promise<void> {
    setBillingError(null);
    setBillingBusy(true);
    try {
      const { url } = await api.post<{ url: string }>('/api/billing/checkout', { plan });
      window.location.href = url;
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
                    migrates to the standard price later.
                  </p>
                  <div className="button-row">
                    {billing.foundingAvailable && (
                      <button
                        className="cta"
                        type="button"
                        disabled={billingBusy}
                        onClick={() => void startCheckout('founding')}
                      >
                        Subscribe — Founding (€29/mo, limited spots)
                      </button>
                    )}
                    <button
                      className="cta"
                      type="button"
                      disabled={billingBusy}
                      onClick={() => void startCheckout('standard')}
                    >
                      Subscribe — Standard (€49/mo)
                    </button>
                  </div>
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
                  onValueChange={setNewCpv}
                  source={cpvComboboxSource}
                  placeholder="e.g. 72220000 or software"
                  hint="A curated shortlist, not exhaustive — any 8-digit CPV code is still accepted below."
                  isChosen={(option) => cpvCodes.includes(option.value)}
                  onCommit={(option) => {
                    if (!cpvCodes.includes(option.value) && cpvCodes.length < 30) {
                      setCpvCodes((cs) => [...cs, option.value]);
                    }
                    setNewCpv('');
                  }}
                />
                <button
                  type="button"
                  className="btn-add"
                  onClick={() => {
                    if (newCpv.trim().length > 0 && cpvCodes.length < 30) {
                      setCpvCodes((cs) => [...cs, newCpv.trim()]);
                      setNewCpv('');
                    }
                  }}
                >
                  Add
                </button>
              </div>
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
                {geographies.map((geo, index) => (
                  <li key={`${geo.kind}-${geo.code}-${index}`}>
                    {geo.kind}: {geo.code}
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
                  onValueChange={(v) => setNewGeography(v.toUpperCase())}
                  source={countryComboboxSource}
                  placeholder="e.g. Germany or DE"
                  hint="EU/EEA countries shown here — any 2-letter country code is still accepted below."
                  isChosen={(option) =>
                    geographies.some(
                      (g) => g.kind === 'opportunity_country' && g.code === option.value,
                    )
                  }
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
                  }}
                />
                <button
                  type="button"
                  className="btn-add"
                  onClick={() => {
                    if (newGeography.trim().length > 0) {
                      setGeographies((gs) => [
                        ...gs,
                        { kind: 'opportunity_country', code: newGeography.trim() },
                      ]);
                      setNewGeography('');
                    }
                  }}
                >
                  Add
                </button>
              </div>
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
                    onChange={(e) =>
                      setMatching({
                        ...matching,
                        maxValueEur: e.target.value.length > 0 ? Number(e.target.value) : null,
                      })
                    }
                  />
                </div>
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
  const overdue =
    subscription.paymentState === 'past_due' || subscription.paymentState === 'unpaid';
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
              We couldn't process your last payment
              {subscription.paymentState === 'past_due'
                ? ' — your subscription is past due.'
                : '.'}{' '}
              Update your payment details to keep your feed and digest active.
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
 * Invoice history table (Task 1 §2): loading/empty/error/forbidden states,
 * per-invoice "View" (hosted Stripe invoice page) and "PDF" (Stripe-hosted
 * download — never a client-fabricated PDF) links. `hasBillingCustomer:
 * false` with zero invoices is a normal "never checked out" state, not an
 * error (mirrors `packages/billing/src/invoices.ts`'s own framing).
 */
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
                  <td>{formatMinorUnitsAsCurrency(invoice.amountPaid, invoice.currency)}</td>
                  <td>{invoiceStatusLabel(invoice.status)}</td>
                  <td className="no-print">
                    <span className="billing-invoice-actions">
                      {invoice.hostedInvoiceUrl !== null && (
                        <a
                          href={invoice.hostedInvoiceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-quiet btn-sm"
                        >
                          View
                        </a>
                      )}
                      {invoice.invoicePdf !== null && (
                        <a
                          href={invoice.invoicePdf}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-quiet btn-sm"
                        >
                          PDF
                        </a>
                      )}
                    </span>
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
