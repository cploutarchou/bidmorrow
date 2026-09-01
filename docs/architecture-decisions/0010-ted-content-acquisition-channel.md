# ADR-0010: TED content-acquisition channel after the render outage (bulk packages primary; Search-API fields as gated interim)

Status: Proposed (2026-08-20) — coordinator/owner flips to Accepted. The
decision is a **two-branch rule whose selection is gated on evidence**:
everything in both branches is fully specified now; §2's gate picks which
branch activates. **THE GATE IS CLOSED: Branch B is ACTIVATED**
(`ted-package-probe`, run 32352483245, 2026-08-20 09:10 UTC —
`https://ted.europa.eu/packages/daily/202600157` returns HTTP 200,
`application/gzip`, 19,980,923 bytes of tarred eForms XML, while garbage
ids return 400; see §2). Branch A′ (§4) is retained as the documented
contingency should the bulk channel regress, with its A-G1 populate
rates now measured. **§5's four branch-independent decisions remain
final and ship regardless**; §5.2 stopped the abandonment clock while
the channel question was open and its removal is now a Branch B
implementation decision, not an open question. Companion to ADR-0009 (whose
§5 contingency framing this ADR resolves — ADR-0009 §5 now points
here). Supersedes ADR-0005's raw-XML snapshot requirement ONLY under
Branch A′, with the explicit scope in §4; under Branch B, ADR-0005 is
preserved unchanged.

## Context

TED's anonymous notice-XML render pipeline completes no renders as of
2026-08-20 (ADR-0009 §3; probe 32337551926; staging run 0/156). It is the
only V1 content channel, and there is no authenticated XML endpoint
(verified 2026-08-18, docs/ted-data-source.md). ADR-0009 §5 framed two
candidate channels and dispatched the evidence work; the ted-data
investigation delivered docs/ted-content-channel-options.md (field
inventory, option mechanics, probe designs) and two probe runs whose
results this ADR consumes. The Search API itself remained healthy through
the entire outage — the two surfaces fail independently.

### Option A evidence (Search API `fields`) — run 32343241481, window 2026-08-17

VERIFIED:

- **The lot-alignment crux — the make-or-break question from the field
  inventory — is answered favorably.** Lot-scoped fields return as
  parallel arrays and `BT-137-Lot` carries the lot identifier (values
  like `"LOT-0001"`). Per-notice array lengths agree across lot-scoped
  fields: 566482-2026 has `main-classification-lot`=6, `BT-137-Lot`=6,
  `BT-5071-Lot`=6, `BT-262-Lot`=6; 566463-2026 is 3/3/3/3; 566567-2026
  3/3/3; 566372-2026 2/2/2; most notices 1/1/1/1. Per-lot
  title/description/main-CPV can therefore be reconstructed by index
  against `BT-137-Lot`.
- **Caveat 1 — multi-valued sub-attributes do NOT share lot
  cardinality**: 566503-2026 has `BT-137-Lot`=1 but `BT-5071-Lot`=59;
  566599-2026 has 2 vs 18. `additional-classification-lot`/`BT-263-Lot`
  pair with each other at their own cardinality (21/21, 13/13, 9/9) but
  not with the lot count. NUTS/place and additional CPV are therefore
  **not attributable to a specific lot** from the flat arrays. (§4
  decides what our semantics become.)
- **Caveat 2 — `title-lot`/`description-lot`/`BT-21-Lot`/`BT-24-Lot`
  return as objects keyed by language** (e.g. `{"pol": ["…"]}`); sampled
  notices carried Polish only. Not a regression — the source XML is
  equally single-language — but the consequence for English keyword
  matching must be stated (§4).
- **Description is not truncated**: lengths up to 1,793 chars observed
  (1,554 / 1,424 / 1,377 / 1,331 …).
- **Versioning**: `onlyLatestVersions=true` → `totalNoticeCount` 145;
  `false` → 156, same query — 11 of 156 rows are superseded versions.
  Our window query currently omits the flag (and observed 156, so the
  effective default matches `false`).
- The API **400s on unsupported field names** (observed in the same run:
  "Parameter _fields_ contains unsupported value …") — acceptance of a
  field name is machine-checkable.

OPEN (inference, not measurement — must not be asserted):
`deadline-receipt-tender-date-lot`, `estimated-value-lot`,
`estimated-value-cur-lot` did **not appear** in the returned objects for
the sampled notices. Because the combined request returned 200 and the
API demonstrably 400s on unsupported names, the names are almost
certainly accepted and simply empty/absent for these notices — but that
is an inference. Deadline and value are two of the matching engine's most
important inputs; §4 gates Option A adoption on a populate-rate probe.

### Option B evidence (bulk packages) — run 32343243004 + corrected record

- The v1 "URL pattern FALSIFIED" verdict was **wrong** (v1 counted only
  HTTP 200 as a hit): run 32343243004 showed every
  `/packages/notice/daily/{id}` variant (issue ids, `20260817`,
  `2026-08-17`) and `/packages/notice/monthly/2026-08` answering **202**
  while `/packages/daily/…` answered 400 and `/packages/monthly/…` 404.
