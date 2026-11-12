/**
 * Pure edit commands on a KrijtDocument.
 *
 * A command is plain data and carries every ID it introduces, so applying it is
 * deterministic: the same command on the same document gives the same result.
 * (That is what undo/redo in Milestone 2 will build on: one dispatched command
 * is one history step.) Builders in builders.ts generate the IDs.
 *
 * Commands check structural preconditions only (things exist, IDs are unique).
 * They never apply normalization rules.
 */
import type { Attribute, Id, KrijtDocument, Point, Relation, SourceField } from '../model/types'

export type Command =
  | { type: 'addSourceFields'; fields: SourceField[]; index?: number }
  | { type: 'renameSourceField'; fieldId: Id; label: string }
  | { type: 'deleteSourceField'; fieldId: Id }
  | { type: 'createRelation'; relation: Relation }
  | { type: 'addAttributes'; relationId: Id; attributes: Attribute[]; index?: number }
  | { type: 'renameRelation'; relationId: Id; name: string | null }
  | { type: 'moveRelation'; relationId: Id; position: Point }
  | { type: 'deleteRelation'; relationId: Id }

export type CommandResult = { ok: true; doc: KrijtDocument } | { ok: false; error: string }

const fail = (error: string): CommandResult => ({ ok: false, error })
const ok = (doc: KrijtDocument): CommandResult => ({ ok: true, doc })

function allIds(doc: KrijtDocument): Set<Id> {
  const ids = new Set<Id>()
  for (const f of doc.sourceFields) ids.add(f.id)
  for (const r of doc.relations) {
    ids.add(r.id)
    for (const a of r.attributes) ids.add(a.id)
  }
  for (const ref of doc.references) ids.add(ref.id)
  return ids
}

function freshIds(doc: KrijtDocument, ids: Id[]): boolean {
  const existing = allIds(doc)
  const seen = new Set<Id>()
  for (const id of ids) {
    if (!id || existing.has(id) || seen.has(id)) return false
    seen.add(id)
  }
  return true
}

function clampIndex(index: number | undefined, length: number): number {
  if (index === undefined || !Number.isInteger(index)) return length
  return Math.max(0, Math.min(length, index))
}

/** Blank names mean "unnamed"; otherwise the name is kept as typed, apart from surrounding whitespace. */
export function normalizeName(name: string | null): string | null {
  if (name === null) return null
  const trimmed = name.trim()
  return trimmed === '' ? null : trimmed
}

function mapRelation(doc: KrijtDocument, relationId: Id, f: (r: Relation) => Relation): KrijtDocument | null {
  let found = false
  const relations = doc.relations.map((r) => {
    if (r.id !== relationId) return r
    found = true
    return f(r)
  })
  return found ? { ...doc, relations } : null
}

export function applyCommand(doc: KrijtDocument, cmd: Command): CommandResult {
  switch (cmd.type) {
    case 'addSourceFields': {
      if (cmd.fields.length === 0) return fail('No fields to add.')
      if (!freshIds(doc, cmd.fields.map((f) => f.id))) return fail('Field IDs are not unique.')
      const at = clampIndex(cmd.index, doc.sourceFields.length)
      const sourceFields = [...doc.sourceFields]
      sourceFields.splice(at, 0, ...cmd.fields.map((f) => ({ ...f })))
      return ok({ ...doc, sourceFields })
    }
    case 'renameSourceField': {
      if (!doc.sourceFields.some((f) => f.id === cmd.fieldId)) return fail('That field no longer exists.')
      const label = cmd.label.trim()
      if (label === '') return fail('A field needs a name.')
      return ok({ ...doc, sourceFields: doc.sourceFields.map((f) => (f.id === cmd.fieldId ? { ...f, label } : f)) })
    }
    case 'deleteSourceField': {
      if (!doc.sourceFields.some((f) => f.id === cmd.fieldId)) return fail('That field no longer exists.')
      return ok({ ...doc, sourceFields: doc.sourceFields.filter((f) => f.id !== cmd.fieldId) })
    }
    case 'createRelation': {
      const r = cmd.relation
      if (r.attributes.length === 0) return fail('A table needs at least one attribute.')
      if (!freshIds(doc, [r.id, ...r.attributes.map((a) => a.id)])) return fail('IDs are not unique.')
      const relation: Relation = {
        id: r.id,
        name: normalizeName(r.name),
        position: { ...r.position },
        attributes: r.attributes.map((a) => ({ ...a })),
      }
      return ok({ ...doc, relations: [...doc.relations, relation] })
    }
    case 'addAttributes': {
      if (cmd.attributes.length === 0) return fail('No attributes to add.')
      if (!freshIds(doc, cmd.attributes.map((a) => a.id))) return fail('Attribute IDs are not unique.')
      const next = mapRelation(doc, cmd.relationId, (r) => {
        const attributes = [...r.attributes]
        attributes.splice(clampIndex(cmd.index, attributes.length), 0, ...cmd.attributes.map((a) => ({ ...a })))
        return { ...r, attributes }
      })
      return next ? ok(next) : fail('That table no longer exists.')
    }
    case 'renameRelation': {
      const next = mapRelation(doc, cmd.relationId, (r) => ({ ...r, name: normalizeName(cmd.name) }))
      return next ? ok(next) : fail('That table no longer exists.')
    }
    case 'moveRelation': {
      const { x, y } = cmd.position
      if (!Number.isFinite(x) || !Number.isFinite(y)) return fail('Invalid position.')
      const next = mapRelation(doc, cmd.relationId, (r) => ({ ...r, position: { x: Math.round(x), y: Math.round(y) } }))
      return next ? ok(next) : fail('That table no longer exists.')
    }
    case 'deleteRelation': {
      if (!doc.relations.some((r) => r.id === cmd.relationId)) return fail('That table no longer exists.')
      return ok({
        ...doc,
        relations: doc.relations.filter((r) => r.id !== cmd.relationId),
        // References touching the table go in the same step.
        references: doc.references.filter((ref) => ref.from.relationId !== cmd.relationId && ref.to.relationId !== cmd.relationId),
      })
    }
  }
}
