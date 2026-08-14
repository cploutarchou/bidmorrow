/**
 * eForms notice XML → NormalizedNotice.
 *
 * Field selection follows the verified field map in docs/ted-data-source.md
 * (SDK 1.15.1 `fields.json`); the parser tolerates the 1.13–1.15 range and
 * parses unknown minor versions best-effort with a recorded warning.
 *
 * Principles:
 * - NEVER fabricate: absent optional data is `null` / empty; absent required
 *   data becomes an `error`-severity ParseIssue and the parse throws
 *   `TedParseError` (the caller routes it to ingestion_errors).
 * - Multilingual text is kept as {lang → text} maps (lowercased ISO 639-2
 *   keys); language-independent normalization happens downstream and a
 *   notice is never penalized for its language.
 * - Buyer resolution (OPT-300 indirection): the notice's
 *   `cac:ContractingParty/cac:Party/cac:PartyIdentification/cbc:ID`
 *   (schemeName "organization") is a REFERENCE into the eForms extension's
 *   organization table (`efac:Organizations/efac:Organization`), matched on
 *   `efac:Company/cac:PartyIdentification/cbc:ID`. Name/country come from
 *   the resolved `efac:Company`, the legal-type code from
 *   `cac:ContractingPartyType/cbc:PartyTypeCode[@listName='buyer-legal-type']`.
 */

import { TedParseError } from '../errors';
import type { ParseIssue } from '../errors';
import type { XmlNode } from './xml';
import { attr, child, children, descend, parseXmlDocument, text, wasTruncated } from './xml';

/** Language-keyed text variants (lowercased ISO 639-2 keys, e.g. `eng`). */
export type LanguageTextMap = Readonly<Record<string, string>>;

export interface MoneyValue {
  readonly amount: number;
  /** ISO-4217 currency code from the `currencyID` attribute. */
  readonly currency: string;
}

export interface NormalizedLot {
  /** BT-137 lot id, e.g. `LOT-0001`. */
  readonly lotId: string;
  /** BT-21-Lot title variants; null when the lot carries no title. */
  readonly title: LanguageTextMap | null;
  /** BT-24-Lot description variants. */
  readonly description: LanguageTextMap | null;
  /** BT-23 contract nature (lot level, falling back to procedure level). */
  readonly contractNature: string | null;
  /**
   * BT-27-Lot estimated value. Lot-level ONLY — a procedure-level total is
   * exposed as `procedureEstimatedValue` on the notice; dividing it across
   * lots (`value_is_derived`) is a stage-B decision, not parsing.
   */
  readonly estimatedValue: MoneyValue | null;
  /**
   * BT-131 submission deadline as epoch millis UTC. Null when the notice
   * has no submission deadline (legitimate for several procedure types).
   */
  readonly deadline: number | null;
  /** BT-262/BT-263 CPV codes, lot level falling back to procedure level. */
  readonly cpv: { readonly main: string | null; readonly additional: readonly string[] };
  /** BT-5071 NUTS codes, lot level falling back to procedure level. */
  readonly nuts: readonly string[];
}

export interface NormalizedBuyer {
  /** BT-500 buyer name (primary-language variant). */
  readonly name: string;
  /** All language variants of the buyer name. */
  readonly nameByLanguage: LanguageTextMap;
  /** BT-514 country identification code, verbatim from the source (ISO 3166-1 alpha-3 in eForms; alpha-2 mapping happens in stage B). */
  readonly country: string | null;
  /** BT-11 buyer legal type code, e.g. `la`, `eu-ins-bod-ag`. */
  readonly legalTypeCode: string | null;
  /** eForms organization id (`ORG-0001`) — feeds buyers.source_buyer_id. */
  readonly organizationId: string | null;
}

