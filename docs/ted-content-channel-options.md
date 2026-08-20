# TED content-channel options (2026-08-20)

Evidence-backed options analysis for the coordinator and architect. This doc
does NOT decide — the architect writes the superseding/amending ADR(s). It
supplies the field inventory, per-option evidence with an explicit
VERIFIED/INFERRED split, the concrete next verification steps (dispatchable
CI probes authored alongside this doc), and a recommendation with reasoning.

## 1. Situation

The only V1 notice-content channel — the anonymous XML front-end
(`ted.europa.eu/<lang>/notice/<id>/xml`, `links.xml.MUL` from search rows) —
renders asynchronously and, as of 2026-08-20, **never completes**:

- CI probe run 32337551926 (`ted-render-batch-probe`): a 5-notice batch and
  a 50-notice batch, polled at +60 s/+120 s/+180 s after triggering — **0
  rendered in every pass**, 100 responses, zero errors (all 202/empty).
  This falsifies the "small batches complete" hypothesis of ADR-0009 §3.
- Staging 05:00 UTC cron (2026-08-20): 0/156 renders completed over
  ~8–10 minutes across 6 visits per notice.
- On 2026-08-18 a single-notice CI probe DID collect a render (200 +
  12,953 bytes) — so this is a recent upstream change/outage, not our
  client. (VERIFIED, our own probes.)
- **There is NO authenticated notice-XML download endpoint** (VERIFIED live
  2026-08-18 against the owner's real key and the API's own OpenAPI spec,
  `ted-api-probe` runs 32152093521/32155040026; docs/ted-data-source.md).
  The v3 API surface is eSender submission + the anonymous Search API.

The Search API itself (`POST /v3/notices/search`) is anonymous, unaffected,
and is how we already enumerate in-scope notices (scope query per
docs/ted-ingestion-scope.md, `SEARCH_FIELDS` in
`packages/procurement/src/run-window.ts`).

Sandbox constraint: `ted.europa.eu`, `api.ted.europa.eu`, `docs.ted.europa.eu`
and `op.europa.eu` are egress-blocked from this environment (confirmed
2026-08-20: CONNECT 403 from the proxy). Everything below that needs the live
service or its official docs is marked INFERRED and has a dispatchable CI
probe (CI has open egress) to settle it.

## 2. What the pipeline actually needs (field inventory)

Sources: `parseEformsNotice` (`packages/ted/src/parser/parse-notice.ts`),
persistence (`packages/procurement/src/run-window.ts` →
`upsertBuyer`/`upsertNoticeWithVersion`/`insertLots`/`insertCpvCodes`/
`insertGeographies`), the matching engine input
(`packages/matching/src/types.ts` `LotInput`, mapped in
`packages/procurement/src/scoring-input.ts`), and the feed/detail UI
(`apps/web/src/pages/app/TenderDetail.tsx`).

Search-API column status: **V** = alias verified 2026-08-14 against the TED
OpenAPI spec (docs/ted-data-source.md "Useful fields"); **P** = plausible
(the API accepts eForms BT ids as field names per the verified spec, but
whether THIS BT is indexed/returnable is unverified) — the
`ted-search-fields-probe` workflow settles every P; **✗** = no known search
equivalent.

