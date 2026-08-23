/**
 * Turns a parsed eForms notice straight into the `LotInput`s the matching
 * engine scores, without a database in between.
 *
 * The production path is notice → D1 rows (`run-window.ts`) → `LotInput`
 * (`scoring-input.ts`). That is the right shape for ingestion, but it means
 * anything wanting a score for a notice it merely HAS — the public
 * sample-verdict demo — has to reproduce two mapping steps by hand.
 *
 * Reproducing them by hand is exactly what goes wrong. A hand-rolled mapper
 * written for the demo took the lot's country from a field that does not
 * exist on `NormalizedLot` and read the deadline as `submissionDeadline`
 * rather than `deadline`, so every sample verdict scored geography 0/15 and
 * reported "no submission deadline published". Both were silent: the engine
 * happily scores wrong input. This module exists so there is one mapping,
 * under test, and the demo cannot quietly diverge from what customers see.
 *
 * Each field below names the production line it mirrors.
 */
import type { NormalizedLot, NormalizedNotice } from '@bidmorrow/ted';
import type { LotInput } from '@bidmorrow/matching';

import { normalizeBuyerCountry } from './country-map';
import { parseLotContractNature } from './scoring-input';
import { firstLanguageValue, nutsToCountry } from './lot-normalization';
import { deriveValueEur, divideValueAcrossLots } from './value';

export interface NoticeLotInput {
  /** `LOT-0001` etc., so a caller can name which lot it scored. */
  readonly lotId: string;
  /** The title ingestion would store — first language variant, never invented. */
  readonly title: string;
  readonly lot: LotInput;
}

/**
 * Why a lot could not be mapped. Both cases are real and are surfaced rather
 * than papered over: production drops a lot with no main CPV (`scoring-input`
 * returns `missing_main_cpv`), and it resolves a non-EUR value through an ECB
 * rate looked up in D1 at score time, which is not available here.
 */
export type NoticeLotSkipReason = 'missing_main_cpv' | 'value_needs_fx_rate';

export interface NoticeLotInputResult {
  readonly inputs: readonly NoticeLotInput[];
  readonly skipped: readonly { readonly lotId: string; readonly reason: NoticeLotSkipReason }[];
}

/**
 * Maps every lot of `notice` to a scorable `LotInput`.
 *
 * Lots that production would score differently than this function can are
 * reported in `skipped` instead of being returned with a guessed value —
 * a demo that showed an unconverted foreign-currency amount as "not
 * published" would be understating a lot the real product scores fully.
 */
export function noticeToLotInputs(notice: NormalizedNotice): NoticeLotInputResult {
  const buyerCountry = normalizeBuyerCountry(notice.buyer?.country ?? null);
  // run-window.ts: values are divided across lots BEFORE any per-lot work,
  // because an equal split depends on how many lots lack their own value.
  const values = divideValueAcrossLots(notice.lots, notice.procedureEstimatedValue);
  // scoring-input.ts: the stored language list, primary first.
  const languages = [...notice.languages];
  const primaryLanguage = languages[0] ?? 'und';

  const inputs: NoticeLotInput[] = [];
  const skipped: { lotId: string; reason: NoticeLotSkipReason }[] = [];

  notice.lots.forEach((lot: NormalizedLot, index) => {
    if (lot.cpv.main === null) {
      skipped.push({ lotId: lot.lotId, reason: 'missing_main_cpv' });
      return;
    }
    const value = values[index];
    const amount = value?.amount ?? null;
    const currency = value?.currency ?? null;
    const valueEur = deriveValueEur(amount, currency);
    if (amount !== null && valueEur === null) {
      skipped.push({ lotId: lot.lotId, reason: 'value_needs_fx_rate' });
      return;
    }

    // run-window.ts: one geography row per NUTS code, or a single
    // buyer-country row when the lot publishes no NUTS at all.
    const geographies =
      lot.nuts.length > 0
        ? lot.nuts.map((nuts) => ({
            countryCode: nutsToCountry(nuts, buyerCountry),
            nutsCode: nuts,
          }))
        : buyerCountry !== null
          ? [{ countryCode: buyerCountry.countryCode, nutsCode: null }]
          : [];

    const title = firstLanguageValue(lot.title) ?? `Lot ${lot.lotId}`;
    const description = firstLanguageValue(lot.description);

    inputs.push({
      lotId: lot.lotId,
      title,
      lot: {
        cpv: { main: lot.cpv.main, additional: [...lot.cpv.additional] },
        // scoring-input.ts keys the ONE stored variant by the notice's
        // primary language — not the full multilingual map. Handing the
        // engine every translation would let capability matching hit an
        // English phrase on a notice whose stored text is Finnish.
        titleByLang: { [primaryLanguage]: title },
        descriptionByLang: description !== null ? { [primaryLanguage]: description } : {},
        countries: [...new Set(geographies.map((g) => g.countryCode))],
        nuts: geographies.map((g) => g.nutsCode).filter((code): code is string => code !== null),
        valueEur,
        originalCurrency: currency,
        valueIsDerived: value?.valueIsDerived ?? false,
        deadlineAt: lot.deadline,
        buyerLegalType: notice.buyer?.legalTypeCode ?? null,
        procedureType: notice.procedureType,
        // run-window.ts stores the lot nature with the procedure nature as
        // its fallback; `parseLotContractNature` is what scoring-input.ts
        // uses to turn that stored string into a nature, dropping anything
        // outside the vocabulary rather than casting it (SEC-P6-04).
        contractNature: parseLotContractNature(lot.contractNature ?? notice.contractNature ?? null),
        languages: languages.length > 0 ? languages : [primaryLanguage],
      },
    });
  });

  return { inputs, skipped };
}
