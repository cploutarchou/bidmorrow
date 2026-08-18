/**
 * Extracts the fields the orchestrator needs from one TED Search API result
 * row (`TedSearchResponse.notices[i]`, a loosely-typed record keyed by the
 * requested `fields`). Search-API row fields OVERRIDE whatever the eForms
 * XML parser would otherwise fall back to (stage A's publication-number /
 * publication-date fallback warnings) — the Search API is authoritative
 * during ingestion (docs/ted-data-source.md).
 */

export interface SearchRowFields {
  readonly sourceNoticeId: string;
  /** `YYYY-MM-DD`. */
  readonly publicationDate: string;
  /** `links.xml.MUL` — the notice's full-text XML URL. */
  readonly xmlUrl: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The documented TED publication-number format: up to 8 digits, a hyphen,
 * then a 4-digit year (e.g. `123456-2026`).
 */
const TED_PUBLICATION_NUMBER_RE = /^\d{1,8}-\d{4}$/;

/**
 * Conservative fallback charset for `publication-number` values that don't
 * match the documented TED format. Some historic/demo notice ids legitimately
 * differ from the current format (verified against scripts/seed-demo.sql's
 * `TED-DEMO-00N` ids), so we don't hard-reject on format mismatch alone — but
 * this value becomes a raw R2 key path segment (snapshot.ts) and a filesystem
 * path-like identifier elsewhere, so ANY value we accept must be free of `/`
 * and bounded in length. A row is only rejected when it fails BOTH tiers.
 */
const CONSERVATIVE_ID_CHARSET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** True when `sourceNoticeId` is safe to use as a source_notice_id / R2 key segment. */
function isValidSourceNoticeId(value: string): boolean {
  return TED_PUBLICATION_NUMBER_RE.test(value) || CONSERVATIVE_ID_CHARSET_RE.test(value);
}

/**
 * Cap on an accepted `links.xml.MUL` URL. Real TED notice-XML URLs are
 * ~50 chars; the window work queue now buffers every accepted row in memory
 * (run-window.ts phase 1), so a hostile/compromised search response must
 * not be able to inflate per-row size unboundedly (BM-51-1, security review
 * PR #51). Longer URLs are treated as a malformed row.
 */
const MAX_XML_URL_CHARS = 2_048;

/**
 * Pulls `publication-number`, `publication-date`, and `links.xml.MUL` out of
 * a search row. Returns null (never throws, never fabricates) when any
 * required field is missing or malformed — the caller records an
 * `ingestion_errors` row and moves on to the next notice; one malformed
 * search row must never abort the window.
 */
export function extractSearchRow(row: Readonly<Record<string, unknown>>): SearchRowFields | null {
  const sourceNoticeId = asNonEmptyString(row['publication-number']);
  const publicationDateRaw = asNonEmptyString(row['publication-date']);
  const publicationDate =
    publicationDateRaw !== null && /^\d{4}-\d{2}-\d{2}/.test(publicationDateRaw)
      ? publicationDateRaw.slice(0, 10)
      : null;
  const links = asRecord(row['links']);
  const xml = links === null ? null : asRecord(links['xml']);
  const xmlUrl = xml === null ? null : asNonEmptyString(xml['MUL']);

  if (
    sourceNoticeId === null ||
    publicationDate === null ||
    xmlUrl === null ||
    xmlUrl.length > MAX_XML_URL_CHARS ||
    !isValidSourceNoticeId(sourceNoticeId)
  ) {
    return null;
  }
  return { sourceNoticeId, publicationDate, xmlUrl };
}