| Concept                     | Parser source (BT)             | Consumed by                                              | Search API field                                    | Status |
| --------------------------- | ------------------------------ | -------------------------------------------------------- | --------------------------------------------------- | ------ |
| Publication number          | efbc:NoticePublicationID       | notice identity, R2 key, versioning                      | `publication-number`                                | V      |
| Publication date            | efbc:PublicationDate           | windows, checkpoint, retention                           | `publication-date`                                  | V      |
| Notice XML link             | —                              | sourceUrl, UI "original notice" link, attribution        | `links` (also `links.html.*` for the UI)            | V      |
| Form type (BT-03 listName)  | cbc:NoticeTypeCode/@listName   | COMPETITION scoping                                      | `form-type` (query + retrievable)                   | V      |
| Notice type                 | cbc:NoticeTypeCode             | tender_notices.notice_type                               | `notice-type`                                       | V      |
| Notice subtype (OPP-070)    | efac:NoticeSubType             | recorded, not scored                                     | BT/alias unknown                                    | P      |
| eForms SDK version          | cbc:CustomizationID (OPT-002)  | source_snapshots.sdk_version, parser telemetry           | none known                                          | ✗ (P)  |
| Languages (BT-702)          | cbc:NoticeLanguageCode + add'l | `source_languages_json` → engine language gating         | `notice-language`? (unverified alias)               | P      |
| Buyer name (BT-500)         | OPT-300 org resolution         | buyers.name, UI                                          | `buyer-name` (multilingual object)                  | V      |
| Buyer country (BT-514)      | resolved Company               | buyers.country_code → engine countries                   | `buyer-country`                                     | V      |
| Buyer legal type (BT-11)    | ContractingPartyType           | `LotInput.buyerLegalType` (buyer-type component)         | BT-11 / alias unknown                               | P      |
| Buyer org id (ORG-xxxx)     | OPT-300                        | buyers.source_buyer_id (dedupe key)                      | none known                                          | ✗      |
| Procedure type (BT-105)     | cbc:ProcedureCode              | `LotInput.procedureType`, risk context                   | `procedure-type`                                    | V      |
| Contract nature (BT-23)     | procedure + per-lot            | exclusions + nature component                            | `contract-nature` (lot-level alignment unknown)     | V/P    |
| Procedure est. value+cur    | BT-27-Procedure                | `divideValueAcrossLots` (`value_is_derived`)             | BT-27-Procedure / alias unknown                     | P      |
| **Lot ID (BT-137-Lot)**     | ProcurementProjectLot/cbc:ID   | tender_lots.lot_number, lot identity                     | BT-137-Lot / alias unknown                          | P      |
| **Lot title (BT-21-Lot)**   | per-lot Name (lang map)        | capability/keyword matching, UI                          | BT-21-Lot / `title-lot`? unknown                    | P      |
| **Lot descr (BT-24-Lot)**   | per-lot Description (lang map) | capability/keyword/risk-flag matching, UI                | BT-24-Lot / unknown; may be size-capped             | P      |
| **Lot CPV main/additional** | BT-262/263-Lot (fallback proc) | cpv component + scope; `LotCpv.main` mandatory           | `classification-cpv` is notice-level aggregate      | P      |
| **Lot NUTS (BT-5071)**      | per-lot RealizedLocation       | geography component, UI                                  | `place-of-performance` (aggregate? lot-aligned?)    | P      |
| **Lot value + currency**    | BT-27-Lot                      | value component (ECB conversion), UI                     | `estimated-value-lot`, `estimated-value-cur-lot`    | V\*    |
| **Lot deadline**            | BT-131(d)/(t)-Lot              | deadline component, retention, digest urgency            | `deadline-receipt-tender-date-lot` (+ time part?)   | V\*    |
| Correction/change info      | new publication + content hash | tender_notice_versions, match recompute                  | `onlyLatestVersions` request knob; change BTs (758) | P      |
| Raw XML                     | whole document                 | ADR-0005 R2 snapshot, reprocessing, ingestion_errors ref | **not retrievable via search**                      | ✗      |

\* alias verified to EXIST; the returned SHAPE (array-per-lot? aligned
across fields? date+time or date only?) is unverified.

Hard truths from the inventory:

- **No search field yields the raw XML** — Option A abandons the XML
  artifact entirely; that is an ADR-0005 conflict, not a detail.
- **Everything the matching engine scores is lot-level** (`LotInput`), and
  our model is lot-centric (`tender_lots` + per-lot cpv/geo rows). Option A
  stands or falls on whether lot-level fields come back as per-lot values
  with reliable cross-field alignment (title[i] ↔ value[i] ↔ deadline[i] ↔
  lot-id[i]). This is THE crux and it is currently UNVERIFIED.
