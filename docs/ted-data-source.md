# TED Data Source

Verified against official sources on **2026-08-14**: TED API OpenAPI spec
(OP-TED/TEDAPI-docs, the source of docs.ted.europa.eu/api), eForms SDK
1.15.1 (OP-TED/eForms-SDK `fields.json` / `notice-types.json` / codelists),
eforms-docs, ted.europa.eu help/legal pages. Flags at the end list what
could not be fully verified.

## Search API (the V1 integration surface)

- Base: `https://api.ted.europa.eu/`
- Endpoint: **`POST /v3/notices/search`** — JSON body, **anonymous** (the
  Search API requires no API key; keys exist only for unpublished-notice
  APIs).
- Request body: `query` (expert query string, required), `fields` (required
  array — eForms BT ids like `BT-21-Lot` or kebab-case aliases like
  `publication-number`, `buyer-country`, `links`), `page` (≥1), `limit`
  (≤250), `scope` (`LATEST` | `ACTIVE` | `ALL`), `paginationMode`
  (`PAGE_NUMBER` | `ITERATION`), `iterationNextToken`, `checkQuerySyntax`,
  `onlyLatestVersions`.
- Pagination: PAGE_NUMBER is stateless, capped at **15,000 notices per
  query**; **ITERATION mode** (point-in-time scroll, token valid ≥24 h) has
  no cap — ingestion uses ITERATION within a bounded daily window.
- Caps: 250 notices/page; `len(fields) × limit ≤ 10,000` fields/page.
- **What ingestion actually requests** (`SEARCH_FIELDS`,
  `packages/procurement/src/run-window.ts`): `publication-number`,
  `publication-date`, `links`, `OJ` — 4 × 250 = 1,000, well inside the cap.
  `OJ` (ADR-0010 §5.3) is the authoritative OJ S gazette issue, the key that
  maps a notice to its daily bulk package.
- **`onlyLatestVersions` is pinned to `false`** on the window search
  (ADR-0010 §5.1), not left to the upstream default. Corrections are new
  publications in our version model, so every published version must be
  seen. Measured 2026-08-17 on the same window: `true` → 145 notices,
  `false` → 156 — an unpinned default that flipped would silently drop those
  11 superseded versions (~7%) and the history they carry.
- Response: `notices[]`, `totalNoticeCount`, `iterationNextToken`.
  Multilingual fields are objects keyed by ISO 639-2 codes (`eng`, `deu`…).
  `links.xml.MUL` is the authoritative multilingual source XML per notice —
  ingestion fetches this for parsing + R2 snapshot.
- **The render front-end is a SHORT-TTL CACHE, not a queue that fills up**
  (measured 2026-08-21, `ted-render-batch-probe` run 32520323517, window
  2026-08-17, times relative to trigger completion):

  | Batch  | absent            | AVAILABLE               | absent again |
  | ------ | ----------------- | ----------------------- | ------------ |
  | A (5)  | —                 | **+7..+67s** (3/5)      | by +132s     |
  | B (50) | +60..+112s (0/50) | **+232..+310s** (47/50) | by +490s     |

  A GET either returns cached XML (200) or queues a render and answers 202.
  Content APPEARS and then DISAPPEARS: present at one pass, gone at the
  next, in both batches independently. `other=0` on every pass — no 4xx or
  5xx anywhere — so this is re-queueing, not rate limiting or blocking.
  Render latency scales with batch size (5 notices ready inside a minute,
  50 took ~4 minutes), consistent with serialized per-client capacity.

  **This resolves the contradiction in the earlier evidence.** The
  2026-08-18 single-notice diagnostic saw a render complete because it
  polled inside the window; the 2026-08-20 run saw 0/156 because a
  156-notice cycle takes longer than the content survives — by the time
  the collector came back around, the early renders had expired. It was a
  treadmill, not an outage. Nothing was ever "down".

  **Consequence: this channel cannot be a production content source**, and
  ADR-0010 §1's permanent demotion stands on stronger evidence than when
  it was written. Collecting 156 notices this way requires winning a
  ~1-3 minute race per batch, with any slip losing the content until
  re-triggered. Bulk packages are static files — no window, no race.
  The exact TTL is NOT measured: content was present at one poll and
  absent at the next, which bounds it above (~2 min for A, ~3 min for B)
  without pinning it.

