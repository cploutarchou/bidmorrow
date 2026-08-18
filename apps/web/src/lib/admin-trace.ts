/**
 * Pure diff computation for the admin match-trace view
 * (`GET /api/admin/match-trace`): compares the STORED score components
 * against a LIVE recompute so an admin can see drift at a glance. Text
 * markers only — mismatch status is never conveyed by color alone
 * (docs/conventions/frontend.md WCAG rule).
 */
export interface TraceComponent {
  readonly key: string;
  readonly points: number;
  readonly maxPoints: number;
  readonly status: string;
  readonly explanation: string;
}

export type MismatchKind =
  'match' | 'points_differ' | 'status_differ' | 'stored_only' | 'live_only';

export interface ComponentDiffRow {
  readonly key: string;
  readonly stored: TraceComponent | null;
  readonly live: TraceComponent | null;
  readonly mismatch: MismatchKind;
}

/** Text marker rendered next to a diff row — never color alone. */
export function mismatchMarker(kind: MismatchKind): string {
  switch (kind) {
    case 'match':
      return 'Match';
    case 'points_differ':
      return 'MISMATCH — points differ';
    case 'status_differ':
      return 'MISMATCH — status differs';
    case 'stored_only':
      return 'MISMATCH — missing from live recompute';
    case 'live_only':
      return 'MISMATCH — missing from stored match';
  }
}

function classify(stored: TraceComponent | null, live: TraceComponent | null): MismatchKind {
  if (stored === null && live !== null) return 'live_only';
  if (stored !== null && live === null) return 'stored_only';
  if (stored === null || live === null) return 'match'; // unreachable, satisfies exhaustiveness
  if (stored.status !== live.status) return 'status_differ';
  if (stored.points !== live.points) return 'points_differ';
  return 'match';
}

/**
 * Builds a stored-vs-live diff table keyed by component `key`, sorted for
 * stable rendering. Components present on only one side are included with
 * the other side `null` and flagged as a mismatch — an admin should never
 * silently lose a row that only exists in one recompute.
 */
export function diffComponents(
  stored: readonly TraceComponent[],
  live: readonly TraceComponent[],
): ComponentDiffRow[] {
  const storedByKey = new Map(stored.map((c) => [c.key, c]));
  const liveByKey = new Map(live.map((c) => [c.key, c]));
  const keys = Array.from(new Set([...storedByKey.keys(), ...liveByKey.keys()])).sort();
  return keys.map((key) => {
    const s = storedByKey.get(key) ?? null;
    const l = liveByKey.get(key) ?? null;
    return { key, stored: s, live: l, mismatch: classify(s, l) };
  });
}

export function hasAnyMismatch(rows: readonly ComponentDiffRow[]): boolean {
  return rows.some((row) => row.mismatch !== 'match');
}
