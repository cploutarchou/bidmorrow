# TED Ingestion Scope

Ingestion is **scoped, not exhaustive** — a product feature (relevance) and a
hard platform necessity (D1 10 GB limit, cost). Decision recorded in
ADR-0003; this doc is the operational definition. The scope is config-driven
(feature-flag/config table), admin-adjustable, and every widening is an
admin-only bounded backfill.

## Notice-type scope

- `form-type = competition` only (calls for tender: subtypes 10–24, CEI, E3).
- Award notices (form-type `result`) are NOT ingested in V1.
- `scope: ACTIVE` publications via daily publication-date windows.

## CPV scope (V1 default)

CPV divisions/families relevant to cybersecurity, cloud, software and IT
consultancies. Matching uses prefix semantics (`classification-cpv IN (...)`
with the family roots; the ted-data agent validates exact query form against
`checkQuerySyntax`).

| Family           | Coverage                                                         | Rationale                                                   |
| ---------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| `72*` (72000000) | IT services: consulting, software development, internet, support | Core segment                                                |
| `48*` (48000000) | Software packages and information systems                        | Core segment                                                |
| `79417000`       | Safety consultancy                                               | Security-adjacent consultancy (narrow pick, not all of 79*) |

Families considered and **excluded by default** (all config-addable after
pilot evidence): broad `79*` business services (noise outweighs relevance),
`71*` engineering (rarely maps to the segment), `35*` security
hardware/surveillance systems (physical security ≠ target segment),
`80533100` computer training.

**V1 default scope = `72*` + `48*` + a small reviewed extras list
(initial: 79417000).** The pilot will tell us which narrow additions earn
their noise. The scope table is data, not code: adding/removing families
requires no deploy.

Country scope: **none by default** (all EU/EEA publication countries).
A country filter exists in config as a budget lever if volume exceeds
projections.

## Volume projection

TED publishes on the order of thousands of notices/day across all sectors;
IT families are a small slice. Working planning number: **150–300
competition notices/day** in scope (≈1.6 lots each). To be measured in
Phase 5 against reality and recorded in the ledger + cost model; if measured
volume exceeds ~2× projection, tighten scope or enable country filter
before widening anything.

## Retention & archival policy

- Normalized tender data (notice versions, lots, CPV/geo rows, matches,
  components, risk flags) is **pruned when the last lot deadline passed more
  than `RETENTION_DAYS` ago (default 90, config)**. Notices with no deadline
  use publication_date + 180 days.
- Saved tenders are exempt: a lot saved by any organization keeps its
  normalized rows (customer data promise) until unsaved + grace.
- Raw snapshots persist in R2 per ADR-0005 (3-year lifecycle) — the archive
  tier; anything pruned from D1 remains reconstructible.
- The purge job runs daily (cron), bounded per run, records counts in its
  run row, and is covered by integration tests. `ingestion_runs` /
  `digest_runs` operational rows are retained 12 months.

## Change control

- Scope stored in config (admin UI, Phase 10); every change writes an
  audit_events row.
- Widening triggers a **bounded backfill**: admin specifies family +
  publication-date range (max 90 days per operation), runs through the
  normal ingestion pipeline with its budget caps.
- Cost guardrail: after any widening, the cost-audit skill re-projects D1
  growth; scope changes that project past 60% of the D1 limit at 12 months
  are rejected pending retention tightening.

## Product disclosure

Methodology page + terms state that coverage is scoped to documented CPV
families, list them, and never imply exhaustive coverage of EU procurement.