- That 202-routing was initially read as "the endpoint is real; v1
  simply never polled" — **an over-correction, itself downgraded
  same-day** (coordinator correction, 2026-08-20). The gate poll (run
  32345639589, 07:47–07:57 UTC, issue resolved to `157/2026` from `OJ`)
  polled four id encodings (`202600157`, `2026157`, `157-2026`,
  `2026-157`) at trigger/+60/+120/+180/+240 s: **every response was 202,
  0 bytes, `content-type: text/html; charset=UTF-8`** — no package
  delivered. The `text/html` content-type undercuts the endpoint
  inference: a package/file endpoint would not advertise HTML, and these
  responses are equally consistent with TED's website returning a
  generic async shell for ANY unrecognized path under
  `/packages/notice/*` (the 400/404 differences then merely reflect
  route prefixes). Honest state: **the daily-package endpoint's
  existence and address are UNPROVEN** — not "real but slow".
- The Search API exposes an **`OJ` field** giving the authoritative
  gazette issue — `"157/2026"` for 2026-08-17. (v1 had guessed issue 163
  from a weekday count — a live demonstration of why date→issue mapping
  must come from the API, never from calendar arithmetic.) This datum is
  VERIFIED independently of the endpoint question.
- **PENDING — the gate**: two instruments now close it. (i) A scheduled
  longer-horizon re-poll of the already-triggered candidates (§2's
  third-outcome rule — run 32345639589 landed exactly in that case).
  (ii) `ted-source-facts-probe` (committed 4b386a6, dispatching):
  fetches TED's OWN bulk-download page (`/en/simap/xml-bulk-download`,
  release calendar, data.europa.eu) and extracts the actual href links —
  ending pattern-guessing — and A/B tests a real issue id against
  deliberately garbage ids (`definitely-not-an-issue`, `00000000`); if
  garbage answers identically, catch-all shell is proven and the
  inferred address is dead. The same probe also measures the §4 gate
  A-G1 populate rates (`deadline-receipt-tender-date-lot`,
  `estimated-value-lot`, `estimated-value-cur-lot`, plus `BT-131-Lot`,
  `BT-27-Lot`) across the whole 2026-08-17 window.

#### Source-facts probe result (run 32347877913, 2026-08-20 08:15 UTC)

Three answers, all from TED's own responses:

1. **The inferred address is DEAD — proven, not inferred.** The A/B came
   back identical for all three ids: `202600157` (real),
   `definitely-not-an-issue` and `00000000` each answered
   `202, 0 bytes, content-type: text/html; charset=UTF-8`. A path that
   answers a real issue exactly as it answers garbage is not addressing
   the issue. `/packages/notice/daily/{id}` is a catch-all shell and is
   struck from this ADR as a candidate; every earlier poll against it
   measured nothing.
2. **The REAL address is published by TED and has no `/notice/` segment.**
   `https://ted.europa.eu/en/simap/xml-bulk-download` returned HTTP 200
   (191,772 bytes) and lists absolute hrefs:
   `https://ted.europa.eu/packages/daily/{ojIssueId}` for issues
   `202600147`–`202600160`, and `https://ted.europa.eu/packages/monthly/{year}-{n}`
   (e.g. `2026-1`). The `OJ` field's `157/2026` maps to `202600157` —
   present in the published list, so the id encoding is confirmed by the
   source rather than guessed. Note `/packages/daily/…` is the prefix
   that answered **400** in run 32343243004 — i.e. the earlier probe read
   the real family's rejection of a malformed id as evidence against the
   family. (`/en/release-calendar` itself answered 202 — the same async
   shell — and `data.europa.eu/data/datasets?query=TED` returned a
   1,599-byte JS-rendered page with no hrefs; neither adds anything.)
3. **A-G1 is NOT yet measured.** The populate-rate request returned
   **HTTP 400 — "Parameter 'fields' contains unsupported value"**, so at
   least one of the six requested names is not a valid `fields` value and
   the whole request was rejected. No populate rate can be read from this
   run; the previous "accepted-but-empty" inference is therefore also
   unsupported. The error body enumerates every supported value, which is
   the authoritative name list.

**Gate status: still OPEN, but the question has changed.** It is no
longer "does an unknown address exist" — it is "does the _published_
address deliver bytes". `ted-package-probe` (this commit) HEADs and GETs
`https://ted.europa.eu/packages/daily/{issue}` with the same garbage-id
A/B discipline, checks `content-type`/`content-disposition`/magic bytes
and attempts an archive listing, and closes A-G1 by mining the API's own
supported-value enumeration and then measuring each field **separately**
so one bad name cannot 400 the whole measurement again.

**Standing rule, reaffirmed:** an address is never proven by
response-code routing alone. It is proven by delivering content that a
garbage id does not.

Constraints in force: modular monolith on Workers, fixed infra < $100/mo
(target $5–30), D1 10 GB with ≥40% 12-month headroom, ADR-0005 (R2 raw
snapshots), ADR-0003 (scope/retention), ADR-0006 (queues+cron, no
Workflows), source-agnostic `ProcurementSource` boundary, no paid
procurement datasets, 128 MB Worker memory / 15-min invocation ceiling
(docs/dependency-versions.md, verified 2026-08-14).

## Decision

### 1. End-state principle (branch-independent)

The render front-end is **permanently demoted**: an undocumented website
behavior that changed three times in one week (2026-08-16 client
sensitivity, 2026-08-18 async rendering, 2026-08-20 total
non-completion) is never again the sole content channel. Whatever branch
activates, a 1-notice scheduled canary (re-using `ted-render-batch-probe`)
tracks the render channel for recovery/latency telemetry only. The Search
API remains the scoping/enumeration surface in every branch — the
scope query, windows, checkpoints, and retention of ADR-0003 are
untouched by this ADR.

