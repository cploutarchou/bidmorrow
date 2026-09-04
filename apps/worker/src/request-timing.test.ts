import { describe, expect, it } from 'vitest';
import { readPlacement, serverTimingHeader } from './request-timing';

describe('readPlacement', () => {
  it('accepts a well-formed colo and country', () => {
    expect(readPlacement({ colo: 'AMS', country: 'NL' })).toEqual({ colo: 'AMS', country: 'NL' });
  });

  it('falls back to unknown for a missing or malformed cf object', () => {
    expect(readPlacement(undefined)).toEqual({ colo: 'unknown', country: 'unknown' });
    expect(readPlacement(null)).toEqual({ colo: 'unknown', country: 'unknown' });
    expect(readPlacement({ colo: 'ams; injected', country: 'Netherlands' })).toEqual({
      colo: 'unknown',
      country: 'unknown',
    });
  });
});

describe('serverTimingHeader', () => {
  const placement = { colo: 'CDG', country: 'FR' };

  it('never emits in production', () => {
    expect(serverTimingHeader('production', 123, placement)).toBeNull();
  });

  it('emits the rounded Worker-side wall time and the colo elsewhere', () => {
    expect(serverTimingHeader('staging', 123.6, placement)).toBe('app;dur=124, colo;desc="CDG"');
    expect(serverTimingHeader('local', 0, placement)).toBe('app;dur=0, colo;desc="CDG"');
  });

  it('clamps a negative or non-finite duration to zero', () => {
    expect(serverTimingHeader('staging', -5, placement)).toBe('app;dur=0, colo;desc="CDG"');
    expect(serverTimingHeader('staging', Number.NaN, placement)).toBe('app;dur=0, colo;desc="CDG"');
  });
});
