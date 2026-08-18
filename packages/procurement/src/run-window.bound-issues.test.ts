/**
 * Unit tests for `boundIssuesForErrorDetail`'s 50KB cap (docs: D1 statement
 * size limit). Isolated from `run-window.d1.test.ts` (real-D1 integration
 * tests) since this is a pure function needing no D1/R2 binding.
 */
import { describe, expect, it } from 'vitest';
import type { ParseIssue } from '@bidmorrow/ted';

import {
  boundIssuesForErrorDetail,
  MAX_DIAGNOSTIC_VALUE_CHARS,
  MAX_ISSUES_DETAIL_JSON_CHARS,
  truncateForDiagnostic,
} from './run-window';

function makeIssue(index: number, messageLength = 20): ParseIssue {
  return {
    severity: 'error',
    code: `issue-${String(index)}`,
    message: 'x'.repeat(messageLength),
    path: `/lot[${String(index)}]`,
  };
}

describe('boundIssuesForErrorDetail', () => {
  it('returns issues unchanged when well under the cap', () => {
    const issues = [makeIssue(0), makeIssue(1)];
    expect(boundIssuesForErrorDetail(issues)).toEqual(issues);
  });

  it('returns an empty array unchanged', () => {
    expect(boundIssuesForErrorDetail([])).toEqual([]);
  });

  it('never exceeds the 50KB serialized-JSON budget, even for a pathological number of issues', () => {
    const issues = Array.from({ length: 5000 }, (_, i) => makeIssue(i, 200));
    const bounded = boundIssuesForErrorDetail(issues);
    const serialized = JSON.stringify(bounded);
    expect(serialized.length).toBeLessThanOrEqual(MAX_ISSUES_DETAIL_JSON_CHARS);
    // Truncation happened: fewer issues than were given, and a marker was appended.
    expect(bounded.length).toBeLessThan(issues.length);
    expect(bounded.at(-1)).toBe('...truncated');
  });

  it('keeps issues in original order up to the point of truncation', () => {
    const issues = Array.from({ length: 5000 }, (_, i) => makeIssue(i, 200));
    const bounded = boundIssuesForErrorDetail(issues);
    const kept = bounded.slice(0, -1) as ParseIssue[];
    for (const [i, issue] of kept.entries()) {
      expect(issue.code).toBe(`issue-${String(i)}`);
    }
  });

  it('does not truncate when the full JSON lands exactly at the cap boundary', () => {
    // Binary-search-free approximate boundary case: a single huge issue that
    // alone is within budget should pass through untruncated.
    const singleLargeIssue = makeIssue(0, MAX_ISSUES_DETAIL_JSON_CHARS - 200);
    const fullJson = JSON.stringify([singleLargeIssue]);
    expect(fullJson.length).toBeLessThanOrEqual(MAX_ISSUES_DETAIL_JSON_CHARS);
    expect(boundIssuesForErrorDetail([singleLargeIssue])).toEqual([singleLargeIssue]);
  });

  it('truncates a single pathologically large issue rather than exceeding the cap', () => {
    const hugeIssue = makeIssue(0, MAX_ISSUES_DETAIL_JSON_CHARS * 2);
    const bounded = boundIssuesForErrorDetail([hugeIssue]);
    expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(MAX_ISSUES_DETAIL_JSON_CHARS);
    expect(bounded).toEqual(['...truncated']);
  });
});

describe('truncateForDiagnostic', () => {
  it('returns short values unchanged', () => {
    expect(truncateForDiagnostic('https://ted.europa.eu/notice/1.xml')).toBe(
      'https://ted.europa.eu/notice/1.xml',
    );
    expect(truncateForDiagnostic('')).toBe('');
  });

  it('returns a value exactly at the cap unchanged', () => {
    const exact = 'x'.repeat(MAX_DIAGNOSTIC_VALUE_CHARS);
    expect(truncateForDiagnostic(exact)).toBe(exact);
  });

  it('truncates a pathological value to the cap plus a marker (D1 statement-size guard)', () => {
    const huge = 'x'.repeat(MAX_DIAGNOSTIC_VALUE_CHARS * 100);
    const truncated = truncateForDiagnostic(huge);
    expect(truncated.length).toBe(MAX_DIAGNOSTIC_VALUE_CHARS + '…truncated'.length);
    expect(truncated.endsWith('…truncated')).toBe(true);
    expect(truncated.startsWith('x'.repeat(MAX_DIAGNOSTIC_VALUE_CHARS))).toBe(true);
  });
});
