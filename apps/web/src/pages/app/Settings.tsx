import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { CONTRACT_NATURES, type ContractNature } from '@bidmorrow/domain';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
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

  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const [profileRes, cpvRes, kwRes, geoRes, exRes, capRes, certRes] = await Promise.all([
          api.get<OrgProfileResponse>('/api/org/profile'),
          api.get<{ cpvPreferences: { cpvCode: string }[] }>('/api/org/cpv-preferences'),
          api.get<{ keywords: KeywordDto[] }>('/api/org/keywords'),
          api.get<{ geographies: GeographyDto[] }>('/api/org/geographies'),
          api.get<{ exclusions: ExclusionDto[] }>('/api/org/exclusions'),
          api.get<{ capabilities: { label: string }[] }>('/api/org/capabilities'),
          api.get<{ certifications: CertificationDto[] }>('/api/org/certifications'),
        ]);
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

  if (loading) return <p>Loading…</p>;

  return (
    <>
      <title>Settings — BidMorrow</title>
      <h1>Settings</h1>
      <p role="status" aria-live="polite" className="visually-hidden-status">
        {statusMessage}
      </p>
      {saveError !== null && (
        <p role="alert" className="form-error">
          {saveError}
        </p>
      )}

      <section>
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
        <button className="cta" type="button" onClick={() => void saveProfile()}>
          Save profile
        </button>
      </section>

      <section>
        <h2>CPV codes</h2>
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
        <div className="form-field inline">
          <label htmlFor="new-cpv">Add CPV code</label>
          <input id="new-cpv" value={newCpv} onChange={(e) => setNewCpv(e.target.value)} />
          <button
            type="button"
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
        <button className="cta" type="button" onClick={() => void saveCpv()}>
          Save CPV codes
        </button>
      </section>

      <section>
        <h2>Keywords</h2>
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
        <div className="form-field inline">
          <label htmlFor="new-keyword">Add keyword</label>
          <input
            id="new-keyword"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
          />
          <button
            type="button"
            onClick={() => {
              if (newKeyword.trim().length > 0) {
                setKeywords((ks) => [
                  ...ks,
                  { kind: 'positive', term: newKeyword.trim(), synonymGroup: null, language: null },
                ]);
                setNewKeyword('');
              }
            }}
          >
            Add
          </button>
        </div>
        <button className="cta" type="button" onClick={() => void saveKeywords()}>
          Save keywords
        </button>
      </section>

      <section>
        <h2>Geographies</h2>
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
        <div className="form-field inline">
          <label htmlFor="new-geo">Add country code (opportunity country)</label>
          <input
            id="new-geo"
            maxLength={2}
            value={newGeography}
            onChange={(e) => setNewGeography(e.target.value.toUpperCase())}
          />
          <button
            type="button"
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
        <button className="cta" type="button" onClick={() => void saveGeographies()}>
          Save geographies
        </button>
      </section>

      <section>
        <h2>Exclusions</h2>
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
            onClick={() => {
              if (newExclusion.trim().length > 0) {
                setExclusions((ex) => [...ex, { kind: 'phrase', value: newExclusion.trim() }]);
                setNewExclusion('');
              }
            }}
          >
            Add
          </button>
        </div>
        <button className="cta" type="button" onClick={() => void saveExclusions()}>
          Save exclusions
        </button>
      </section>

      <section>
        <h2>Capabilities</h2>
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
        <button className="cta" type="button" onClick={() => void saveCapabilities()}>
          Save capabilities
        </button>
      </section>

      <section>
        <h2>Certifications</h2>
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
        <button className="cta" type="button" onClick={() => void saveCertifications()}>
          Save certifications
        </button>
      </section>

      {matching !== null && (
        <section>
          <h2>Value range & deadline threshold</h2>
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
            <label htmlFor="settings-min-days">Minimum days remaining you're willing to bid</label>
            <input
              id="settings-min-days"
              type="number"
              min={0}
              value={matching.minimumDaysRemaining ?? ''}
              onChange={(e) =>
                setMatching({
                  ...matching,
                  minimumDaysRemaining: e.target.value.length > 0 ? Number(e.target.value) : null,
                })
              }
            />
          </div>
          <button className="cta" type="button" onClick={() => void saveMatching()}>
            Save matching preferences
          </button>
        </section>
      )}

      {digest !== null && (
        <section>
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
          <button className="cta" type="button" onClick={() => void saveDigest()}>
            Save digest preferences
          </button>
        </section>
      )}

      <section>
        <h2>Delete account</h2>
        <p>
          This permanently deletes your account. If you're the sole owner of an organization, you
          must transfer or delete it first.
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
    </>
  );
}