- eForms SDK version and buyer org id have no known search equivalent —
  Option A would store them as explicitly unknown (never fabricated),
  degrading buyer dedupe to name+country.

## 3. Option A — Search API `fields` as the content channel

Mechanics: extend `SEARCH_FIELDS` from 3 fields to the full inventory above;
map rows into the `NormalizedNotice`/`NormalizedLot` shape via a new
row-mapper (sibling of `extractSearchRow`), bypassing `parseEformsNotice`.

### Verified

- Endpoint, anonymity, `fields` accepting BT ids and kebab aliases, caps
  (250/page, `len(fields) × limit ≤ 10,000`), ITERATION pagination,
  `onlyLatestVersions`, multilingual fields as ISO 639-2-keyed objects —
  all verified 2026-08-14 against the OpenAPI spec (docs/ted-data-source.md).
- Aliases for lot value/currency/deadline EXIST (`estimated-value-lot`,
  `estimated-value-cur-lot`, `deadline-receipt-tender-date-lot`).
- The Search API kept working throughout the render outage (staging runs,
  probe runs) — the two surfaces fail independently.

### Inferred / unverified (probe: `ted-search-fields-probe.yml`)

1. Whether each **P** row above is an accepted, returnable field.
2. **Lot alignment**: whether multi-lot notices return per-lot arrays whose
   indexes correspond across fields, and whether a lot-id field exists to
   key them. Public reuser discussion states the Search API "is based on
   the notice, not the data of the notice", making lot-level
   reconstruction hard (op.europa.eu TED-reusers Q&A, via web search —
   could not fetch the page from the sandbox). If alignment is absent,
   Option A can only produce NOTICE-level records — a schema-visible
   degradation of the lot-centric model.
3. Whether BT-24 description text is returned in full or truncated (the
   field/limit cap suggests large text fields may be capped).
4. Deadline granularity (date-only vs date+time; our parser records
   end-of-day interpretation warnings — a date-only search value forces
   that interpretation on every lot).
5. Correction semantics: how a corrigendum appears in search rows
   (new publication-number? version field? `onlyLatestVersions` behavior),
   and whether the changed content is diffable without XML.

### Budget arithmetic (at our volumes)

Realistic full field set ≈ 28–32 fields. `32 × limit ≤ 10,000` → limit
≤ 312, so the 250/page cap still governs: **one page still covers 250
notices**; at the projected 150–300 in-scope notices/day this is 1–2 search
requests/day — actually FEWER TED requests than today (no per-notice XML
fetches, no render-retry visits). Request budget and rate-limit posture
improve.

### Impact

- **ADR-0005 (breaks)**: no XML → no raw snapshot as specified. The duty
  (reprocess-after-fix, misparse debugging, malformed-record payload
  retention) could be partially met by snapshotting the raw search-row JSON
  per notice version (deterministic key, hash over canonicalized JSON), but
  that is a materially weaker artifact: it only contains the fields we
  asked for, so "reprocess after fix" cannot recover a field we failed to
  request. Requires a superseding/amending ADR, schema change to
  `source_snapshots` semantics, and a fixture-strategy change (contract
  tests would need real search-response fixtures alongside the XML ones).
- **ADR-0003 (compatible)**: scope query, windows, checkpoints, retention
  unchanged.
- **Cost model (improves)**: fewer requests, smaller snapshots.
- **Data quality (risks)**: lot fidelity (crux), lost SDK-version
  provenance, weaker buyer dedupe, possible description truncation,
  date-only deadlines. `no-lots`/`missing main CPV` error semantics need
  re-deriving from row shapes.

Effort: moderate (row-mapper + tests + snapshot/provenance rework + ADR).
Risk: **unknown until probed**; binary on lot alignment.

## 4. Option B — TED bulk XML daily packages

