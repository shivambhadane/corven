import type { EntityKind, ResolutionResult } from "../types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the resolver can ask the registries. Every lookup is organization-scoped by the implementation. */
export interface EntityLookup {
  byExternalReference(type: EntityKind, ref: string): Promise<string | null>;
  byId(type: EntityKind, id: string): Promise<string | null>;
  byName(type: EntityKind, name: string): Promise<string | null>;
}

/**
 * Resolves a source's external reference to a REGISTERED entity of the expected
 * type, within one organization. Matches by external reference, then id, then
 * exact name. If different entities match through different routes the result is
 * "ambiguous" rather than a guess. Unknown references are "unresolved": an
 * unknown string never becomes a trusted entity.
 */
export async function resolveEntity(lookup: EntityLookup, type: EntityKind, reference: string): Promise<ResolutionResult> {
  const ref = reference.trim();
  if (!ref) return { status: "unresolved", reason: "Empty reference" };
  const found: Array<{ id: string; matchedBy: "external_reference" | "id" | "name" }> = [];
  const ext = await lookup.byExternalReference(type, ref);
  if (ext) found.push({ id: ext, matchedBy: "external_reference" });
  if (UUID.test(ref)) {
    const byId = await lookup.byId(type, ref);
    if (byId) found.push({ id: byId, matchedBy: "id" });
  }
  const byName = await lookup.byName(type, ref);
  if (byName) found.push({ id: byName, matchedBy: "name" });

  const distinct = new Set(found.map((f) => f.id));
  if (distinct.size === 0) return { status: "unresolved", reason: `No registered ${type} matches "${ref.slice(0, 80)}"` };
  if (distinct.size > 1) return { status: "ambiguous", reason: `"${ref.slice(0, 80)}" matches more than one registered ${type}` };
  return { status: "resolved", entity: found[0]! };
}

/** Per-run memo so a reference is looked up once. */
export function memoizeLookup(lookup: EntityLookup): EntityLookup {
  const cache = new Map<string, Promise<string | null>>();
  const wrap = (kind: string, fn: (t: EntityKind, v: string) => Promise<string | null>) => (t: EntityKind, v: string) => {
    const k = `${kind}|${t}|${v.toLowerCase()}`;
    return cache.get(k) ?? cache.set(k, fn(t, v)).get(k)!;
  };
  return { byExternalReference: wrap("x", lookup.byExternalReference), byId: wrap("i", lookup.byId), byName: wrap("n", lookup.byName) };
}
