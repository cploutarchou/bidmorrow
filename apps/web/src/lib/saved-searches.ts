import { api, ApiError } from './api';

/**
 * Saved searches — named feed filter sets, shared across the workspace.
 *
 * The shape mirrors the feed's own filter state exactly, so applying a saved
 * search is a plain state assignment rather than a translation step that
 * could drift from what the feed actually queries.
 */

export type SavedSearchTab =
  'today' | 'strong' | 'worth_reviewing' | 'possible' | 'saved' | 'ignored';

export interface SavedSearch {
  readonly id: string;
  readonly name: string;
  readonly tab: SavedSearchTab;
  /** Only the filters that were actually set; empty values are never stored. */
  readonly filters: Readonly<Record<string, string>>;
  readonly createdAt: number;
}

export async function listSavedSearches(): Promise<SavedSearch[]> {
  const response = await api.get<{ savedSearches: SavedSearch[] }>('/api/org/saved-searches');
  return response.savedSearches;
}

export class DuplicateSavedSearchName extends Error {
  constructor() {
    super('A saved search with that name already exists.');
    this.name = 'DuplicateSavedSearchName';
  }
}

export async function createSavedSearch(args: {
  name: string;
  tab: SavedSearchTab;
  filters: Record<string, string>;
}): Promise<SavedSearch> {
  try {
    const response = await api.post<{ savedSearch: SavedSearch }>('/api/org/saved-searches', args);
    return response.savedSearch;
  } catch (cause) {
    // A 409 here is not a failure the user should see as "something went
    // wrong" — it means the name is taken, which is actionable.
    if (cause instanceof ApiError && cause.status === 409) {
      throw new DuplicateSavedSearchName();
    }
    throw cause;
  }
}

export async function deleteSavedSearch(id: string): Promise<void> {
  await api.delete(`/api/org/saved-searches/${id}`);
}