### 2. The branch gate

- **Branch B activates** when a completed daily package (HTTP 200 with
  archive content) is retrieved from a **proven** address — proven means
  either the longer-horizon re-poll delivering on an already-triggered
  candidate, or an address extracted from TED's own bulk-download page
  hrefs (`ted-source-facts-probe`) delivering. An address is never
  proven by response-code routing alone (the lesson of the downgraded
  "endpoint is real" inference).
- **Branch A′ activates** if the probes establish that no daily-package
  address exists or that no proven address ever completes — i.e. bulk
  packages are verifiably unavailable to us, whether because the async
  subsystem never completes or because the channel does not exist in the
  polled shape.
- **A 202-forever result within the ~10-minute probe horizon selects
  neither branch by itself.** A multi-hundred-MB archive may legitimately
  take longer than 10 minutes to generate; and a 202 `text/html` shell
  may equally mean the address is simply wrong. **Run 32345639589
  (2026-08-20 07:47–07:57 UTC) landed exactly in this case** — four id
  encodings for issue `157/2026`, all 202 / 0 bytes / `text/html` at
  every pass through +240 s — so the gate REMAINS OPEN, resolved by (i)
  the scheduled longer-horizon re-poll and (ii) the
  `ted-source-facts-probe` href-extraction + garbage-id A/B (which
  distinguishes "slow" from "wrong address" definitively). Branch B's
  ingestion design tolerates multi-hour generation regardless (trigger
  today, collect on a later cron — §3), so a slow-but-completing package
  pipeline still selects B.

#### GATE CLOSED — Branch B ACTIVATED (run 32352483245, 2026-08-20 09:10 UTC)

`ted-package-probe` fetched the address TED itself publishes. The
garbage-id A/B is decisive — the real issue and garbage ids do NOT behave
alike:

| URL                                       | status  | content-type       | bytes       | content-disposition                            |
| ----------------------------------------- | ------- | ------------------ | ----------- | ---------------------------------------------- |
| `/packages/daily/202600157`               | **200** | `application/gzip` | 19,980,923  | `attachment; filename=20260817_2026157.tar.gz` |
| `/packages/daily/definitely-not-an-issue` | 400     | `text/plain`       | 67          | —                                              |
| `/packages/daily/00000000`                | 400     | `text/plain`       | 32          | —                                              |
| `/packages/monthly/2026-1`                | **200** | `application/gzip` | 344,184,486 | `attachment; filename=2026-01.tar.gz`          |

The GET delivered the full 19,980,923 bytes in ~2 s, magic bytes
`1f 8b 08 00` (gzip), and `tar tzf` listed real member entries:

```
20260817_157/00566631_2026.xml
20260817_157/00567983_2026.xml
20260817_157/00568726_2026.xml
```

Uncompressed size ~207 MB (gzip trailer: 207,127,552). (`file -b` also
printed "encrypted … from FAT filesystem" — that is `file`(1) misreading
gzip flag bits on this stream; `tar tzf` succeeded, so it is an ordinary
gzip tarball.)

**This closes the gate in Branch B's favor and settles the acquisition
question: the bulk channel exists, is addressable, and delivers.** The
render outage stops being existential — it degrades to a telemetry
signal, exactly as §3 anticipated. Note also that the package delivered
IMMEDIATELY, with no async generation step at all, so §3's tolerance for
multi-hour generation is unused headroom rather than a requirement.

Two engineering facts this establishes for §3, both VERIFIED:

- **Member naming**: `{YYYYMMDD}_{issueNumber}/{documentNumber}_{year}.xml`
  — e.g. `20260817_157/00566631_2026.xml`. The directory uses the SHORT
  issue number (`157`), the URL path uses the LONG form (`202600157`),
  and the `content-disposition` filename uses a third form
  (`20260817_2026157`). Three encodings of one issue in a single
  response — none may be derived from another by assumption; the URL form
  comes from `OJ`, the member form is read from the archive.
- **Volume**: one day is ~20 MB compressed / ~207 MB uncompressed for ALL
  notices of that issue, of which our CPV scope is ~156. Selective
  extraction against search-derived ids is therefore mandatory, not an
  optimization — §3's streaming + R2 staging design stands, and the
  monthly package (344 MB compressed) is a backfill instrument only.

**OPEN — `publication-number` ↔ member-filename mapping.** The Search API
returns `publication-number`; archive members are named
`00566631_2026.xml`. The mapping looks obvious but has NOT been verified
against a real pair, and this ADR's own history is a record of what
assuming an obvious encoding costs. §3 implementation must confirm it
against actual data before relying on it.

### 3. Branch B — hybrid bulk-primary (adopt if packages complete)

The recommendation of docs/ted-content-channel-options.md §6, adopted:
Search API for scope/ids/metadata, the daily bulk package as the XML
source. **Parser (`parseEformsNotice`), lot model, contract fixtures,
content-hash versioning, `ingestion_errors` semantics, and ADR-0005 R2
snapshots are all unchanged** — the package yields the same eForms UBL
XML the front-end used to serve.