export interface NormalizedNotice {
  /**
   * TED publication number (`efac:Publication/efbc:NoticePublicationID`).
   * Pre-publication documents (e.g. official SDK examples) carry none; we
   * fall back to the notice-id UUID with a warning issue.
   */
  readonly sourceNoticeId: string;
  /** Declared SDK version from `cbc:CustomizationID`, e.g. `1.15`. Required. */
  readonly eformsSdkVersion: string;
  /** `cbc:NoticeTypeCode/@listName`, e.g. `competition` (BT-03). */
  readonly formType: string;
  /** `cbc:NoticeTypeCode` value, e.g. `cn-standard`. */
  readonly noticeType: string;
  /** `efac:NoticeSubType/cbc:SubTypeCode` (OPP-070), e.g. `16`. */
  readonly noticeSubtype: string | null;
  /** BT-702 primary + additional notice languages, lowercased, in order. */
  readonly languages: readonly string[];
  readonly buyer: NormalizedBuyer | null;
  /** BT-105 procedure code, e.g. `open`. */
  readonly procedureType: string | null;
  /** BT-23 procedure-level contract nature. */
  readonly contractNature: string | null;
  /**
   * `YYYY-MM-DD`. From `efbc:PublicationDate` when published; otherwise the
   * dispatch `cbc:IssueDate` with a warning issue (the Search API row is the
   * authoritative publication date during ingestion).
   */
  readonly publicationDate: string | null;
  /** BT-27-Procedure total estimated value (see NormalizedLot.estimatedValue). */
  readonly procedureEstimatedValue: MoneyValue | null;
  readonly lots: readonly NormalizedLot[];
  /** Warning-severity issues tolerated during a successful parse. */
  readonly issues: readonly ParseIssue[];
}

/** SDK minor-version range the field map was verified against. */
const SUPPORTED_SDK_RANGE = { major: 1, minMinor: 13, maxMinor: 15 };

// Anchored, linear regexes (no nested quantifiers — ReDoS-safe).
const CUSTOMIZATION_RE = /^eforms-sdk-(\d+)\.(\d+)/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(Z|[+-]\d{2}:\d{2})?$/;
const TIME_RE = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
const CPV_RE = /^(\d{8})(?:-\d)?$/;

interface IssueCollector {
  readonly issues: ParseIssue[];
  add(severity: ParseIssue['severity'], code: string, message: string, path?: string): void;
}

function makeCollector(): IssueCollector {
  const issues: ParseIssue[] = [];
  return {
    issues,
    add(severity, code, message, path) {
      issues.push(
        path === undefined ? { severity, code, message } : { severity, code, message, path },
      );
    },
  };
}

function offsetToMillis(offset: string | undefined): number {
  if (offset === undefined || offset === 'Z') {
    return 0;
  }
  const sign = offset.startsWith('-') ? -1 : 1;
  const hours = Number(offset.slice(1, 3));
  const minutes = Number(offset.slice(4, 6));
  return sign * (hours * 60 + minutes) * 60_000;
}

/** Extract the `YYYY-MM-DD` part of an eForms date value, or null. */
function datePart(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const match = DATE_RE.exec(value);
  return match ? `${match[1] ?? ''}-${match[2] ?? ''}-${match[3] ?? ''}` : null;
}

/**
 * Combine BT-131 EndDate/EndTime into epoch millis UTC. A date without a
 * time is interpreted as end-of-day (23:59:59.999) in the declared offset —
 * recorded as a warning, never silently.
 */
