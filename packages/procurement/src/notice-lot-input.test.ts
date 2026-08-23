/**
 * The notice → `LotInput` mapping, pinned against real fixtures.
 *
 * These assertions exist because a hand-rolled version of this mapping
 * silently produced wrong scores: it read the deadline off a property name
 * that does not exist (`submissionDeadline` rather than `deadline`) and took
 * the country from a lot-level field `NormalizedLot` has never had. Neither
 * failed loudly — the engine scored the wrong input and returned a
 * confident, understated number. So every field the engine actually reads is
 * checked here against a notice whose real values are known.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseEformsNotice } from '@bidmorrow/ted';
import { noticeToLotInputs } from './notice-lot-input';

// Same URL-relative form the parser's own fixture tests use — this package
// builds against workers types, so `node:path` is not available here.
const FIXTURES = new URL('../../../tests/fixtures/ted/', import.meta.url);

function load(relativePath: string) {
  return parseEformsNotice(readFileSync(new URL(relativePath, FIXTURES), 'utf8'));
}

describe('noticeToLotInputs', () => {
  it('maps a single-lot German services notice field by field', () => {
    const { inputs, skipped } = noticeToLotInputs(load('1.13/real-cyber-pentest.xml'));
    expect(skipped).toEqual([]);
    expect(inputs).toHaveLength(1);

    const [only] = inputs;
    expect(only?.lotId).toBe('LOT-0000');
    expect(only?.title).toBe('Rahmenvertrag Penetrationstests');

    const lot = only?.lot;
    expect(lot?.cpv.main).toBe('72800000');
    expect(lot?.nuts).toEqual(['DE300']);
    // Derived from the NUTS prefix, not from a lot-level country field.
    expect(lot?.countries).toEqual(['DE']);
    expect(lot?.contractNature).toBe('services');
    expect(lot?.procedureType).toBe('open');
    expect(lot?.buyerLegalType).toBe('pub-undert');
    // The regression that started this file: a real deadline, not null.
    expect(lot?.deadlineAt).toBe(Date.parse('2026-09-22T08:00:00.000Z'));
    // The notice publishes no lot value — an explicit unknown, never a zero.
    expect(lot?.valueEur).toBeNull();
    expect(lot?.valueIsDerived).toBe(false);
  });

  it('keys the lot text by the notice language rather than by every variant', () => {
    const { inputs } = noticeToLotInputs(load('1.13/real-cyber-pentest.xml'));
    // Ingestion stores ONE title and scoring keys it by the notice's primary
    // language. Handing the engine a multilingual map would let an English
    // capability term match a notice whose stored text is German.
    expect(Object.keys(inputs[0]?.lot.titleByLang ?? {})).toEqual(['deu']);
    expect(inputs[0]?.lot.languages).toEqual(['deu']);
  });

  it('carries each lot of a multi-lot notice separately', () => {
    const { inputs } = noticeToLotInputs(load('1.13/real-it-consulting-two-lot.xml'));
    expect(inputs.map((i) => i.title)).toEqual([
      'Strategischer Schwerpunkt',
      'Sourcing Schwerpunkt',
    ]);
    expect(new Set(inputs.map((i) => i.lot.cpv.main))).toEqual(new Set(['72000000']));
  });

  it('reports a non-EUR value as needing an FX rate instead of dropping it', () => {
    // Production converts through an ECB rate looked up at score time. A
    // caller with no rate table must be told, not handed a lot whose value
    // silently reads as "not published" — that understates the lot.
    const { inputs, skipped } = noticeToLotInputs(
      load('1.13/real-cpv-mismatch-print-services.xml'),
    );
    expect(inputs).toEqual([]);
    expect(skipped).toEqual([{ lotId: 'LOT-0001', reason: 'value_needs_fx_rate' }]);
  });

  it('divides a procedure-level value across the lots that publish none', () => {
    const { inputs } = noticeToLotInputs(load('1.12/real-multi-lot.xml'));
    // Every lot in this notice publishes its OWN value, so nothing is
    // derived — the split only ever fills genuine gaps.
    expect(inputs.every((i) => i.lot.valueIsDerived === false)).toBe(true);
    expect(inputs[0]?.lot.valueEur).toBe(575000);
  });

  it('falls back to the buyer country when a lot publishes no NUTS code', () => {
    const { inputs } = noticeToLotInputs(load('1.15/normal.xml'));
    expect(inputs[0]?.lot.nuts).toEqual([]);
    expect(inputs[0]?.lot.countries).toEqual(['GB']);
  });
});