- **Addressing**: add `OJ` to `SEARCH_FIELDS` (verified field, §5). The
  window's search pass records the issue id for its publication date;
  the package URL uses ONLY the address the gate proved. The candidate
  is now `https://ted.europa.eu/packages/daily/{ojIssueId}` — an href
  published by TED's own bulk-download page (run 32347877913), NOT an
  inferred pattern — and it still must not be hard-coded until it is
  shown to deliver an archive. The `/packages/notice/daily/{id}` shape
  is DISPROVEN (catch-all shell) and must never be used. Date→issue mapping comes ONLY from
  the API's `OJ` value — never weekday arithmetic (the 163-vs-157 miss
  is the recorded reason).
- **Async acquisition**: the cron GETs the package URL; a 202 records a
  package-pending state and later runs re-poll — the render-pending
  machinery's shape at package granularity, but trivially cheap (one
  request per re-poll, one package per publication day). Bounded
  re-polls across runs with an alerting give-up (mirroring
  `NOTICE_FETCH_ABANDONED`'s "loud, never silent" rule); give-up
  constants set at implementation from the probe's measured completion
  latency.
- **R2 staging**: stream the package HTTP body directly into R2
  (streaming/multipart put — pure streaming, memory-bounded; the exact
  R2 put API surface must be re-verified against current Cloudflare docs
  at implementation time per verify-current-docs). Staged archives are
  transient: deleted after successful extraction, retained ≤7 days for
  replay.
- **Chunked extraction (queue consumer)**: stream the R2 object through
  gzip decompression plus an incremental tar reader, keep only entries
  whose notice id is in the window's in-scope publication-number set,
  write each XML directly to its ADR-0005 snapshot key, and feed the
  existing parse/persist path. Resume-after-limit re-streams from the
  start and skips already-snapshotted ids — **idempotent via
  `insertSnapshotIfNewHash`**, wasteful but correct and bounded. If the
  probe shows daily packages small enough for one invocation, the resume
  machinery is still built (ceiling days and monthly replays need it),
  but the common path is single-pass. (`DecompressionStream` availability
  and limits in the Workers runtime: verify against official docs at
  implementation time — treated as unverified here.)
- **The tar reader is the one new engineering artifact.** Preference
  (dependency rule, cost model "deliberately avoided"): a small in-house
  streaming tar-entry reader (the format is a stable 512-byte-header
  archive; we need read-only, sequential access), tested against a real
  package fixture — over importing a Node-ecosystem tar dependency of
  unknown Workers compatibility. Final call at implementation with the
  fixture in hand; either way it must be streaming and bounded-memory.
- **Stranded retry rows are harvested from packages, not HTTP.** Retry
  rows carry `source_notice_id` + `publication_date`: when a day's
  package is extracted, pending retry rows for that `publication_date`
  whose `source_notice_id` matches an extracted entry are fed through the
  same `processOneNotice` path (XML sourced from the R2 snapshot instead
  of an HTTP fetch) and marked `recovered`. The current 32 stranded rows
  (window 2026-08-17, issue 157/2026) resolve with that one package.
  Retry rows whose notice is absent from its day's package follow the
  existing attempts/abandonment path — absence from the official gazette
  archive is a real, per-notice signal, unlike a render 202.
- **ADR impact**: ADR-0005 preserved and strengthened (provenance gains
  package id + OJ issue). ADR-0006 gets a re-examination _note_ — the
  resume-capable extraction is the shape Workflows exist for, but the
  queues+cron sketch above meets it; no reversal. ADR-0003 untouched.
- **Cost/size (cost-audit)**: TED requests drop to ~2 search pages + 1
  package GET (plus bounded re-polls) per day — far below today's
  ~350–800 and the 2,000 budget; politeness posture improves. R2:
  staged archives at the INFERRED ~30–150 MB/day compressed × ≤7-day
  retention ≈ ≤1 GB transient, on top of the existing ~2–6 GB snapshot
  steady state — within docs/cost-model.md's existing $0 R2 posture
  (re-verify the free-tier ceiling at implementation if the probe
  measures larger packages; archive size is INFERRED until the probe
  reports Content-Length). **12-month D1 projection** (ground rule): one
  package-state row per publication day (~260/year × ~200 B ≈ **52
  KB/year**) — negligible; notice/lot storage unchanged from ADR-0003's
  model. No new paid component; totals stay ~$6 / ~$26.

### 4. Branch A′ — Search-API fields as gated interim (adopt if packages never complete)

If the longer-horizon poll confirms packages never complete, the correct
diagnosis is that **TED's entire async document-generation subsystem is
down** — websites-render and package-generation alike — which is a
cleaner statement than "the render endpoint changed" and strengthens the
expectation of eventual upstream recovery (TED's official bulk reuser
channel cannot stay down indefinitely). Option A then ships as the
**interim degraded mode — never the end-state** (its provenance losses
below are why), retired in favor of Branch B whenever packages return.

**Adoption gate A-G1 (blocking, before any Option A code ships)**: a
targeted probe measuring the populate-rate of
`deadline-receipt-tender-date-lot`, `estimated-value-lot`,
`estimated-value-cur-lot` across a full window (plus acceptance of the
remaining P-status fields in the inventory: languages alias, BT-11 buyer
legal type, BT-27-Procedure, notice subtype), and deadline granularity
(date-only vs date+time). `ted-source-facts-probe` (committed 4b386a6)
carries this measurement (`BT-131-Lot`, `BT-27-Lot` included) across the
2026-08-17 window, so A-G1's data arrives with the gate evidence. Deadline and value are top matching inputs; if
their populate-rate is materially below the XML's, that fact goes into
the disclosure and the component weighting discussion — it does not get
discovered in production.

**A-G1 MEASURED (run 32352483245, window 2026-08-17, 156 in-scope
notices, `onlyLatestVersions: false`).** Field names were first mined
from the API's own supported-value enumeration (47,988 bytes, returned in
the 400 body for a deliberately invalid field) rather than guessed — the
previous attempt rejected the whole request on one bad name.

