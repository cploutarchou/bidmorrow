import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { COMPANY_PRESETS, CONTRACT_NATURES, type ContractNature } from '@bidmorrow/domain';
import { api, ApiError } from '../../lib/api';
import {
  CERTIFICATION_CODES,
  type CertificationCode,
  type CertificationDto,
  type ExclusionDto,
  type GeographyDto,
  type KeywordDto,
  type OrgProfileResponse,
} from '../../lib/onboarding-types';

const STEPS = [
  'Organization',
  'Company basics',
  'CPV codes',
  'Geographies',
  'Keywords',
  'Capabilities & certifications',
  'Exclusions',
  'Value & deadline',
  'Digest',
  'Review',
] as const;

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

const COUNTRY_OPTIONS = [
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  'IS',
  'LI',
  'NO',
];

export function Onboarding(): ReactElement {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [hasOrg, setHasOrg] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Step 0: organization
  const [orgName, setOrgName] = useState('');

  // Step 1: company basics
  const [presetKey, setPresetKey] = useState<string>('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [employeeBand, setEmployeeBand] = useState('');

  // Step 2: CPV codes
  const [cpvCodes, setCpvCodes] = useState<string[]>([]);
  const [manualCpv, setManualCpv] = useState('');

  // Step 3: geographies
  const [countries, setCountries] = useState<string[]>([]);
  const [nutsInput, setNutsInput] = useState('');
  const [nutsCodes, setNutsCodes] = useState<string[]>([]);

  // Step 4: keywords
  const [keywords, setKeywords] = useState<KeywordDto[]>([]);
  const [keywordInput, setKeywordInput] = useState('');

  // Step 5: capabilities + certifications
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [capabilityInput, setCapabilityInput] = useState('');
  const [certifications, setCertifications] = useState<CertificationDto[]>([]);
  const [newCertCode, setNewCertCode] = useState<CertificationCode>('ISO_27001');
  const [newCertLabel, setNewCertLabel] = useState('');

  // Step 6: exclusions
  const [exclusions, setExclusions] = useState<ExclusionDto[]>([]);
  const [exclusionInput, setExclusionInput] = useState('');

  // Step 7: value + deadline
  const [minValueEur, setMinValueEur] = useState('');
  const [maxValueEur, setMaxValueEur] = useState('');
  const [supportedNatures, setSupportedNatures] = useState<ContractNature[]>([...CONTRACT_NATURES]);
  const [minimumDaysRemaining, setMinimumDaysRemaining] = useState('');

  // Step 8: digest
  const [digestEnabled, setDigestEnabled] = useState(true);
  const [digestSendEmpty, setDigestSendEmpty] = useState(false);
  const [digestMinClassification, setDigestMinClassification] = useState('WORTH_REVIEWING');
  const [digestTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);

  const [scopeOverlapWarning, setScopeOverlapWarning] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    api
      .get<OrgProfileResponse>('/api/org/profile')
      .then((res) => {
        setHasOrg(true);
        if (res.profile !== null) {
          setDisplayName(res.profile.displayName ?? '');
          setDescription(res.profile.description ?? '');
          setWebsite(res.profile.website ?? '');
          setEmployeeBand(res.profile.employeeBand ?? '');
          setPresetKey(res.profile.presetKey ?? '');
          setStep(1);
        }
        // Best-effort prefill of already-saved capabilities/certifications
        // (e.g. a resumed session) — a failure here shouldn't block the rest
        // of the wizard, which is why it's a separate, silently-tolerant
        // fetch rather than part of the required-profile chain above.
        void api
          .get<{ capabilities: { label: string }[] }>('/api/org/capabilities')
          .then((r) => setCapabilities(r.capabilities.map((c) => c.label)))
          .catch(() => undefined);
        void api
          .get<{ certifications: CertificationDto[] }>('/api/org/certifications')
          .then((r) => setCertifications(r.certifications))
          .catch(() => undefined);
      })
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && (cause.status === 403 || cause.status === 401)) {
          setHasOrg(false);
        }
      });
  }, []);

  function applyPreset(key: string): void {
    setPresetKey(key);
    const preset = COMPANY_PRESETS.find((p) => p.key === key);
    if (preset === undefined) return;
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

  async function createOrganization(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/org', { name: orgName });
      setHasOrg(true);
      setStep(1);
    } catch {
      setError('Could not create your organization. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function saveBasics(): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await api.put('/api/org/profile', {
        displayName: displayName.length > 0 ? displayName : null,
        description: description.length > 0 ? description : null,
        website: website.length > 0 ? website : null,
        employeeBand: employeeBand.length > 0 ? employeeBand : null,
        presetKey: presetKey.length > 0 ? presetKey : null,
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
      setCompleted(true);
    } catch {
      setError('Could not complete onboarding. Please review your company profile and try again.');
    } finally {
      setBusy(false);
    }
  }

  function next(): void {
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function toggleCpv(code: string): void {
    setCpvCodes((codes) =>
      codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code].slice(0, 30),
    );
  }

  if (hasOrg === null) {
    return (
      <main id="main-content">
        <p>Loading…</p>
      </main>
    );
  }

  if (completed) {
    return (
      <main id="main-content" className="onboarding-main">
        <h1>You're all set</h1>
        {scopeOverlapWarning && (
          <p role="alert" className="form-warning scope-warning">
            <strong>Heads up:</strong> your CPV preferences don't currently overlap with BidMorrow's
            ingestion scope, so you may not see any matches yet. Review your CPV preferences in
            Settings, or read the <a href="/methodology">methodology page</a> to understand what's
            in scope.
          </p>
        )}
        <button className="cta" type="button" onClick={() => void navigate('/app')}>
          Go to your feed
        </button>
      </main>
    );
  }

  return (
    <main id="main-content" className="onboarding-main">
      <h1>Set up your company profile</h1>
      <p aria-live="polite">
        Step {step + 1} of {STEPS.length}: {STEPS[step]}
      </p>
      {error !== null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      {step === 0 && (
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
          <button className="cta" type="submit" disabled={busy}>
            Create organization
          </button>
        </form>
      )}

      {step === 1 && (
        <section>
          <fieldset>
            <legend>Start from a preset (optional — fully editable)</legend>
            {COMPANY_PRESETS.map((preset) => (
              <label key={preset.key} className="preset-card">
                <input
                  type="radio"
                  name="preset"
                  value={preset.key}
                  checked={presetKey === preset.key}
                  onChange={() => applyPreset(preset.key)}
                />
                <span>
                  <strong>{preset.label}</strong> — {preset.description}
                </span>
              </label>
            ))}
          </fieldset>
          <div className="form-field">
            <label htmlFor="display-name">Company name</label>
            <input
              id="display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="website">Website</label>
            <input
              id="website"
              type="url"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="employee-band">Company size</label>
            <input
              id="employee-band"
              placeholder="e.g. 11-25"
              value={employeeBand}
              onChange={(event) => setEmployeeBand(event.target.value)}
            />
          </div>
          <StepActions
            busy={busy}
            onSkip={next}
            onSave={() =>
              void saveBasics().then((ok) => {
                if (ok) next();
              })
            }
          />
        </section>
      )}

      {step === 2 && (
        <section>
          <p>Select up to 30 CPV codes. Codes from your preset are pre-selected — edit freely.</p>
          <fieldset>
            <legend>CPV codes</legend>
            {[...new Set(COMPANY_PRESETS.flatMap((p) => p.cpvCodes))].map((code) => (
              <label key={code} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={cpvCodes.includes(code)}
                  onChange={() => toggleCpv(code)}
                />
                {code}
              </label>
            ))}
          </fieldset>
          <div className="form-field inline">
            <label htmlFor="manual-cpv">Add another 8-digit CPV code</label>
            <input
              id="manual-cpv"
              value={manualCpv}
              onChange={(event) => setManualCpv(event.target.value)}
            />
            <button
              type="button"
              onClick={() => {
                if (manualCpv.trim().length > 0) {
                  toggleCpv(manualCpv.trim());
                  setManualCpv('');
                }
              }}
            >
              Add
            </button>
          </div>
          <StepActions
            busy={busy}
            onSkip={next}
            onSave={() =>
              void saveCpv().then((ok) => {
                if (ok) next();
              })
            }
          />
        </section>
      )}

      {step === 3 && (
        <section>
          <fieldset>
            <legend>Countries you want to see opportunities from</legend>
            {COUNTRY_OPTIONS.map((code) => (
              <label key={code} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={countries.includes(code)}
                  onChange={() =>
                    setCountries((cs) =>
                      cs.includes(code) ? cs.filter((c) => c !== code) : [...cs, code],
                    )
                  }
                />
                {code}
              </label>
            ))}
          </fieldset>
          <div className="form-field inline">
            <label htmlFor="nuts-input">Add a preferred NUTS code (optional)</label>
            <input
              id="nuts-input"
              value={nutsInput}
              onChange={(event) => setNutsInput(event.target.value)}
            />
            <button
              type="button"
              onClick={() => {
                if (nutsInput.trim().length > 0) {
                  setNutsCodes((n) => [...n, nutsInput.trim()]);
                  setNutsInput('');
                }
              }}
            >
              Add
            </button>
          </div>
          <StepActions
            busy={busy}
            onSkip={next}
            onSave={() =>
              void saveGeographies().then((ok) => {
                if (ok) next();
              })
            }
          />
        </section>
      )}

      {step === 4 && (
        <section>
          <p>
            Keywords describe the kind of work you want to see. Your preset's keywords are
            pre-filled.
          </p>
          <ul className="chip-list">
            {keywords.map((keyword, index) => (
              <li key={`${keyword.kind}-${keyword.term}-${index}`}>
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
          <div className="form-field inline">
            <label htmlFor="keyword-input">Add a keyword</label>
            <input
              id="keyword-input"
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
            />
            <button
              type="button"
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
                }
              }}
            >
              Add
            </button>
          </div>
          <StepActions
            busy={busy}
            onSkip={next}
            onSave={() =>
              void saveKeywords().then((ok) => {
                if (ok) next();
              })
            }
          />
        </section>
      )}

      {step === 5 && (
        <section>
          <p>
            List the capabilities you can deliver and any certifications your company holds — used
            in your score explanations, not shown to buyers.
          </p>
          <fieldset>
            <legend>Capabilities</legend>
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
              <label htmlFor="capability-input">Add a capability</label>
              <input
                id="capability-input"
                value={capabilityInput}
                onChange={(event) => setCapabilityInput(event.target.value)}
              />
              <button
                type="button"
                onClick={() => {
                  if (capabilityInput.trim().length > 0) {
                    setCapabilities((cs) => [...cs, capabilityInput.trim()]);
                    setCapabilityInput('');
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
                    onClick={() => setCertifications((cs) => cs.filter((_, i) => i !== index))}
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
          </fieldset>
          <StepActions
            busy={busy}
            onSkip={next}
            onSave={() =>
              void saveCapabilitiesAndCertifications().then((ok) => {
                if (ok) next();
              })
            }
          />
        </section>
      )}

      {step === 6 && (
        <section>
          <p>Exclude phrases, CPV families, or countries you never want to see.</p>
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
            <label htmlFor="exclusion-input">Add an excluded phrase</label>
            <input
              id="exclusion-input"
              value={exclusionInput}
              onChange={(event) => setExclusionInput(event.target.value)}
            />
            <button
              type="button"
              onClick={() => {
                if (exclusionInput.trim().length > 0) {
                  setExclusions((ex) => [...ex, { kind: 'phrase', value: exclusionInput.trim() }]);
                  setExclusionInput('');
                }
              }}
            >
              Add
            </button>
          </div>
          <StepActions
            busy={busy}
            onSkip={next}
            onSave={() =>
              void saveExclusions().then((ok) => {
                if (ok) next();
              })
            }
          />
        </section>
      )}

      {step === 7 && (
        <section>
          <div className="form-field">
            <label htmlFor="min-value">Minimum contract value (EUR)</label>
            <input
              id="min-value"
              type="number"
              min={0}
              value={minValueEur}
              onChange={(event) => setMinValueEur(event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="max-value">Maximum contract value (EUR)</label>
            <input
              id="max-value"
              type="number"
              min={0}
              value={maxValueEur}
              onChange={(event) => setMaxValueEur(event.target.value)}
            />
          </div>
          <fieldset>
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
            <label htmlFor="min-days">
              Minimum days remaining before deadline you're willing to bid
            </label>
            <input
              id="min-days"
              type="number"
              min={0}
              value={minimumDaysRemaining}
              onChange={(event) => setMinimumDaysRemaining(event.target.value)}
            />
          </div>
          <StepActions
            busy={busy}
            onSkip={next}
            onSave={() =>
              void saveMatchingPreferences().then((ok) => {
                if (ok) next();
              })
            }
          />
        </section>
      )}

      {step === 8 && (
        <section>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={digestEnabled}
              onChange={(event) => setDigestEnabled(event.target.checked)}
            />
            Send me a daily digest email
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={digestSendEmpty}
              onChange={(event) => setDigestSendEmpty(event.target.checked)}
            />
            Send the digest even on days with no matches
          </label>
          <div className="form-field">
            <label htmlFor="digest-min">Minimum classification to include</label>
            <select
              id="digest-min"
              value={digestMinClassification}
              onChange={(event) => setDigestMinClassification(event.target.value)}
            >
              <option value="STRONG_MATCH">Strong match only</option>
              <option value="WORTH_REVIEWING">Worth reviewing or better</option>
              <option value="POSSIBLE_MATCH">Possible match or better</option>
              <option value="LOW_FIT">Everything</option>
            </select>
          </div>
          <StepActions
            busy={busy}
            onSkip={next}
            onSave={() =>
              void saveDigestPreferences().then((ok) => {
                if (ok) next();
              })
            }
          />
        </section>
      )}

      {step === 9 && (
        <section>
          <p>Review complete. You can edit any of this later in Settings.</p>
          <button className="cta" type="button" disabled={busy} onClick={() => void complete()}>
            Finish onboarding
          </button>
        </section>
      )}
    </main>
  );
}

function StepActions({
  busy,
  onSkip,
  onSave,
}: {
  busy: boolean;
  onSkip: () => void;
  onSave: () => void;
}): ReactElement {
  return (
    <div className="step-actions">
      <button type="button" onClick={onSkip} disabled={busy}>
        Skip
      </button>
      <button className="cta" type="button" onClick={onSave} disabled={busy}>
        Save & continue
      </button>
    </div>
  );
}
