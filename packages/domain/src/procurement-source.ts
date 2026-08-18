import type { NoticeSource } from './enums';

/**
 * Source-agnostic ingestion contract (ADR-0001, docs/architecture.md).
 *
 * `packages/ted` implements this interface; `packages/procurement`
 * orchestrates against it and never imports a concrete source directly.
 * Adding a national portal later means adding an implementation, not
 * changing the pipeline.
 */

/**
 * One raw notice as fetched from a source, before any parsing. The payload is
 * kept verbatim: it is what gets snapshotted to R2 (ADR-0005) and what the
 * source-specific parser consumes.
 */
export interface RawNotice {
  /** Source-scoped stable notice id (TED: publication number). */
  readonly sourceNoticeId: string;
  /** ISO-8601 calendar date (`YYYY-MM-DD`) this notice (version) was published. */
  readonly publicationDate: string;
  /** Raw payload exactly as fetched (TED: eForms XML), bytes or text. */
  readonly raw: Uint8Array | string;
  /** Canonical link to the original notice at the source. */
  readonly sourceUrl: string;
  /** Language codes present in the source payload (source-native codes). */
  readonly languages: readonly string[];
}

/** A bounded publication-date window, the unit of incremental ingestion. */
export interface FetchWindowParams {
  /** Window start, ISO-8601 `YYYY-MM-DD`, inclusive. */
  readonly windowFrom: string;
  /** Window end, ISO-8601 `YYYY-MM-DD`, inclusive. */
  readonly windowTo: string;
  /**
   * Opaque source-specific continuation token to resume a partially processed
   * window (TED: iteration token; persisted as
   * `ingestion_checkpoints.last_sequence_token`). Omit to start the window
   * from the beginning.
   */
  readonly resumeToken?: string;
}

export interface ProcurementSource {
  /** Stable source identifier, recorded on every ingested row. */
  readonly id: NoticeSource;
  /**
   * Stream raw notices for one bounded publication-date window. Implementations
   * are expected to paginate internally, throttle politely, and surface
   * per-notice fetch failures by throwing — the orchestrator owns run status
   * and checkpoint advancement.
   */
  fetchWindow(params: FetchWindowParams): AsyncIterable<RawNotice>;
}
