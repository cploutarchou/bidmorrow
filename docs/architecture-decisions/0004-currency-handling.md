# ADR-0004: Currency handling — EUR direct, ECB reference rates for conversion, else UNKNOWN

Status: Accepted (2026-08-14)

## Context

Tender values arrive in the notice's currency. Most EU notices are EUR, but
TED covers non-euro member states (SEK, PLN, DKK, CZK, HUF, RON, BGN...) and
EEA countries (NOK, ISK). Value-fit scoring must never silently compare
amounts in different currencies, and must never fabricate a converted value
presented as source data.

## Decision

1. EUR values compare directly against org preferences (which are entered
   in EUR).
2. Non-EUR values are converted **for scoring only** using **ECB euro
   foreign exchange reference rates** (official, free, no key; published
   daily ~16:00 CET at ecb.europa.eu / via their XML feed). A small
   `exchange_rates` table is refreshed by the ingestion cron; a rate is
   valid for scoring if ≤ 7 days old.
3. The UI always shows the **original value + original currency** from the
   source. Converted amounts appear only inside the score explanation,
   explicitly labeled: "≈ €X at ECB reference rate (YYYY-MM-DD), for
   scoring only".
4. Currencies without a fresh ECB reference rate → value component =
   **UNKNOWN** (neutral 50% per docs/matching-engine.md), explanation states
   why. Never 0, never a guessed rate.

## Consequences

- One tiny daily fetch + ~30 rows of rate data: negligible cost, no vendor.
- Stored match rows record the rate date used → scores remain reproducible.
- Rate staleness (weekend/holiday gaps) tolerated up to 7 days — accuracy is
  ample for a 10-point band-based fit score.

## Alternatives considered

- EUR-only, everything else UNKNOWN: simplest, but silently degrades scoring
  quality for Sweden/Poland/Nordics — squarely inside our target market.
- Paid FX API: violates cost rules for zero added benefit at our precision.
- Converting at ingestion and storing converted values as canonical: risks
  presenting fabricated values as source data — forbidden.
