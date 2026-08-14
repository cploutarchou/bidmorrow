/**
 * Branded ID types for the core domain entities (docs/data-model.md).
 *
 * IDs are TEXT ULIDs in the database; at the type level each entity gets its
 * own brand so an OrganizationId can never be passed where a NoticeId is
 * expected. The brand exists only at compile time — at runtime these are
 * plain strings.
 */

declare const idBrand: unique symbol;

/** A string branded with the entity kind it identifies. */
export type Branded<B extends string> = string & { readonly [idBrand]: B };

export type OrganizationId = Branded<'OrganizationId'>;
export type NoticeId = Branded<'NoticeId'>;
export type LotId = Branded<'LotId'>;
export type MatchId = Branded<'MatchId'>;

function assertNonEmptyId(kind: string, value: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${kind} must be a non-empty string`);
  }
  return value;
}

export function organizationId(value: string): OrganizationId {
  return assertNonEmptyId('OrganizationId', value) as OrganizationId;
}

export function noticeId(value: string): NoticeId {
  return assertNonEmptyId('NoticeId', value) as NoticeId;
}

export function lotId(value: string): LotId {
  return assertNonEmptyId('LotId', value) as LotId;
}

export function matchId(value: string): MatchId {
  return assertNonEmptyId('MatchId', value) as MatchId;
}
