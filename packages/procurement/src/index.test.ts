import { describe, expect, it } from 'vitest';

import { INGESTION_RUN_STATUSES, PACKAGE } from './index';
import type { IngestionRunStatus } from './index';

describe('@bidmorrow/procurement skeleton', () => {
  it('exports its package name', () => {
    expect(PACKAGE).toBe('@bidmorrow/procurement');
  });

  it('owns the ingestion_runs.status vocabulary from docs/data-model.md', () => {
    expect(INGESTION_RUN_STATUSES).toEqual(['running', 'succeeded', 'partial', 'failed']);
    expect(new Set(INGESTION_RUN_STATUSES).size).toBe(INGESTION_RUN_STATUSES.length);

    const terminal: IngestionRunStatus = 'partial';
    expect(INGESTION_RUN_STATUSES).toContain(terminal);
  });
});