| field                              | populated | rate           | sample                     |
| ---------------------------------- | --------- | -------------- | -------------------------- |
| `BT-137-Lot` (lot id)              | 156/156   | **100%**       | `["LOT-0001"]`             |
| `deadline-receipt-tender-date-lot` | 130/156   | **83.3%**      | `["2026-09-14+02:00"]`     |
| `estimated-value-lot`              | 57/156    | **36.5%**      | `["200000.00"]`            |
| `estimated-value-cur-lot`          | 57/156    | **36.5%**      | `["EUR"]`                  |
| `BT-27-Lot`                        | 57/156    | **36.5%**      | `["200000.00"]`            |
| `BT-131-Lot`                       | —         | REJECTED (400) | not a valid `fields` value |

Three findings:

1. **`BT-131-Lot` does not exist as a `fields` value.** The enumeration
   splits it by date and time: `BT-131(d)-Lot` and `BT-131(t)-Lot` (also
   `BT-1311(d)/(t)-Lot`). This matches docs/ted-data-source.md's field
   map, which already recorded `BT-131(d)/(t)-Lot` — the probe used the
   wrong name, not the API. Any Option A code uses the parenthesised
   names.
2. **`BT-27-Lot` and `estimated-value-lot` are the same datum** — identical
   count and identical sample. The kebab alias and the BT id are
   interchangeable here.
3. **Contract value is present on barely a third of in-scope notices
   (36.5%).** Deadline is comfortable at 83.3%; lot identity is perfect at
   100% (which also re-confirms the lot-alignment answer). Value at 36.5%
   is a material weakness for Branch A′ specifically: value is a top
   matching input, and a channel that carries it for ~1 in 3 notices
   would force either a large "value unknown" population or a reweighting.

**This does not block anything now** — Branch B is activated (§2) and
supplies full XML, so A-G1's role is reduced to characterising the
fallback. It is recorded because Branch A′ remains the contingency if the
bulk channel ever regresses, and because of an unresolved question it
raises: **whether the Search API's 36.5% reflects the XML's own populate
rate or an index that under-populates relative to source.** Branch B
makes that answerable — once packages are parsed, compare BT-27 presence
in the XML against the search index for the same window. Until that
comparison exists, the 36.5% figure characterises THE SEARCH INDEX, not
TED's data.

Design (per the favorable alignment evidence):

- **Row-mapper** (sibling of `extractSearchRow`) maps the full field set
  into the existing `NormalizedNotice`/`NormalizedLot` shape, bypassing
  `parseEformsNotice`. Per-lot title, description, and main CPV are
  reconstructed by index against `BT-137-Lot` — justified by the
  verified cross-field length agreement (6/6/6/6, 3/3/3/3, 2/2/2,
  1/1/1/1). A per-notice cardinality check guards it: if any
  lot-aligned field's length disagrees with `BT-137-Lot`'s, the notice
  is recorded to `ingestion_errors` (new stable code, e.g.
  `LOT_ALIGNMENT_MISMATCH`) rather than mis-attributed — never silently
  swallowed.
- **Lot geography and additional CPV become notice-level facts** (the
  Caveat-1 decision): `BT-5071-Lot`/place values and
  `additional-classification-lot` values are attributed to **every lot
  of the notice**, flagged as notice-level-derived (same honesty
  mechanism as `value_is_derived`). The matching geography component's
  semantics degrade from "this lot is performed in X" to "this notice
  involves X" — conservative (over-inclusive, never fabricating per-lot
  precision), surfaced in the match explanation and UI copy. This is a
  schema-visible, documented degradation, not a silent one.
- **Language** (Caveat 2): single-language notices are single-language
  in the XML too — no regression — but the consequence is stated
  plainly: a Polish-only notice is matchable by English keywords neither
  today nor under Option A; the engine's existing language gating
  (`source_languages_json`) continues to govern, fed from the languages
  alias once A-G1 verifies it.
- **Known losses, stored as explicitly unknown, never fabricated**:
  eForms SDK version (no search equivalent) and buyer org id — buyer
  dedupe degrades to name+country for interim-ingested notices
  (documented in docs/data-model.md at implementation).
- **ADR-0005 supersession (scoped to this branch only)**: the snapshot
  artifact becomes the **canonicalized JSON of the notice's search row**
  (deterministic serialization; content-hash over it; same R2 keying and
  `insertSnapshotIfNewHash` idempotency). Recorded limitation:
  reprocess-after-fix can never recover a field we did not request —
  mitigated by requesting the full inventory superset from day one, and
  bounded by the interim's lifespan. The versioning model is unchanged:
  content-hash over the canonical row detects corrections exactly as it
  did over XML.
- **Cost/size (cost-audit)**: 1–2 search requests/day total (28–32
  fields × 250/page stays under the verified
  `len(fields) × limit ≤ 10,000` cap) — fewer TED requests than any
  other design considered. Snapshots shrink (JSON rows ≪ XML).
  **12-month D1 projection**: notice/lot row footprint is the same
  normalized shape as today (bounded by the same fields), ≈ ADR-0003's
  2.2 GB/year worst case unchanged; no new table. No new component;
  totals stay ~$6 / ~$26.