function parseDeadline(
  endDate: string | null,
  endTime: string | null,
  lotId: string,
  collector: IssueCollector,
): number | null {
  if (endDate === null) {
    return null;
  }
  const dateMatch = DATE_RE.exec(endDate);
  if (!dateMatch) {
    collector.add('warning', 'invalid-deadline-date', `unparseable EndDate "${endDate}"`, lotId);
    return null;
  }
  const [, year, month, day, dateOffset] = dateMatch;
  let hours = 23;
  let minutes = 59;
  let seconds = 59;
  let millis = 999;
  let offset = dateOffset;
  if (endTime !== null) {
    const timeMatch = TIME_RE.exec(endTime);
    if (!timeMatch) {
      collector.add('warning', 'invalid-deadline-time', `unparseable EndTime "${endTime}"`, lotId);
      return null;
    }
    hours = Number(timeMatch[1]);
    minutes = Number(timeMatch[2]);
    seconds = Number(timeMatch[3]);
    millis = 0;
    offset = timeMatch[4] ?? dateOffset;
  } else {
    collector.add(
      'warning',
      'deadline-time-missing',
      'EndTime absent; deadline interpreted as end of day in the declared offset',
      lotId,
    );
  }
  if (offset === undefined) {
    collector.add(
      'warning',
      'deadline-offset-missing',
      'no timezone offset on deadline; interpreted as UTC',
      lotId,
    );
  }
  const utc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    hours,
    minutes,
    seconds,
    millis,
  );
  return utc - offsetToMillis(offset);
}

/**
 * Collect language-tagged text variants into a {lang → text} map. Elements
 * without a `languageID` are keyed under the notice's primary language when
 * known (single-language notices legitimately omit the attribute), else
 * `und` (ISO 639-2 "undetermined").
 */
function langMap(
  nodes: readonly XmlNode[],
  primaryLanguage: string | null,
  collector: IssueCollector,
  path: string,
): LanguageTextMap | null {
  const map: Record<string, string> = {};
  for (const node of nodes) {
    const value = text(node);
    if (value === null) {
      continue;
    }
    if (wasTruncated(node)) {
      collector.add(
        'warning',
        'text-truncated',
        'text value exceeded the 100k character cap and was truncated',
        path,
      );
    }
    const lang = (attr(node, 'languageID') ?? primaryLanguage ?? 'und').toLowerCase();
    // First variant per language wins; duplicates are a source anomaly.
    if (!(lang in map)) {
      map[lang] = value;
    } else {
      collector.add('warning', 'duplicate-language-variant', `duplicate ${lang} variant`, path);
    }
  }
  return Object.keys(map).length > 0 ? map : null;
}

/** Normalize a CPV code: strip the display check digit; keep 8-digit core. */
function normalizeCpv(raw: string, collector: IssueCollector, path: string): string {
  const match = CPV_RE.exec(raw);
  if (match?.[1] !== undefined) {
    return match[1];
  }
  collector.add(
    'warning',
    'unexpected-cpv-format',
    `CPV code "${raw}" is not 8 digits; kept verbatim`,
    path,
  );
  return raw;
}

interface ClassificationExtraction {
  readonly main: string | null;
  readonly additional: readonly string[];
}

/** BT-262/BT-263 from a ProcurementProject node (lot or procedure). */
function extractCpv(
  project: XmlNode | null,
  collector: IssueCollector,
  path: string,
): ClassificationExtraction {
  const mainNode = descend(project, 'MainCommodityClassification', 'ItemClassificationCode');
  const mainRaw = text(mainNode);
  const additional: string[] = [];
  for (const node of children(project, 'AdditionalCommodityClassification')) {
    const code = text(child(node, 'ItemClassificationCode'));
    if (code !== null) {
      const normalized = normalizeCpv(code, collector, path);
      if (!additional.includes(normalized)) {
        additional.push(normalized);
      }
    }
  }
  return { main: mainRaw === null ? null : normalizeCpv(mainRaw, collector, path), additional };
}

/** BT-5071 NUTS codes from a ProcurementProject node. */
function extractNuts(project: XmlNode | null): string[] {
  const codes: string[] = [];
  for (const location of children(project, 'RealizedLocation')) {
    const code = text(descend(location, 'Address', 'CountrySubentityCode'));
    if (code !== null && !codes.includes(code)) {
      codes.push(code);
    }
  }
  return codes;
}

