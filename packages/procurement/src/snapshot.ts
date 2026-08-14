/**
 * R2 raw-XML snapshot helpers (ADR-0005): deterministic path, content hash
 * (pre-compression, per the ADR), and gzip via the `CompressionStream` Web
 * API (available in workerd and Node ≥ 22 — no extra dependency).
 */

/** `ted/{publication-year}/{source_notice_id}/{version}.xml.gz` (ADR-0005). */
export function buildSnapshotR2Key(
  source: string,
  publicationDate: string,
  sourceNoticeId: string,
  versionNumber: number,
): string {
  const year = publicationDate.slice(0, 4);
  return `${source}/${year}/${sourceNoticeId}/${String(versionNumber)}.xml.gz`;
}

/** SHA-256 hex digest of the raw (pre-compression) payload. */
export async function sha256Hex(payload: string): Promise<string> {
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Gzips a UTF-8 string via `CompressionStream('gzip')`. */
export async function gzipText(payload: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(payload);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}