- **The anonymous XML front-end renders ASYNCHRONOUSLY** (empirical,
  2026-08-18, ted-diagnose CI runs 32131289081/32131832286/32132169652 —
  supersedes the 2026-08-16 "identifying client" note): a GET of a
  `links.xml.MUL` URL (`ted.europa.eu/<lang>/notice/<id>/xml`) now returns
  **HTTP 202 with an empty body for EVERY client** (identified, bare, and
  browser-like alike; `?download=true` changes nothing); the request queues
  a server-side render, and a LATER request may be served the cached XML
  (observed ~200 + full XML minutes after the trigger; the cache is
  short-lived/unstable — the same URL reverted to 202 within ~4 minutes).
  `TedClient` surfaces 202/empty-2xx as `TedRenderPendingError`; the
  orchestrator (`runIngestionWindow`) requeues the notice to the tail of
  the window's work queue (max `MAX_RENDER_VISITS` visits, min
  `RENDER_RETRY_DELAY_MS` between visits to the same notice) so every
  render is triggered on the first pass and collected on later passes; an
  exhausted notice is skipped into `ingestion_fetch_retries` and tracked
  in its own `notices_render_pending` counter — never window-fatal and
  never part of the systemic fetch-failure threshold (ADR-0008 as
  superseded in part by ADR-0009). This async behavior broke the first
  non-empty staging window (2026-08-17, 156 in-scope notices).
  **The render pipeline is currently completing NO renders at all**
  (empirical, 2026-08-20). Evidence: (i) 05:00 UTC staging run — all 156
  renders triggered, ZERO completed across 6 visits over ~8–10 minutes
  (no HTTP or parse errors — 202/empty only); (ii) batch-size probe run
  32337551926 (05:56–06:12 UTC, Azure egress, anonymous, ~1 s spacing,
  identifying UA) — a 5-notice batch AND a 50-notice batch both at 0
  rendered at pass 1 and at +60/+120/+180 s, `other=0` (no 4xx/5xx, no
  rate-limit signal). This REFUTES the per-client-serialized-render
  hypothesis: batch size is not the variable, and the effect is
  egress-independent. Since the 2026-08-18 single-notice probe DID
  collect a render (200 + 12,953 bytes minutes after trigger), the
  pipeline stopped completing renders somewhere between 2026-08-18 and
  2026-08-20 — an upstream outage or behavior change (cause/duration
  unknown; ted-data investigation in progress — see ADR-0009 §3/§5 for
  the architectural posture and the source-acquisition contingency).
- **There is NO authenticated notice-XML download endpoint** (verified
  live 2026-08-18 against the owner's real key AND the API's own OpenAPI
  spec, ted-api-probe runs 32152093521/32155040026 — supersedes the
  same-day "authenticated endpoint exists" inference). The complete
  `api.ted.europa.eu` v3 path list is eSender submission
  (`/v3/notices/submit|validate|render|render-async|convert`,
  `/v3/notices/{businessId}/…`, `/v3/notices` = "search YOUR submitted
  notices", `/v3/api-keys/{token}/renew`, `/v3/config/sdk-versions`) plus
  the anonymous `/v3/notices/search`. `GET /v3/notices/{id}/xml` answers
  `404 No static resource` with valid credentials — the earlier
  `400 Missing Authorization header` (and pre-pairing
  `403 No eNotices2 account found`) came from a gateway auth filter that
  answers BEFORE routing, which made the endpoint look real. A developer
  API key therefore buys nothing for ingestion; `TedClient` takes no
  apiKey and the front-end route with render-cycling above is THE
  supported path. The dispatchable `ted-api-probe` workflow remains for
  re-checking if TED ever adds a content endpoint.
- The search API (api.ted.europa.eu `/v3/notices/search`) remains anonymous
  and unaffected; `TedClient` still sends `Accept` + `TED_USER_AGENT` on
  every request (transparency toward the data provider).
- No documented req/s or daily quota exists in the official spec. We do NOT
  assume unlimited: polite throttling, exponential backoff on 429/5xx, and
  an admin-configurable request budget per run are mandatory.

## Bulk XML packages (address verified 2026-08-20; delivery UNPROVEN)

TED publishes daily and monthly bulk XML packages, and publishes their
links itself at `https://ted.europa.eu/en/simap/xml-bulk-download`
(HTTP 200). The real addresses, taken from that page's hrefs — never
inferred:

- daily: `https://ted.europa.eu/packages/daily/{ojIssueId}` (e.g.
  `202600157`, listed for issues `202600147`–`202600160`)
- monthly: `https://ted.europa.eu/packages/monthly/{year}-{n}` (e.g.
  `2026-1`)

The issue id comes ONLY from the Search API's `OJ` field (`157/2026` for
publication date 2026-08-17 → `202600157`), never from weekday
arithmetic.