### 5. Branch-independent decisions (final now, regardless of the gate)

**These four decisions SHIP NOW, ahead of gate closure — explicitly
agreed with the coordinator (2026-08-20).** None depends on which branch
activates, and §5.2 is time-critical: the attempt-burning suspension is
what stops the ~10-day abandonment clock against the 32 stranded notices
while the channel question is still open. Holding them hostage to the
gate would spend real notices to buy nothing.

1. **`onlyLatestVersions: false`, set explicitly** in the window search
   request (today it is implicit). Our version model wants every
   published version: corrections are new publications, content-hash
   dedupes unchanged content, `tender_notice_versions` never overwrites
   history, and recompute triggers on new versions. The observed default
   already behaves this way (156 rows), but relying on an unpinned
   upstream default for version completeness is fragile — pin it. (If
   the default ever flipped, we would silently lose 11/156 ≈ 7% of rows
   — superseded versions — and the version history they carry.)
2. **Suspend retry attempt-burning during a confirmed upstream outage.**
   The ADR-0009-flagged question, now decided — the clock is running
   against the 32 stranded notices regardless of which branch wins. A
   new `feature_flags` entry `fetch_retry_attempts_suspended`
   (operator-set; this passes ADR-0008 §2's "runtime lever" test the
   same way `ingestion_paused` does — outage confirmation is a human
   judgment fed by `RENDER_PENDING_DEGRADED` alerts, not an algorithm).
   While set, the drain processes only a small canary subset (first 3
   due rows) per run and does **not** increment `attempts` on
   `NOTICE_RENDER_PENDING` outcomes — recovery detection is preserved
   (~≤18 requests/day) while the ~10-day abandonment clock stops running
   against notices that were never our failure. Genuine
   `TedRequestError` outcomes still increment (they are per-notice
   evidence, outage or not). Clearing the flag restores full drain
   behavior. Ships with the ADR-0009 implementation.
3. **Add `OJ` to `SEARCH_FIELDS`** now (verified field; costless; needed
   by Branch B and useful provenance under either branch).
4. §1's render-channel demotion and canary posture.

#### §5 IMPLEMENTED — 2026-08-21

All four ship in one change; gates green (format, lint, typecheck, 530 +
217 + 63 tests, build).

| §   | What landed                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1 | `onlyLatestVersions` added to `TedSearchRequest` and pinned `false` on the window search (`run-window.ts`). Previously implicit.                                                                           |
| 5.2 | `fetch_retry_attempts_suspended` flag (`packages/config`), reader `isFetchRetryAttemptsSuspended` (`scope.ts`), drain honors it (`fetch-retry-drain.ts`), admin validator case. 4 new D1 tests (S-1..S-4). |
| 5.3 | `OJ` added to `SEARCH_FIELDS`. Cap re-checked: 4 × 250 = 1,000 ≤ 10,000.                                                                                                                                   |
| 5.4 | `.github/workflows/ted-render-canary.yml` — 1-notice daily canary, 11:00 UTC, telemetry-only (never fails on a pending render; `::notice` on recovery).                                                    |

**§5.2 semantics as built.** While the flag is set the drain pulls only
`FETCH_RETRY_SUSPENDED_CANARY_ROWS` (3) due rows and a render-pending
cycle exhaustion leaves BOTH `attempts` and `next_attempt_at` untouched —
so the row stays due and is re-probed rather than being pushed a day out
by a failure that was never its own. `TedRequestError` outcomes burn
normally. Upper bound 3 × `MAX_RENDER_VISITS` (6) = 18 requests/day,
matching §5.2's estimate. `DrainFetchRetriesResult.attemptsSuspended`
surfaces the posture to the caller and the completion log.

**§5.4 boundary — deliberately partial.** The canary is the shippable
half of §1. The code-side demotion is NOT done: `processOneNotice` still
fetches notice XML through the render front-end, because that is still
the only implemented content path. Removing it before Branch B exists
would leave ingestion with no content channel at all. The switch belongs
to the Branch B implementation, not here.

**Unverified.** The canary workflow has never executed — a
`workflow_dispatch` workflow is only dispatchable once it is on the
default branch. First scheduled run is the first evidence.

#### PREREQUISITE CLOSED — member addressing CONFIRMED (run 32522822931)

The last open item in this ADR is answered. Window 2026-08-17:

| Link               | Value                                                                |
| ------------------ | -------------------------------------------------------------------- |
| window → OJ issue  | `157/2026` (single distinct `OJ` across all 156)                     |
| OJ issue → package | `/packages/daily/202600157` → 200, `application/gzip`                |
| archive            | 19,980,923 B gz → 207,127,552 B, 3,190 members                       |
| member             | `20260817_157/00566194_2026.xml` (ALL 3,190 uniform)                 |
| content proof      | `<efbc:NoticePublicationID schemeName="ojs-notice-id">00566194-2026` |

Q4a matched 20/20; Q4b's negative control returned 0 false positives, so
the hit rate is evidence rather than a loose-matcher artifact; Q5 proved
it by extracting the member and reading the id inside.

**Implementation requirements this pins down for §3:**

1. **Zero-pad to 8 digits.** Search returns `566194-2026`; the member
   filename and canonical in-XML id are `00566194-2026`. A direct string
   match between search row and member path FAILS. This is the detail
   most likely to be got wrong.
