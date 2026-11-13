/**
 * Structural validation of untrusted document data (from sessionStorage).
 *
 * This checks shape and integrity only: types, unique IDs, references that
 * point at existing attributes with matching group sizes. It never applies
 * normalization rules.
 */
import type { Attribute, KrijtDocument, Reference, ReferenceEnd, Relation, SourceField } from './types'

export const MAX_TEXT_LENGTH = 500
const MAX_ITEMS = 2000
const MAX_COORD = 1_000_000

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64
const isText = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_TEXT_LENGTH
const isCoord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_COORD

function parseSourceField(v: unknown): SourceField | null {
  if (!isObj(v) || !isId(v.id) || !isText(v.label)) return null
  if (v.ticked !== undefined && typeof v.ticked !== 'boolean') return null
  return v.ticked ? { id: v.id, label: v.label, ticked: true } : { id: v.id, label: v.label }
}

function parseAttribute(v: unknown): Attribute | null {
  if (!isObj(v) || !isId(v.id) || !isText(v.name)) return null
  if (typeof v.primaryKey !== 'boolean' || typeof v.nullable !== 'boolean' || typeof v.calculated !== 'boolean') return null
  return { id: v.id, name: v.name, primaryKey: v.primaryKey, nullable: v.nullable, calculated: v.calculated }
}

function parseRelation(v: unknown): Relation | null {
  if (!isObj(v) || !isId(v.id)) return null
  if (!(v.name === null || (isText(v.name) && v.name.trim() !== ''))) return null
  if (!isObj(v.position) || !isCoord(v.position.x) || !isCoord(v.position.y)) return null
  if (!Array.isArray(v.attributes) || v.attributes.length === 0 || v.attributes.length > MAX_ITEMS) return null
  const attributes: Attribute[] = []
  for (const a of v.attributes) {
    const parsed = parseAttribute(a)
    if (!parsed) return null
    attributes.push(parsed)
  }
  return { id: v.id, name: v.name, position: { x: v.position.x, y: v.position.y }, attributes }
}

function parseEnd(v: unknown): ReferenceEnd | null {
  if (!isObj(v) || !isId(v.relationId) || !Array.isArray(v.attributeIds)) return null
  if (v.attributeIds.length === 0 || !v.attributeIds.every(isId)) return null
  return { relationId: v.relationId, attributeIds: [...(v.attributeIds as string[])] }
}

function parseReference(v: unknown): Reference | null {
  if (!isObj(v) || !isId(v.id)) return null
  const from = parseEnd(v.from)
  const to = parseEnd(v.to)
  if (!from || !to) return null
  return { id: v.id, from, to }
}

function parseList<T>(v: unknown, parse: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v) || v.length > MAX_ITEMS) return null
  const out: T[] = []
  for (const item of v) {
    const parsed = parse(item)
    if (!parsed) return null
    out.push(parsed)
  }
  return out
}

/** Returns a problem description, or null if the document is structurally sound. */
export function integrityProblem(doc: KrijtDocument): string | null {
  const seen = new Set<string>()
  const unique = (id: string) => {
    if (seen.has(id)) return false
    seen.add(id)
    return true
  }
  for (const f of doc.sourceFields) if (!unique(f.id)) return `duplicate id ${f.id}`
  const attributeOwner = new Map<string, string>()
  for (const r of doc.relations) {
    if (!unique(r.id)) return `duplicate id ${r.id}`
    if (r.attributes.length === 0) return `relation ${r.id} has no attributes`
    for (const a of r.attributes) {
      if (!unique(a.id)) return `duplicate id ${a.id}`
      attributeOwner.set(a.id, r.id)
    }
  }
  for (const ref of doc.references) {
    if (!unique(ref.id)) return `duplicate id ${ref.id}`
    if (ref.from.attributeIds.length !== ref.to.attributeIds.length) return `reference ${ref.id} has unequal ends`
    for (const end of [ref.from, ref.to]) {
      if (new Set(end.attributeIds).size !== end.attributeIds.length) return `reference ${ref.id} repeats an attribute`
      for (const id of end.attributeIds) {
        if (attributeOwner.get(id) !== end.relationId) return `reference ${ref.id} points at a missing attribute`
      }
    }
  }
  return null
}

/** Parses untrusted data into a document, or returns null if it is unusable. */
export function parseDocument(v: unknown): KrijtDocument | null {
  if (!isObj(v) || v.format !== 'krijt' || v.version !== 1) return null
  const sourceFields = parseList(v.sourceFields, parseSourceField)
  const relations = parseList(v.relations, parseRelation)
  const references = parseList(v.references, parseReference)
  if (!sourceFields || !relations || !references) return null
  const doc: KrijtDocument = { format: 'krijt', version: 1, sourceFields, relations, references }
  return integrityProblem(doc) === null ? doc : null
}
