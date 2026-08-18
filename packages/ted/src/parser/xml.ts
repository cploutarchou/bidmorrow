/**
 * Namespace-tolerant XML access helpers over fast-xml-parser output.
 *
 * Parsing strategy (documented per Phase 5 plan):
 * - fast-xml-parser 5.x (pure JS, no DOM — Workers/workerd compatible).
 * - `removeNSPrefix: true` makes navigation namespace-PREFIX-agnostic: we
 *   match on local names (`CustomizationID`, not `cbc:CustomizationID`), so
 *   notices using non-canonical prefixes still parse. On the extraction
 *   paths we use (docs/ted-data-source.md field map) local names are
 *   unambiguous across the UBL/eForms namespaces; where the same local name
 *   exists in different roles (e.g. `cbc:ID`) we disambiguate via the
 *   `schemeName` / `listName` attribute, exactly as the field map does.
 * - `parseTagValue/parseAttributeValue: false`: everything stays a string —
 *   no silent `"01"` → `1` coercion; numeric conversion is explicit.
 * - DTDs are rejected up front (TED notices never carry one) which removes
 *   the entity-expansion attack surface entirely.
 * - Adversarial text (script tags, HTML) is kept as inert plain text; text
 *   values are capped at MAX_TEXT_LENGTH to bound row size / memory against
 *   hostile or degenerate payloads. All scans are linear — no backtracking
 *   regexes (ReDoS-safe).
 */

import { XMLParser, XMLValidator } from 'fast-xml-parser';

/**
 * Cap for any single extracted text value (title, description, name…).
 * Rationale: D1 statements are limited to 100 KB and a hostile/degenerate
 * notice must not be able to balloon memory or storage; 100k chars is far
 * beyond any legitimate procurement text. Truncation is recorded as a
 * warning issue by callers — never silent data loss without a trace.
 */
export const MAX_TEXT_LENGTH = 100_000;

/** Parsed XML node: element children by local name, `#text`, `@_`-attributes. */
export type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  alwaysCreateTextNode: true,
  trimValues: true,
});

export interface XmlParseResult {
  readonly ok: boolean;
  /** Root element node (the document element), when ok. */
  readonly root: XmlNode | null;
  /** Local name of the document element, when ok. */
  readonly rootName: string | null;
  readonly error: string | null;
}

/** Validate well-formedness, reject DTDs, and parse to a node tree. */
export function parseXmlDocument(xml: string): XmlParseResult {
  // Linear scan; TED notices never declare a DTD. Rejecting it up front
  // removes billion-laughs / external-entity concerns wholesale.
  if (xml.toUpperCase().includes('<!DOCTYPE')) {
    return { ok: false, root: null, rootName: null, error: 'DTD (<!DOCTYPE) is not allowed' };
  }
  // fast-xml-parser is lenient by default (truncated XML can "parse");
  // XMLValidator gives the strict well-formedness check we need.
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    return {
      ok: false,
      root: null,
      rootName: null,
      error: `${validation.err.code}: ${validation.err.msg} (line ${String(validation.err.line)})`,
    };
  }
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch (cause) {
    return { ok: false, root: null, rootName: null, error: String(cause) };
  }
  if (typeof doc !== 'object' || doc === null) {
    return { ok: false, root: null, rootName: null, error: 'document did not parse to an object' };
  }
  for (const [name, value] of Object.entries(doc)) {
    if (name.startsWith('?')) {
      continue; // XML declaration / processing instructions
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return { ok: true, root: value as XmlNode, rootName: name, error: null };
    }
  }
  return { ok: false, root: null, rootName: null, error: 'no document element found' };
}

/** All element children with the given local name, normalized to an array. */
export function children(node: XmlNode | null, localName: string): XmlNode[] {
  if (node === null) {
    return [];
  }
  const value = node[localName];
  if (value === undefined || value === null) {
    return [];
  }
  const list = Array.isArray(value) ? value : [value];
  return list.filter((item): item is XmlNode => typeof item === 'object' && item !== null);
}

/** First element child with the given local name, or null. */
export function child(node: XmlNode | null, localName: string): XmlNode | null {
  return children(node, localName)[0] ?? null;
}

/** Walk a chain of single children by local name. */
export function descend(node: XmlNode | null, ...localNames: string[]): XmlNode | null {
  let current = node;
  for (const name of localNames) {
    current = child(current, name);
    if (current === null) {
      return null;
    }
  }
  return current;
}

/** Text content of a node (`#text`), capped at MAX_TEXT_LENGTH. Null when absent/empty. */
export function text(node: XmlNode | null): string | null {
  if (node === null) {
    return null;
  }
  const value = node['#text'];
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return value.length > MAX_TEXT_LENGTH ? value.slice(0, MAX_TEXT_LENGTH) : value;
}

/** Attribute value by local attribute name, or null. */
export function attr(node: XmlNode | null, name: string): string | null {
  if (node === null) {
    return null;
  }
  const value = node[`@_${name}`];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** True when any extracted text value hit the MAX_TEXT_LENGTH cap. */
export function wasTruncated(node: XmlNode | null): boolean {
  if (node === null) {
    return false;
  }
  const value = node['#text'];
  return typeof value === 'string' && value.length > MAX_TEXT_LENGTH;
}
