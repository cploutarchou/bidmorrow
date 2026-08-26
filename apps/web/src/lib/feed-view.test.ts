import { describe, expect, it } from 'vitest';
import { feedPathForView, parseFeedView } from './feed-view';

describe('parseFeedView', () => {
  it('accepts every known view', () => {
    for (const view of ['today', 'strong', 'worth_reviewing', 'possible', 'saved', 'ignored']) {
      expect(parseFeedView(view)).toBe(view);
    }
  });
  it('falls back to today for missing or unknown values', () => {
    expect(parseFeedView(null)).toBe('today');
    expect(parseFeedView(undefined)).toBe('today');
    expect(parseFeedView('')).toBe('today');
    expect(parseFeedView('SAVED')).toBe('today');
    expect(parseFeedView('<script>')).toBe('today');
  });
  it('tolerates surrounding whitespace', () => {
    expect(parseFeedView(' saved ')).toBe('saved');
  });
});

describe('feedPathForView', () => {
  it('keeps /app clean for the default view', () => {
    expect(feedPathForView('today')).toBe('/app');
  });
  it('encodes other views as ?view=', () => {
    expect(feedPathForView('saved')).toBe('/app?view=saved');
    expect(feedPathForView('worth_reviewing')).toBe('/app?view=worth_reviewing');
  });
});