2. **Member paths are constructible without listing the archive** —
   `{YYYYMMDD}_{OJ-seq}/{padded}_{year}.xml`, both components already in
   the search row (`publication-date`, `OJ`).
3. **Selectivity 4.9%** (156 of 3,190; ~7.6 MB of interest inside 207 MB,
   a 20.4x reduction) — quantifies why §3 specifies selective extraction
   over whole-archive parsing.

**Probe weakness found and fixed.** Q5's original assertion was
`grep -q "$num"` — a bare substring search that would also pass on an
unrelated occurrence, making the automated verdict weaker than the
evidence it printed. (The 2026-08-21 CONFIRMED verdict is sound: the
canonical `efbc:NoticePublicationID` line was printed and read directly.)
Q5 now asserts on that element specifically and has a third WEAK outcome
for "number present but not as the canonical id".

#### §1 VINDICATED — the render channel is a short-TTL cache (2026-08-21)

The canary's first run returned 200 with 244,469 bytes in ~1s, which
looked like recovery. It was not. The follow-up batch probe (run
32520323517, window 2026-08-17 — deliberately the same window that
previously returned 0/156) measured the real behavior, times relative to
trigger completion:

| Batch  | absent            | AVAILABLE               | absent again |
| ------ | ----------------- | ----------------------- | ------------ |
| A (5)  | —                 | **+7..+67s** (3/5)      | by +132s     |
| B (50) | +60..+112s (0/50) | **+232..+310s** (47/50) | by +490s     |

Content APPEARS and then DISAPPEARS, independently in both batches.
`other=0` on every pass — no 4xx, no 5xx — so this is re-queueing, not
rate limiting. Render latency scales with batch size, consistent with the
serialized per-client capacity hypothesis.

**Nothing was ever "down".** This resolves the contradiction that shaped
ADR-0008/0009: the 2026-08-18 single-notice diagnostic saw a render
complete because it polled inside the window; the 2026-08-20 run saw
0/156 because a 156-notice cycle outlasts the content. A treadmill, not
an outage.

**§1's permanent demotion now rests on a mechanism, not a symptom.** The
original argument was "an undocumented behavior that changed three times
in one week is never again the sole content channel" — reasoning from
instability. The stronger form: collecting a full window through this
channel means winning a ~1-3 minute race per batch, with any slip losing
the content until re-triggered. Bulk packages are static files. Branch B
is not merely the safer choice; the render channel is structurally unfit
for the job.

The exact TTL is NOT measured — content was present at one poll and
absent at the next, bounding it above (~2 min for A, ~3 min for B)
without pinning it. Measuring it precisely is not worth the requests: no
decision depends on the exact number.

**Consequence for §5.2.** The `fetch_retry_attempts_suspended` flag is
better justified than when written. A render-pending outcome really is
evidence about TED's cache timing rather than about the notice, so
burning one of the notice's five attempts on it was always charging the
wrong account. _2026-09-01: the attempt budget is now six on an
hourly-geometric ladder, and the hourly standalone drain stands down
entirely while the flag is set — ADR-0008 Amendment §A5._

#### Branch B prerequisite — the mapping probe (2026-08-21)

`.github/workflows/ted-package-mapping-probe.yml` answers the one item
this ADR's gate-closure record deliberately left open: given a
`publication-number`, WHICH member of the daily package carries its XML.
Branch B's selective extraction has no design without it — a day's
package holds every notice EU-wide while our in-scope set is ~156, so
members must be addressed directly rather than the archive parsed whole.

The probe is built to the same discipline that resolved the gate: a
correspondence is proven by CONTENT, never by a filename that merely
looks right.

1. Q4a measures how many of our publication numbers appear in member
   names (anchored at a path boundary, leading zeros allowed).
2. Q4b is a NEGATIVE CONTROL — same-format ids that must not match. If
   they do, the matcher is loose and Q4a's hit rate is not evidence.
3. Q5 extracts a matched member and checks the publication-number
   INSIDE the XML. Only Q5 can return CONFIRMED.

A zero hit rate in Q4a is explicitly NOT a verdict: the anchored pattern
misses a scheme like `notice-568795.xml`, so the probe falls back to an
unanchored diagnostic that reports what it actually finds rather than
concluding the mapping is absent. Q1 also cross-checks the `OJ` values
TED reports for the window against the issue id being fetched — if those
disagree, the addressing scheme in §3 is wrong and Branch B needs
rethinking before implementation starts.

## Consequences

Positive:

- Either branch restores notice content through an official, documented
  or at least officially-shaped channel, ends the dependence on website
  render behavior, and REDUCES TED request volume (politeness improves
  in both branches).
- Branch B preserves the entire existing parse/persist/provenance stack;
  Branch A′ is explicitly interim with its degradations named, flagged
  in data, and disclosed — nothing silent.
- The 32 stranded notices have a concrete harvest path in both branches
  (package extraction by `source_notice_id`; or interim row-mapper
  ingestion), and the abandonment clock is stopped meanwhile (§5.2).
- `ProcurementSource` stays source-agnostic: both branches produce the
  same `NormalizedNotice`/`NormalizedLot` domain shape; the channel is
  an implementation detail behind the boundary.

Negative / accepted:

- Branch B carries the repo's first streaming-archive machinery (tar
  reader, staging, resume) — real engineering surface, mitigated by
  fixtures from the probe's actual package and by the idempotent-resume
  design; ADR-0006 gains a Workflows re-examination note.