**`https://ted.europa.eu/packages/notice/daily/{id}` is NOT an endpoint**
(verified 2026-08-20, ted-source-facts-probe run 32347877913): a real
issue id, `definitely-not-an-issue`, and `00000000` all answer
identically — `202`, 0 bytes, `content-type: text/html; charset=UTF-8`.
That is the website's generic async shell answering any unrecognized
path, so every poll against it measured nothing. Standing rule: an
address is proven by delivering content a garbage id does not, never by
response-code routing.

**The daily package DELIVERS** (verified 2026-08-20, `ted-package-probe`
run 32352483245). `GET /packages/daily/202600157` → HTTP 200,
`content-type: application/gzip`, 19,980,923 bytes,
`content-disposition: attachment; filename=20260817_2026157.tar.gz`,
magic bytes `1f 8b 08 00`, ~207 MB uncompressed. Garbage ids
(`definitely-not-an-issue`, `00000000`) return **400 text/plain** — the
real issue and garbage do NOT behave alike, which is what proves the
address. The monthly package behaves the same way (`monthly/2026-1` →
200, `application/gzip`, 344,184,486 bytes, `2026-01.tar.gz`). Delivery
was immediate; there is no async generation step on this channel.

Archive members are named
`{YYYYMMDD}_{issueNumber}/{documentNumber}_{year}.xml`, e.g.
`20260817_157/00566631_2026.xml`. Note that ONE issue appears in three
encodings in a single response — `202600157` in the URL, `157` in the
member directory, `20260817_2026157` in the download filename — so no
form may be derived from another by assumption. The URL form comes from
the Search API's `OJ` field; the member form is read from the archive.
The `publication-number` ↔ member-filename mapping is NOT yet verified
against a real pair.

A daily package contains ALL notices of its issue (~207 MB uncompressed),
of which a typical in-scope CPV window is ~156 — selective extraction
against search-derived ids is mandatory. This is ADR-0010 Branch B, now
the activated acquisition channel; the render front-end is demoted to a
telemetry canary.

## Expert query language (ingestion filter)

Kebab-case eForms search aliases; boolean AND/OR/NOT, `=`, `~` (contains),
`IN (...)`, comparisons on date/numeric fields, quoted phrases, `SORT BY`.
Verified examples: `buyer-country=FRA`, `notice-type = cn-standard`,
`buyer-name ~ "Council of the"`.

Ingestion query shape (validated with `checkQuerySyntax: true` in tests
before use — the composite form is assembled, not doc-verbatim):

```
(classification-cpv IN (<scope prefixes per docs/ted-ingestion-scope.md>))
AND form-type = competition
AND publication-date >= <window-start> AND publication-date <= <window-end>
SORT BY publication-date
```

Useful fields: `publication-number`, `publication-date`, `notice-type`,
`form-type`, `buyer-country`, `buyer-name`, `notice-title`,
`classification-cpv`, `place-of-performance`, `contract-nature`,
`procedure-type`, `deadline-receipt-tender-date-lot`, `estimated-value-lot`,
`estimated-value-cur-lot`, `links`.

## eForms notices

- **SDK version detection**: `/*/cbc:CustomizationID` = `eforms-sdk-<major>.<minor>`
  (field OPT-002-notice). The parser records this per notice; multiple minor
  versions coexist in the wild (active CVS range currently spans 1.12–1.14,
  1.15.1 released 2026-07; for READING we must tolerate the full historical
  range). Runtime source of truth: `GET /v3/config/sdk-versions`.
- **Competition vs award**: form type (`BT-03`, `/*/cbc:NoticeTypeCode/@listName`)
  = `competition` selects V1 scope. Competition subtypes include 10–14 (PIN
  as call for competition), 15 (qu-sy), **16–19 cn-standard**, 20–21
  cn-social, 22 subco, 23–24 cn-desg, CEI, E3. Awards (form type `result`,
  subtypes 29–37…) are OUT of V1 matching scope. Notice subtype:
  `efac:NoticeSubType/cbc:SubTypeCode` (OPP-070).

