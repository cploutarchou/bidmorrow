# Matching Engine Specification (V1)

Deterministic, explainable, LLM-free. Scores are computed per **(organization,
tender lot)** and stored with the engine version that produced them.

## Invariants

1. Same inputs + same engine version ⇒ identical score and components.
2. Every score decomposes into components summing to the total.
3. UNKNOWN inputs are handled by documented neutral policy — never silently 0,
   never max.
4. No requirement is ever asserted without source evidence.
5. `tender_matches.engine_version` records the algorithm version; recomputation
   is an admin-only bounded operation and produces new rows comparable to old.

## Score model (max 100)

| Component | Max | UNKNOWN policy (neutral fraction) |
|---|---|---|
| CPV fit | 35 | n/a — CPV is mandatory in eForms; if absent record ingestion error |
| Capability/keyword fit | 20 | 50% (10) when no matchable-language text exists |
| Geography | 15 | 50% (7.5 → stored as 7.5) when no NUTS/country on lot |
| Contract value | 10 | 50% (5) when no value published or non-EUR unconverted |
| Buyer/sector | 5 | 50% (2.5) when buyer type absent |
| Procedure/contract nature | 5 | 50% (2.5) when absent |
| Deadline runway | 5 | 50% (2.5) when no deadline (e.g. some procedure types) |
| Eligibility/cert signals | 5 | 50% (2.5) when no signals detectable |

Neutral fraction is a single engine constant `UNKNOWN_NEUTRAL = 0.5` of the
component max. Each component result records `status: MATCHED | PARTIAL |
NO_MATCH | UNKNOWN` in `match_components`, so explanations can say
"value not published — neutral score applied".

### CPV fit (35) — hierarchical gradient

CPV codes are 8 digits + check digit; hierarchy by leading digits:
division (2), group (3), class (4), category (5+). Compare every lot CPV
(main + additional) against org CPV preferences; take the best pairwise level,
with a small bonus for multiple independent matches.

| Best relationship | Points |
|---|---|
| Exact code match | 35 |
| Same category (5 digits) | 31 |
| Same class (4 digits) | 27 |
| Same group (3 digits) | 21 |
| Same division (2 digits) | 12 |
| No relationship | 0 |

Bonus: +2 (capped at 35) if ≥2 distinct org CPV preferences match at class
level or better. Main CPV weighted as-is; additional CPVs scored at 85% of the
table value (rounded half-up) before taking the max.

### Capability/keyword fit (20)

Inputs: org keywords, synonym groups, capabilities. Corpus: lot title +
description in languages present on the notice that are matchable (V1
matchable = languages the org's keyword set is written in; practically
English + any language the customer entered keywords in).

- Tokenized, case-insensitive, diacritic-folded whole-word/phrase matching.
  No stemming in V1 (determinism > recall); synonym groups are the customer's
  recall tool.
- Score: sum of hits weighted by term specificity — phrase (≥2 words) hit = 4,
  single-word hit = 2, synonym-group hit counts once per group = 3. Capped at 20.
- If the notice has NO matchable-language text: component = UNKNOWN (10),
  and the match carries indicator `source language: XX — keyword matching
  limited`. A tender is never penalized for its language.

### Geography (15)

| Relationship | Points |
|---|---|
| Lot NUTS within a preferred NUTS region (prefix match) | 15 |
| Country in preferred opportunity countries | 13 |
| Country in countries-served | 10 |
| Neighboring country of a preferred country (static EU adjacency table) | 6 |
| Otherwise | 0 |
| No geography on lot | UNKNOWN (7.5) |

### Contract value (10)

EUR values (or values convertible per docs/architecture-decisions ADR on
currency) compared against org min/max preferred:

- Within [min, max]: 10
- Within 50%–100% of min, or 100%–150% of max: 6
- Within 25%–50% of min, or 150%–250% of max: 3
- Outside: 0
- Unpublished or unconvertible currency: UNKNOWN (5), flagged in explanation.