/** BT-27 estimated value from a project node (RequestedTenderTotal). */
function extractEstimatedValue(
  project: XmlNode | null,
  collector: IssueCollector,
  path: string,
): MoneyValue | null {
  const amountNode = descend(project, 'RequestedTenderTotal', 'EstimatedOverallContractAmount');
  if (amountNode === null) {
    return null;
  }
  const raw = text(amountNode);
  const currency = attr(amountNode, 'currencyID');
  if (raw === null) {
    return null;
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount)) {
    collector.add('warning', 'invalid-estimated-value', `non-numeric amount "${raw}"`, path);
    return null;
  }
  if (currency === null) {
    collector.add(
      'warning',
      'missing-value-currency',
      'estimated value has no currencyID; value dropped (never guess a currency)',
      path,
    );
    return null;
  }
  return { amount, currency };
}

function firstListNameMatch(nodes: readonly XmlNode[], listName: string): XmlNode | null {
  return nodes.find((node) => attr(node, 'listName') === listName) ?? null;
}

/** Parse one eForms notice XML document; throws TedParseError on fatal issues. */
export function parseEformsNotice(xml: string): NormalizedNotice {
  const collector = makeCollector();

  const doc = parseXmlDocument(xml);
  if (!doc.ok || doc.root === null) {
    collector.add('error', 'malformed-xml', doc.error ?? 'unparseable XML document');
    throw new TedParseError(collector.issues, null);
  }
  const root = doc.root;

  // Locate the eForms extension (organization table, subtype, publication).
  let eformsExtension: XmlNode | null = null;
  for (const extension of children(child(root, 'UBLExtensions'), 'UBLExtension')) {
    const candidate = descend(extension, 'ExtensionContent', 'EformsExtension');
    if (candidate !== null) {
      eformsExtension = candidate;
      break;
    }
  }

  // Source notice id: publication number, falling back to the notice-id UUID.
  const publication = child(eformsExtension, 'Publication');
  const publicationNumber = text(child(publication, 'NoticePublicationID'));
  const noticeIdNodes = children(root, 'ID');
  const noticeUuid = text(
    firstListNameMatch(noticeIdNodes, 'notice-id') ??
      noticeIdNodes.find((n) => attr(n, 'schemeName') === 'notice-id') ??
      noticeIdNodes[0] ??
      null,
  );
  const sourceNoticeId = publicationNumber ?? noticeUuid;
  if (publicationNumber === null && noticeUuid !== null) {
    collector.add(
      'warning',
      'missing-publication-number',
      'no efbc:NoticePublicationID; using cbc:ID (notice-id) as sourceNoticeId',
    );
  }
  if (sourceNoticeId === null) {
    collector.add(
      'error',
      'missing-source-notice-id',
      'neither publication number nor notice id present',
    );
  }

  // SDK version (OPT-002) — REQUIRED.
  const customizationId = text(child(root, 'CustomizationID'));
  let eformsSdkVersion: string | null = null;
  if (customizationId === null) {
    collector.add(
      'error',
      'missing-customization-id',
      'cbc:CustomizationID absent — cannot determine eForms SDK version',
    );
  } else {
    const match = CUSTOMIZATION_RE.exec(customizationId);
    if (!match) {
      collector.add(
        'error',
        'unsupported-customization-id',
        `cbc:CustomizationID "${customizationId}" is not an eforms-sdk-<major>.<minor> value`,
      );
    } else {
      const major = Number(match[1]);
      const minor = Number(match[2]);
      eformsSdkVersion = `${String(major)}.${String(minor)}`;
      if (
        major !== SUPPORTED_SDK_RANGE.major ||
        minor < SUPPORTED_SDK_RANGE.minMinor ||
        minor > SUPPORTED_SDK_RANGE.maxMinor
      ) {
        // Version drift alone is never a hard failure — parse best-effort.
        collector.add(
          'warning',
          'untested-sdk-version',
          `SDK ${eformsSdkVersion} is outside the verified 1.13–1.15 range; parsed best-effort`,
        );
      }
    }
  }

  // Form type / notice type (BT-03).
  const noticeTypeNode = child(root, 'NoticeTypeCode');
  const noticeType = text(noticeTypeNode);
  const formType = attr(noticeTypeNode, 'listName');
  if (noticeType === null || formType === null) {
    collector.add('error', 'missing-notice-type', 'cbc:NoticeTypeCode (with listName) absent');
  }
  const noticeSubtype = text(descend(eformsExtension, 'NoticeSubType', 'SubTypeCode'));

  // Languages (BT-702 + additional), lowercased, order-preserving.
  const languages: string[] = [];
  const primaryLanguageRaw = text(child(root, 'NoticeLanguageCode'));
  const primaryLanguage = primaryLanguageRaw?.toLowerCase() ?? null;
  if (primaryLanguage !== null) {
    languages.push(primaryLanguage);
  } else {
    collector.add('warning', 'missing-notice-language', 'cbc:NoticeLanguageCode absent');
  }
  for (const additional of children(root, 'AdditionalNoticeLanguage')) {
    const code = text(child(additional, 'ID'))?.toLowerCase();
    if (code !== undefined && !languages.includes(code)) {
      languages.push(code);
    }
  }

  // Buyer via OPT-300 organization resolution (see module docs).
  const buyer = resolveBuyer(root, eformsExtension, primaryLanguage, collector);

  // Procedure-level facts.
  const procedureType = text(child(descend(root, 'TenderingProcess'), 'ProcedureCode'));
  const procedureProject = child(root, 'ProcurementProject');
  const contractNature = text(
    firstListNameMatch(children(procedureProject, 'ProcurementTypeCode'), 'contract-nature') ??
      child(procedureProject, 'ProcurementTypeCode'),
  );
  const procedureCpv = extractCpv(procedureProject, collector, 'procedure');
  const procedureNuts = extractNuts(procedureProject);
  const procedureEstimatedValue = extractEstimatedValue(procedureProject, collector, 'procedure');

  // Publication date.
  const publicationDate = datePart(text(child(publication, 'PublicationDate')));
  let effectivePublicationDate = publicationDate;
  if (effectivePublicationDate === null) {
    effectivePublicationDate = datePart(text(child(root, 'IssueDate')));
    if (effectivePublicationDate !== null) {
      collector.add(
        'warning',
        'publication-date-from-issue-date',
        'no efbc:PublicationDate; using dispatch cbc:IssueDate (Search API date is authoritative during ingestion)',
      );
    }
  }

  // Lots: ProcurementProjectLot with schemeName="Lot" ONLY — LotsGroup /
  // Part entries share the element name and must not become lots.
  const lots: NormalizedLot[] = [];
  for (const lotNode of children(root, 'ProcurementProjectLot')) {
    const idNode =
      children(lotNode, 'ID').find((node) => attr(node, 'schemeName') === 'Lot') ?? null;
    if (idNode === null) {
      continue; // lots group or other non-Lot entry
    }
    const lotId = text(idNode);
    if (lotId === null) {
      collector.add('error', 'missing-lot-id', 'ProcurementProjectLot has an empty Lot ID');
      continue;
    }
    const project = child(lotNode, 'ProcurementProject');
    const lotCpv = extractCpv(project, collector, lotId);
    const lotNuts = extractNuts(project);
    const deadlinePeriod = descend(lotNode, 'TenderingProcess', 'TenderSubmissionDeadlinePeriod');
    const lotContractNature = text(
      firstListNameMatch(children(project, 'ProcurementTypeCode'), 'contract-nature') ??
        child(project, 'ProcurementTypeCode'),
    );
    lots.push({
      lotId,
      title: langMap(children(project, 'Name'), primaryLanguage, collector, lotId),
      description: langMap(children(project, 'Description'), primaryLanguage, collector, lotId),
      contractNature: lotContractNature ?? contractNature,
      estimatedValue: extractEstimatedValue(project, collector, lotId),
      deadline: parseDeadline(
        text(child(deadlinePeriod, 'EndDate')),
        text(child(deadlinePeriod, 'EndTime')),
        lotId,
        collector,
      ),
      // Lot-level classification wins wholesale; only a lot with NO main CPV
      // inherits the procedure's codes (field-map fallback, never mixed).
      cpv: lotCpv.main !== null ? lotCpv : procedureCpv,
      nuts: lotNuts.length > 0 ? lotNuts : procedureNuts,
    });
  }
  if (lots.length === 0) {
    collector.add(
      'error',
      'no-lots',
      'notice contains no ProcurementProjectLot with schemeName="Lot"',
    );
  }

  if (collector.issues.some((issue) => issue.severity === 'error')) {
    throw new TedParseError(collector.issues, sourceNoticeId);
  }

  // The error check above guarantees these are non-null.
  if (
    sourceNoticeId === null ||
    eformsSdkVersion === null ||
    noticeType === null ||
    formType === null
  ) {
    throw new TedParseError(collector.issues, sourceNoticeId);
  }

  return {
    sourceNoticeId,
    eformsSdkVersion,
    formType,
    noticeType,
    noticeSubtype,
    languages,
    buyer,
    procedureType,
    contractNature,
    publicationDate: effectivePublicationDate,
    procedureEstimatedValue,
    lots,
    issues: collector.issues,
  };
}