TED publishes anonymous daily/monthly bulk packages of all OJ S notices in
XML (referenced at ted.europa.eu/en/simap/xml-bulk-download — page is
egress-blocked from the sandbox; content per web-search snippets of that
page, so treat details as INFERRED).

### Believed shape (all INFERRED — probe: `ted-bulk-download-probe.yml`)

- URL pattern: `https://ted.europa.eu/packages/notice/daily/{yyyynnnnn}`
  where `nnnnn` is the OJ S issue number (one issue per publication day,
  working days only; ~250/year). Monthly packages also exist. Historical
  pattern was `.../xml-packages/daily-packages/YYYY/MM/YYYYMMDD_YYYYNNN.tar.gz`.
- Archive format: tar.gz containing one XML per notice; **notices are
  published in the format submitted** — eForms notices as eForms UBL, i.e.
  the exact documents `parseEformsNotice` already handles, alongside legacy
  TED-schema notices we would skip. Anonymous, no sign-in.
- Size: TED publishes thousands of notices per publication day across all
  sectors; at 30–300 KB raw per eForms notice the daily archive is
  plausibly ~30–150 MB compressed / several hundred MB uncompressed.
  NOT verified — the probe HEADs/GETs a real package and reports
  Content-Length, format, entry count and a sanitized eForms sample.
- Cadence: package available on/after the publication day; maps 1:1 onto
  our publication-date windows (weekend windows would simply have no
  package — same as "no notices published").

### Fit with the current pipeline

The natural design is a **hybrid**: keep the Search API exactly as today
for scoping (CPV/COMPETITION query → in-scope publication-number set per
window, authoritative publication metadata), and replace the per-notice
render fetch with per-notice extraction from that day's package. Then:

- `parseEformsNotice`, all fixtures, lot modelling, versioning
  (content-hash based), `ingestion_errors`, and ADR-0005 snapshots are
  **unchanged** — the package yields the same XML the front-end used to.
- The window/checkpoint model is untouched: one package per
  publication-date window.

### Workers constraints (honest)

A multi-hundred-MB archive cannot be buffered or fully processed in one
worker invocation (128 MB memory; cron invocation wall-clock ≤ 15 min;
bounded CPU). tar.gz is not seekable, so per-notice HTTP range extraction
is impossible. Required sketch:

1. **R2 staging**: cron streams the package HTTP response body directly
   into R2 (fixed-length put using upstream Content-Length, or multipart
   for unknown length) — pure streaming, memory-bounded.
2. **Chunked extraction**: a queue consumer streams the R2 object through
   `DecompressionStream('gzip')` + an incremental tar reader, keeps only
   entries whose notice id is in the window's in-scope set, writes each
   directly to its ADR-0005 snapshot key, and enqueues the existing
   parse/persist path. Resume-after-limit means re-streaming from the start
   and skipping already-snapshotted ids (idempotent via
   `insertSnapshotIfNewHash`) — wasteful but correct and bounded.
3. If the probe shows the daily package is small (≤ ~50 MB compressed),
   a single invocation may handle it without step 2's resume machinery —
   the probe's size numbers decide how much of this we must build.

An incremental tar-stream reader for Workers is the main new engineering
artifact (no dependency currently in the repo; must be small, streaming,
and tested against a real package fixture).

### Impact

- **ADR-0005 (preserved, strengthened)**: real raw XML snapshots return;
  add package id + retrieval metadata to provenance. Transient staged
  archives in R2 (delete after processing; keep N days for replay) add
  negligible storage.
- **ADR-0003 (compatible)**: scope still enforced via the search query;
  the package is filtered against it, never bulk-ingested.
- **ADR-0006 pressure**: chunked extraction with resume is exactly the
  shape Workflows exist for; queues+cron can do it (sketch above) but the
  ADR may deserve a re-examination note, not necessarily a reversal.
- **Cost model (fine)**: one archive download/day; R2 within free tier;
  request count to TED drops to ~2 search pages + 1 package per day.