Lot value preferred; fall back to procedure estimated value divided across lots
only when per-lot value is absent, and mark the component PARTIAL.

### Buyer/sector (5)

V1 heuristic on eForms buyer legal type / activity: buyer types with strong
fit for IT/consulting suppliers (central/regional/local authority, body
governed by public law with activity in general services, defence-adjacent for
cyber where org has matching capability keyword) = 5; recognized but neutral =
3; UNKNOWN = 2.5.

### Procedure / contract nature (5)

- Contract nature ∈ org's supported natures: 3 points; else 0 (or hard
  exclusion if explicitly unsupported — see below).
- Procedure type open/restricted (accessible to newcomers): +2; negotiated
  without prior publication / framework re-openings: +0.

### Deadline runway (5)

Days between now (scoring time) and submission deadline, versus org's
`minimum_days_remaining` (default 10):

- ≥ 2× threshold: 5
- ≥ 1.5×: 4
- ≥ 1×: 2
- < threshold: hard exclusion (below) unless threshold unset, then 0.
- No deadline: UNKNOWN (2.5).

Deadline runway is time-dependent: matches are scored at ingestion and the
stored score records `scored_at`; the feed recomputes classification-affecting
deadline expiry cheaply (expired lots drop out of the feed by query, not by
re-scoring).

### Eligibility/cert signals (5)

If risk detection finds certification/eligibility signals that the org's
declared certifications satisfy (e.g. ISO 27001 required, org holds it): 5.
Signals found but not satisfied: 0 (plus a risk flag — never a fabricated
"you are ineligible" claim). No signals found: UNKNOWN (2.5).

## Classification

| Score | Category |
|---|---|
| 80–100 | STRONG_MATCH |
| 65–79 | WORTH_REVIEWING |
| 45–64 | POSSIBLE_MATCH |
| 0–44 | LOW_FIT |

## Hard exclusions (result = EXCLUDED, no score shown)

Applied only on **known** values — unknown fields never hard-exclude:

1. Lot country/NUTS in org's excluded geographies.
2. Lot CPV within an excluded CPV family (prefix match).
3. Excluded phrase present in matchable-language title/description.
4. Contract nature explicitly marked unsupported by org.
5. Deadline runway below org threshold (when both deadline and threshold known).

Each exclusion records which rule fired and the evidence (code/phrase/date).

## Risk flags

Deterministic, conservative pattern detection over matchable-language text plus
language-independent tokens (ISO standard numbers, currency amounts near
turnover phrases). Types: certification, security_clearance, insurance,
financial_turnover, prior_experience, framework_membership, local_presence,
mandatory_references.

Every flag: `{type, evidence (quoted source snippet + field path), confidence
(HIGH | POSSIBLE), explanation}`. Wording for POSSIBLE: "Possible requirement
detected — verify in source documents." English patterns + a small reviewed
multilingual set (ISO/EN standard numbers are language-independent). No
machine translation.

## Explanation rendering (example)

```
84 / 100 — STRONG_MATCH        engine v1

+32  CPV: 72150000 (exact-class match with your preference 72100000)
+18  Capabilities: "penetration testing", "security assessment" matched
+15  Geography: Cyprus — preferred country
 +8  Value: €180,000 within your €50k–€500k range
 +5  Buyer: national ministry
 +4  Deadline: 34 days (threshold 10)
 +2  Eligibility: no blocking signals detected (neutral)

Risk flags:
 ⚠ ISO 27001 may be required — "certified to ISO 27001" (POSSIBLE) — verify in source documents
```

## Versioning & recomputation

- `ENGINE_VERSION` is a monotonically increasing string (`1`, `2`, ...) baked
  into the matching package; any change to weights, gradients, UNKNOWN policy
  or exclusion rules bumps it.
- Stored per match; admin can trigger bounded recomputation (limited window,
  limited org set) producing new-version rows; the feed always reads the
  latest version per (org, lot).
