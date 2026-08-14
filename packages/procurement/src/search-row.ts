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

  if (sourceNoticeId === null || publicationDate === null || xmlUrl === null) {
    return null;
  }
  return { sourceNoticeId, publicationDate, xmlUrl };
}