### Field map (SDK 1.15.1 `fields.json`; parser targets these, per-version aware)

| Concept                          | Field ID                    | XPath                                                                                                                      |
| -------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Title                            | BT-21-Procedure / BT-21-Lot | `cac:ProcurementProject/cbc:Name` (lot: under `cac:ProcurementProjectLot[cbc:ID/@schemeName='Lot']`)                       |
| Description                      | BT-24-Procedure / BT-24-Lot | `cac:ProcurementProject/cbc:Description`                                                                                   |
| Buyer name                       | BT-500-Organization-Company | `ext:UBLExtensions/.../efac:Organization/efac:Company/cac:PartyName/cbc:Name` (buyer resolved via OPT-300-Procedure-Buyer) |
| Buyer country                    | BT-514-Organization-Company | `efac:Company/cac:PostalAddress/cac:Country/cbc:IdentificationCode`                                                        |
| CPV main                         | BT-262-Procedure/-Lot       | `cac:MainCommodityClassification/cbc:ItemClassificationCode`                                                               |
| CPV additional                   | BT-263-Procedure/-Lot       | `cac:AdditionalCommodityClassification/cbc:ItemClassificationCode`                                                         |
| NUTS                             | BT-5071-Procedure/-Lot      | `cac:RealizedLocation/cac:Address/cbc:CountrySubentityCode`                                                                |
| Estimated value (+currency attr) | BT-27-Procedure/-Lot        | `cac:RequestedTenderTotal/cbc:EstimatedOverallContractAmount[@currencyID]`                                                 |
| Deadline                         | BT-131(d)/(t)-Lot           | `cac:TenderingProcess/cac:TenderSubmissionDeadlinePeriod/cbc:EndDate                                                       | EndTime` |
| Procedure type                   | BT-105-Procedure            | `cac:TenderingProcess/cbc:ProcedureCode`                                                                                   |
| Contract nature                  | BT-23-Procedure/-Lot        | `cac:ProcurementProject/cbc:ProcurementTypeCode[@listName='contract-nature']`                                              |
| Lot ID                           | BT-137-Lot                  | `cac:ProcurementProjectLot/cbc:ID[@schemeName='Lot']`                                                                      |
| Notice language(s)               | BT-702(a)-notice            | `/*/cbc:NoticeLanguageCode` + `cac:AdditionalNoticeLanguage/cbc:ID`                                                        |

## Classifications

- **CPV**: CPV **2008** remains current (Reg. 2195/2002 as amended by Reg.
  213/2008; SDK codelist `cpv.gc` states Version 2008). No adopted newer
  revision found. Official list: ted.europa.eu/en/simap/cpv + EU
  Vocabularies authority table.
- **NUTS**: **NUTS 2024** in force since 2024-01-01 (Delegated Reg. (EU)
  2023/674; SDK codelist `nuts.gc` Version 2024). Older notices may carry
  older NUTS codes — the geo matcher treats unknown/legacy codes at
  country-prefix level rather than failing.

## Reuse & attribution

TED procurement notices are **freely reusable, commercially included**,
under Commission Decision 2011/833/EU, which requires **source
acknowledgement**. UI footer + tender detail display:
"Source: Tenders Electronic Daily (TED), Publications Office of the
European Union" with a link to the original notice. Exact page wording to
be re-verified from ted.europa.eu/en/legal-notice before launch (flag).

## Versioning / corrections

Notices are corrected via new publications (change/corrigendum notices
referencing the original). Ingestion keys on `publication-number`, links
versions of the same procedure/notice family, stores every version in
`tender_notice_versions`, never overwrites history, and recomputes matches
for the current version.

## Flags (re-verify when network allows / in Phase 5)

1. No official rate limit documented — our polite-throttling defaults
   (concurrency 1, ≥500 ms spacing, budget/run) are self-imposed.
2. Legal-notice exact wording; expert-search operator reference table.
3. Whether SDK 1.15 is CVS-active (check `/v3/config/sdk-versions`).
4. Composite ingestion query validated via `checkQuerySyntax` in contract
   tests, not copied from docs.
