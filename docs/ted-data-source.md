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
- Response: `notices[]`, `totalNoticeCount`, `iterationNextToken`.
  Multilingual fields are objects keyed by ISO 639-2 codes (`eng`, `deu`…).
  `links.xml.MUL` is the authoritative multilingual source XML per notice —
  ingestion fetches this for parsing + R2 snapshot.
- No documented req/s or daily quota exists in the official spec. We do NOT
  assume unlimited: polite throttling, exponential backoff on 429/5xx, and
  an admin-configurable request budget per run are mandatory.

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