- Branch A′ loses raw-XML provenance for interim-ingested notices
  (scoped ADR-0005 supersession), degrades lot geography/additional-CPV
  to notice level, weakens buyer dedupe, and cannot recover unrequested
  fields retroactively — all documented, all reasons it is interim-only.
- The gate adds one more waiting step; bounded by §2's explicit
  longer-horizon poll rule, after which one branch MUST be declared.
- Coverage disclosure (ADR-0009 §6 duty, unchanged owner): under B the
  stranded day lands when its package processes; under A′ it lands as
  degraded-provenance records; the phase-close disclosure pass reflects
  whichever activates.
- Test surface: date→issue mapping from `OJ`; package-pending state
  machine; extraction idempotency/resume (B); row-mapper reconstruction
  incl. the cardinality guard and `LOT_ALIGNMENT_MISMATCH`; notice-level
  geo/CPV flagging (A′); `onlyLatestVersions` pinning; suspended-drain
  canary behavior (attempts not burned on render-pending, still burned
  on genuine errors).

Cost-audit summary: no new platform service or paid dependency in either
branch; TED request volume falls in both; R2 transient staging (B) rides
the existing $0 R2 line with an implementation-time re-verify if the
probe measures large packages; D1 deltas are 52 KB/year (B) or ~0 (A′);
nothing moves any 0/10/100/1,000 column — totals remain ~$6 / ~$6 / ~$26
per docs/cost-model.md; nothing approaches the $60–80 band. Cost-model
gets its delta note when the gate closes and a branch activates (this
ADR is spec; the activating branch's implementation updates the model
with measured package sizes / field-set request sizes).

## Verified / inferred / open ledger

- VERIFIED (run 32343241481): lot-array alignment incl. `BT-137-Lot`
  ids and the length-agreement examples; the two caveats
  (sub-attribute cardinality, language-keyed objects); descriptions to
  1,793 chars untruncated; `onlyLatestVersions` 145-vs-156; 400 on
  unsupported field names.
- VERIFIED (runs 32343243004, 32345639589): the raw response behavior
  ONLY — `/packages/notice/daily/*` and `/packages/notice/monthly/*`
  answer 202 / 0 bytes / `content-type: text/html` (through +240 s of
  polling on four id encodings), while `/packages/daily/…` answers 400
  and `/packages/monthly/…` 404. The `OJ` field gives the authoritative
  gazette issue (`157/2026` for 2026-08-17).
- DOWNGRADED (2026-08-20, coordinator correction): the earlier reading
  of that routing as "the endpoint is real; it was simply never polled"
  was an over-correction. `text/html` on a would-be package endpoint is
  equally consistent with a catch-all async shell for any path under
  `/packages/notice/*`. The daily-package endpoint's **existence and
  address are UNPROVEN**.
- INFERRED (stated, not asserted): deadline/value field names are
  accepted-but-empty for sampled notices (from the 200 + the proven
  400-on-unsupported behavior); daily package size ~30–150 MB
  compressed; archive format tar.gz of per-notice XML in submitted
  (eForms UBL) format. All package-shape inferences are downstream of
  the UNPROVEN address above.
- OPEN (all carried by the scheduled longer-horizon re-poll +
  `ted-source-facts-probe`, 4b386a6): whether a daily-package address
  exists at all (href extraction from TED's own bulk-download page;
  garbage-id A/B — identical answers for garbage ids prove catch-all
  shell); whether a proven address ever completes (the §2 gate);
  deadline/value populate-rate and granularity (A-G1, same probe);
  remaining P-status field aliases; Workers runtime surfaces
  (`DecompressionStream`, streaming R2 put) — verify-current-docs at
  implementation time.

## Alternatives considered

- **Option C — wait for render recovery**: unbounded product outage;
  lots' deadlines burn down unseen, directly against the product
  promise. Retained only as the 1-notice canary + drain-based recovery
  detection running alongside the chosen branch. Rejected as the plan.
- **Option A as the end-state** (even with the favorable alignment
  evidence): permanently abandons raw-XML provenance (ADR-0005), SDK
  versioning, buyer org ids, and per-lot geography — a strictly weaker
  data platform, adopted while an official raw-XML channel (Branch B)
  may still exist (gate open; TED's bulk-download page is a documented
  reuser surface even though our polled address is unproven). Rejected;
  A′ is interim-only with an explicit retirement condition.
- **Scraping the HTML notice pages**: re-creates the dependence on
  undocumented website behavior that just failed us, adds fragile HTML
  parsing of untrusted content, and violates the "boring, official
  surfaces" bias. Rejected.
- **Paid procurement data providers**: prohibited by ground rules (no
  paid procurement datasets); also a fixed-cost violation at MVP scale.
  Rejected.
- **Cloudflare Workflows for the package extraction** (ADR-0006
  reversal): the resume-capable extraction is Workflows-shaped, but the
  queues+cron sketch meets the requirement with machinery we already
  operate; a re-examination note on ADR-0006 suffices until the
  extraction is built and measured. Rejected for now.
- **Deciding the branch today without the probes**: Branch B's
  superiority is conditional on a package actually arriving from a
  proven address — facts still open, and this week has punished every
  unmeasured assumption about TED's async subsystem (ADR-0008 A3, the
  v1 FALSIFIED-verdict error, the serialized-queue hypothesis, and the
  "endpoint is real" over-correction downgraded within hours of being
  made). The gate costs hours; a wrong channel commitment costs weeks.
  Rejected.