function resolveBuyer(
  root: XmlNode,
  eformsExtension: XmlNode | null,
  primaryLanguage: string | null,
  collector: IssueCollector,
): NormalizedBuyer | null {
  const contractingParties = children(root, 'ContractingParty');
  if (contractingParties.length === 0) {
    collector.add('warning', 'buyer-unresolved', 'no cac:ContractingParty on the notice');
    return null;
  }
  if (contractingParties.length > 1) {
    collector.add(
      'warning',
      'multiple-contracting-parties',
      `notice has ${String(contractingParties.length)} contracting parties; using the first`,
    );
  }
  const contractingParty = contractingParties[0] ?? null;
  const orgIdNode =
    children(descend(contractingParty, 'Party', 'PartyIdentification'), 'ID').find(
      (node) => attr(node, 'schemeName') === 'organization',
    ) ?? descend(contractingParty, 'Party', 'PartyIdentification', 'ID');
  const organizationId = text(orgIdNode ?? null);

  const legalTypeCode = text(
    children(contractingParty, 'ContractingPartyType')
      .map((node) => child(node, 'PartyTypeCode'))
      .find((node) => attr(node, 'listName') === 'buyer-legal-type') ?? null,
  );

  if (organizationId === null) {
    collector.add('warning', 'buyer-unresolved', 'contracting party has no organization reference');
    return null;
  }

  // OPT-300: match the reference against the extension organization table.
  let company: XmlNode | null = null;
  for (const organization of children(child(eformsExtension, 'Organizations'), 'Organization')) {
    const candidate = child(organization, 'Company');
    if (text(descend(candidate, 'PartyIdentification', 'ID')) === organizationId) {
      company = candidate;
      break;
    }
  }
  if (company === null) {
    collector.add(
      'warning',
      'buyer-unresolved',
      `organization "${organizationId}" not found in efac:Organizations`,
    );
    return null;
  }

  // A multilingual organization repeats the whole cac:PartyName wrapper
  // (one cbc:Name per wrapper) — collect across ALL wrappers.
  const nameByLanguage = langMap(
    children(company, 'PartyName').flatMap((partyName) => children(partyName, 'Name')),
    primaryLanguage,
    collector,
    `buyer:${organizationId}`,
  );
  if (nameByLanguage === null) {
    collector.add('warning', 'buyer-unresolved', `organization "${organizationId}" has no name`);
    return null;
  }
  const name =
    (primaryLanguage !== null ? nameByLanguage[primaryLanguage] : undefined) ??
    Object.values(nameByLanguage)[0] ??
    null;
  if (name === null) {
    return null;
  }
  return {
    name,
    nameByLanguage,
    country: text(descend(company, 'PostalAddress', 'Country', 'IdentificationCode')),
    legalTypeCode,
    organizationId,
  };
}
