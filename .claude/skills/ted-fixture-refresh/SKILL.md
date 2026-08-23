---
name: ted-fixture-refresh
description: Fetch, sanitize, and label real TED notice fixtures for contract tests. Use when adding parser coverage, when a new eForms SDK version appears in the wild, or when a production parsing bug needs a reproducing fixture.
---

# TED fixture refresh

Contract tests run against sanitized REAL TED responses — never hand-invented
XML, never live TED in CI.

## Procedure

1. Fetch real notices via the TED Search API (see docs/ted-data-source.md for
   endpoint/query syntax) matching the case you need: normal, multi-lot,
   missing value, missing deadline, corrected notice, non-English, unexpected
   optional fields — and at least two different eForms SDK versions.
2. Extract the declared eForms SDK version from the notice XML
   (`eforms:SdkVersion` extension element) — every fixture is labeled with it.
3. Sanitize: keep structure and realistic values; personal names/emails/phones
   of contact persons are replaced with obviously fake equivalents
   (`contact@example-buyer.example`). Do NOT alter structure, field paths,
   language codes, CPV/NUTS codes, or omit fields the real notice had.
4. Store under `tests/fixtures/ted/<sdk-version>/<case-name>.xml` with a
   sibling `<case-name>.meta.json`: source notice ID, publication date,
   retrieval date, sdk version, case description, sanitization applied.
   **The `sanitization` field records field path + occurrence count, NEVER
   the removed value.** Quoting the personal email or number that was taken
   out puts it straight back into the repository and defeats step 3 —
   see the existing entries for the wording to follow.
5. Malformed-fixture cases are the exception to "real only": derive them by
   minimally corrupting a real fixture and document the corruption in meta.
6. Add/extend the contract test asserting the normalized output for the new
   fixture, then run `pnpm test --filter <contract tests>` and report results.
