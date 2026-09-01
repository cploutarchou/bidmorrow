/**
 * Client-side mirror of the ingestion CPV-scope validator
 * (apps/worker/src/routes/admin.ts `ingestionScopeSchema`,
 * `MAX_SCOPE_FAMILIES`): immediate feedback only; the server independently
 * re-validates through `parseIngestionScope` before persisting.
 */
const MAX_SCOPE_FAMILIES = 20;

export interface ScopeValidation {
  readonly valid: boolean;
  readonly error: string | null;
}

export function validateCpvScope(
  cpvFamilies: readonly string[],
  countries: readonly string[],
): ScopeValidation {
  if (cpvFamilies.length === 0) {
    return { valid: false, error: 'At least one CPV family is required.' };
  }
  if (cpvFamilies.length > MAX_SCOPE_FAMILIES) {
    return {
      valid: false,
      error: `CPV families are bounded to ${String(MAX_SCOPE_FAMILIES)} (has ${String(cpvFamilies.length)}).`,
    };
  }
  for (const family of cpvFamilies) {
    if (family.trim().length < 2 || family.trim().length > 8) {
      return { valid: false, error: `"${family}" must be 2-8 characters.` };
    }
  }
  for (const country of countries) {
    if (country.trim().length !== 2) {
      return { valid: false, error: `"${country}" must be a 2-letter country code.` };
    }
  }
  return { valid: true, error: null };
}
