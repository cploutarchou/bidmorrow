import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESULT_LIMIT,
  localComboboxSource,
  rankComboboxOptions,
  type ComboboxOption,
} from './combobox-filter';

const CPV_LIKE: readonly ComboboxOption[] = [
  { value: '72200000', label: 'Software programming and consultancy services' },
  { value: '72212000', label: 'Programming services of application software' },
  { value: '72220000', label: 'Systems and technical consultancy services' },
  { value: '48000000', label: 'Software package and information systems' },
  { value: '79417000', label: 'Safety consultancy services' },
];

describe('rankComboboxOptions', () => {
  it('returns the first N options in given order for an empty query (browse state, not "no results")', () => {
    const result = rankComboboxOptions('', CPV_LIKE, 3);
    expect(result).toEqual(CPV_LIKE.slice(0, 3));
  });
  it('treats a whitespace-only query the same as empty', () => {
    expect(rankComboboxOptions('   ', CPV_LIKE, 2)).toEqual(CPV_LIKE.slice(0, 2));
  });

  it('ranks a value-prefix match before a value-substring-only match', () => {
    const options: readonly ComboboxOption[] = [
      { value: '72220000', label: 'Systems and technical consultancy services' }, // "220000" is only a substring of the value
      { value: '22000005', label: 'Some other code' }, // "220000" IS a prefix of the value
    ];
    const result = rankComboboxOptions('220000', options);
    expect(result.map((o) => o.value)).toEqual(['22000005', '72220000']);
  });

  it('ranks a label-word-prefix match ahead of a substring-only match', () => {
    // "ware" sits mid-word in "Software" (substring-only, no word starts
    // with it) but is a genuine word-prefix of "Warehouse": querying a
    // term that hits both tiers proves prefix sorts first regardless of
    // each option's `value`/alphabetical position.
    const options: readonly ComboboxOption[] = [
      { value: 'A', label: 'Software development services' }, // substring-only ("Soft-ware")
      { value: 'Z', label: 'Warehouse logistics services' }, // word-prefix ("Ware-house")
    ];
    const result = rankComboboxOptions('ware', options);
    expect(result.map((o) => o.value)).toEqual(['Z', 'A']);
  });

  it('matches case-insensitively', () => {
    const result = rankComboboxOptions('SOFTWARE', CPV_LIKE);
    expect(result.map((o) => o.value)).toContain('48000000');
  });

  it('matches a query that is a substring of the label but not a prefix of any word', () => {
    // "onsult" is inside "consultancy" but is not itself a word-start,
    // every CPV_LIKE label containing "consultancy" matches, all in the
    // substring-only tier (numeric-aware value order).
    const result = rankComboboxOptions('onsult', CPV_LIKE);
    expect(result.map((o) => o.value)).toEqual(['72200000', '72220000', '79417000']);
  });

  it('returns an empty array for a query with zero matches, never falling back to the full list', () => {
    expect(rankComboboxOptions('zzzznomatch', CPV_LIKE)).toEqual([]);
  });

  it('sorts CPV-style codes numerically within a tier, not lexicographically', () => {
    const options: readonly ComboboxOption[] = [
      { value: '72212000', label: 'B' },
      { value: '72100000', label: 'A' },
      { value: '72999000', label: 'C' },
    ];
    // All three share the "72" value-prefix, so this exercises the
    // within-tier `localeCompare(..., { numeric: true })` ordering.
    const result = rankComboboxOptions('72', options);
    expect(result.map((o) => o.value)).toEqual(['72100000', '72212000', '72999000']);
  });

  it('bounds results to the given limit even when more options match', () => {
    const many: readonly ComboboxOption[] = Array.from({ length: 20 }, (_, i) => ({
      value: String(i).padStart(2, '0'),
      label: `Option ${String(i)}`,
    }));
    expect(rankComboboxOptions('option', many, 5)).toHaveLength(5);
  });

  it('defaults to DEFAULT_RESULT_LIMIT when no limit is given', () => {
    const many: readonly ComboboxOption[] = Array.from({ length: 20 }, (_, i) => ({
      value: String(i).padStart(2, '0'),
      label: `Option ${String(i)}`,
    }));
    expect(rankComboboxOptions('option', many)).toHaveLength(DEFAULT_RESULT_LIMIT);
  });
});

describe('localComboboxSource', () => {
  it('resolves the same ranking as rankComboboxOptions, wrapped as a Promise', async () => {
    const source = localComboboxSource(CPV_LIKE, 3);
    const result = await source('72');
    expect(result).toEqual(rankComboboxOptions('72', CPV_LIKE, 3));
  });

  it('never rejects for a local dataset (no network, nothing to fail)', async () => {
    const source = localComboboxSource(CPV_LIKE);
    await expect(source('anything')).resolves.toBeDefined();
  });

  it('ignores an AbortSignal argument for a local source (nothing async to cancel)', async () => {
    const source = localComboboxSource(CPV_LIKE);
    const controller = new AbortController();
    controller.abort();
    await expect(source('soft', controller.signal)).resolves.toEqual(
      rankComboboxOptions('soft', CPV_LIKE),
    );
  });
});