- **Licence/attribution (unchanged/better)**: same Decision 2011/833/EU
  reuse terms (docs/ted-data-source.md); bulk download is the channel TED
  itself points reusers at for volume access — we stop depending on an
  undocumented website-rendering behavior.

Effort: moderate-to-high (streaming tar reader, staging, resume, date→OJ-S
issue-number mapping — the probe checks whether an issue-number field or a
date-addressed URL exists). Risk: engineering risk is in-house and
testable; upstream risk is LOW (bulk download is an official, documented,
long-standing reuser channel).

## 5. Option C — wait for the render channel to recover

What recovery requires: TED's website render queue resuming completion for
anonymous clients — entirely outside our control, on an **undocumented,
unsupported** surface that has now changed behavior twice in one week
(2026-08-16 "identifying client" episode; 2026-08-18 async rendering;
2026-08-20 total non-completion).

Detection: the existing daily fetch-retry drain
(`packages/procurement/src/fetch-retry-drain.ts`) re-attempts every
render-exhausted notice with a fresh visit budget, so **mechanically, the
drain suffices**: the moment TED recovers, backlogged notices flow through
with no code change, and `notices_render_pending` returning to ~0 in run
rows is the recovery signal. Adding a tiny scheduled single-notice canary
(reuse `ted-render-batch-probe` with a 1-notice batch) would give a
faster, TED-side-only signal and a latency time series.

Why it does not suffice as a plan: the outage is unbounded; every day of
waiting is a day of lots whose deadlines burn down unseen — directly
against the product promise. Notices are currently ingested as
metadata-only skips (no lots, no matches, no digests). Option C is
acceptable only as a passive canary running ALONGSIDE A or B, and as the
trigger for eventually retiring whichever workaround we ship if the
front-end becomes reliable again (it should still not be trusted as the
sole channel after this week).

Effort: nil. Risk: unbounded product outage. ADR impact: none, which is
the problem.

## 6. Recommendation (evidence supplier's view — architect decides)

**Primary: Option B (hybrid — Search API for scope/ids, daily bulk package
as the XML source), contingent on the bulk probe confirming URL pattern,
eForms content, and a Workers-feasible size.** Reasoning: it is the only
option that restores content while preserving the parser, the lot-centric
model, contract fixtures, versioning, and ADR-0005's raw-XML duties
unchanged — and it moves us from an undocumented website behavior to an
official reuser channel. Its risks are engineering risks we can test.

**Option A is the interim degraded mode, and only that** — worth shipping
quickly ONLY if the fields probe shows reliable lot alignment; if it does
not, A is limited to notice-level records and should at most backfill
metadata (deadline/value/CPV at notice level) so digests aren't blind while
B is built. A's silent obligations (ADR-0005 supersession, provenance loss)
make it the wrong end-state even in the best probe outcome.

**Option C**: keep the drain + add the 1-notice canary; never the plan.

Sequencing: dispatch both probes now (CI has egress); their outputs are the
missing VERIFIED rows for the architect's ADR.

## 7. Probes authored with this doc

- `.github/workflows/ted-search-fields-probe.yml` — Option A: per-field
  acceptance sweep over the candidate alias/BT list, then a combined
  full-field request over one real window (bounded, sanitized structural
  dump), targeting multi-lot notices to answer the alignment question, plus
  a correction-behavior check via `onlyLatestVersions`.
- `.github/workflows/ted-bulk-download-probe.yml` — Option B: locates the
  current daily-package URL pattern (issue-number scan around the expected
  range plus alternate URL shapes), reports status/Content-Length/type,
  optionally downloads one package (size-capped), lists archive entries,
  and prints a sanitized eForms sample (CustomizationID line) to confirm
  the content matches what `parseEformsNotice` already handles.

Both follow the existing probe patterns (`ted-api-probe.yml`,
`ted-render-batch-probe.yml`): `workflow_dispatch` only, input validation,
read-only permissions, identifying User-Agent, polite spacing, bounded and
sanitized output, no secrets echoed.
