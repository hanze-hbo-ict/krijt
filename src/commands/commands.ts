/**
 * Pure edit commands on a KrijtDocument.
 *
 * A command is plain data and carries every ID it introduces, so applying it is
 * deterministic: the same command on the same document gives the same result.
 * One dispatched command is one undo step, so an edit with dependent changes
 * (a move that empties and removes a table and re-attaches references) is a
 * single command. Builders in builders.ts generate the IDs.
 *
 * Commands check structural preconditions only (things exist, IDs are unique,
 * references stay well-formed). They never apply normalization rules.
 */
import type { Attribute, Id, KrijtDocument, Point, Reference, Relation, SourceField } from '../model/types'

export type AttributeFlag = 'primaryKey' | 'nullable' | 'calculated'

/** Where moved, copied or placed attributes go. `relationId` of a new table is fresh. */
export type Destination = { kind: 'table'; relationId: Id; index?: number } | { kind: 'newTable'; relationId: Id; position: Point }

export type Command =
  | { type: 'addSourceFields'; fields: SourceField[]; index?: number }
  | { type: 'renameSourceField'; fieldId: Id; label: string }
  | { type: 'deleteSourceField'; fieldId: Id }
  | { type: 'createRelation'; relation: Relation }
  | { type: 'addAttributes'; relationId: Id; attributes: Attribute[]; index?: number }
  | { type: 'renameRelation'; relationId: Id; name: string | null }
  | { type: 'moveRelation'; relationId: Id; position: Point }
  | { type: 'deleteRelation'; relationId: Id }
  | { type: 'renameAttribute'; attributeId: Id; name: string }
  | { type: 'setAttributeFlag'; attributeIds: Id[]; flag: AttributeFlag; value: boolean }
  | { type: 'deleteAttributes'; attributeIds: Id[] }
  /** Shift each selected attribute one place left (-1) or right (+1) within its own table. */
  | { type: 'shiftAttributes'; attributeIds: Id[]; delta: -1 | 1 }
  /** Move keeps attribute IDs, so references stay attached. */
  | { type: 'moveAttributes'; attributeIds: Id[]; destination: Destination }
  /** Copies get new IDs (`newIds[i]` for the i-th attribute in document order) and no references. */
  | { type: 'copyAttributes'; attributeIds: Id[]; newIds: Id[]; destination: Destination }

/** `notice` tells the student about dependent changes, e.g. references removed with an attribute. */
export type CommandResult = { ok: true; doc: KrijtDocument; notice?: string } | { ok: false; error: string }

const fail = (error: string): CommandResult => ({ ok: false, error })
const ok = (doc: KrijtDocument, notice?: string): CommandResult => (notice ? { ok: true, doc, notice } : { ok: true, doc })

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const SPLIT_REFERENCE_ERROR =
  'That would split a reference between two tables. Move all attributes of the reference together, or delete the reference first.'

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

/**
 * The given attribute IDs in deterministic order: tables in document order,
 * then attribute order within each table. Unknown IDs and duplicates are dropped.
 */
export function orderAttributeIds(doc: KrijtDocument, ids: Iterable<Id>): Id[] {
  const wanted = new Set(ids)
  const out: Id[] = []
  for (const r of doc.relations) for (const a of r.attributes) if (wanted.has(a.id)) out.push(a.id)
  return out
}

/** Resolves and validates a set of attribute IDs; null if empty or any is missing. */
function existingAttributes(doc: KrijtDocument, ids: Id[]): { ordered: Id[]; set: Set<Id> } | null {
  const set = new Set(ids)
  if (set.size === 0) return null
  const ordered = orderAttributeIds(doc, set)
  return ordered.length === set.size ? { ordered, set } : null
}

function attributeById(doc: KrijtDocument): Map<Id, Attribute> {
  const map = new Map<Id, Attribute>()
  for (const r of doc.relations) for (const a of r.attributes) map.set(a.id, a)
  return map
}

/** Inserts attributes into the destination; drops tables left empty. */
function placeAttributes(relations: Relation[], attributes: Attribute[], destination: Destination, adjustIndex = 0): Relation[] | null {
  let out: Relation[]
  if (destination.kind === 'table') {
    if (!relations.some((r) => r.id === destination.relationId)) return null
    out = relations.map((r) => {
      if (r.id !== destination.relationId) return r
      const list = [...r.attributes]
      const at = clampIndex(destination.index === undefined ? undefined : destination.index - adjustIndex, list.length)
      list.splice(at, 0, ...attributes)
      return { ...r, attributes: list }
    })
  } else {
    const { x, y } = destination.position
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    out = [...relations, { id: destination.relationId, name: null, position: { x: Math.round(x), y: Math.round(y) }, attributes }]
  }
  return out.filter((r) => r.attributes.length > 0)
}

function emptiedTablesNotice(before: KrijtDocument, after: Relation[]): string | undefined {
  const remaining = new Set(after.map((r) => r.id))
  const removed = before.relations.filter((r) => !remaining.has(r.id)).length
  return removed > 0 ? `${plural(removed, 'empty table')} removed.` : undefined
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
      const r = doc.relations.find((x) => x.id === cmd.relationId)
      if (!r) return fail('That table no longer exists.')
      const references = doc.references.filter((ref) => ref.from.relationId !== cmd.relationId && ref.to.relationId !== cmd.relationId)
      const removedRefs = doc.references.length - references.length
      return ok(
        { ...doc, relations: doc.relations.filter((x) => x.id !== cmd.relationId), references },
        removedRefs > 0 ? `${plural(removedRefs, 'reference')} removed with the table.` : undefined,
      )
    }
    case 'renameAttribute': {
      const name = cmd.name.trim()
      if (name === '') return fail('An attribute needs a name.')
      let found = false
      const relations = doc.relations.map((r) =>
        r.attributes.some((a) => a.id === cmd.attributeId)
          ? {
              ...r,
              attributes: r.attributes.map((a) => {
                if (a.id !== cmd.attributeId) return a
                found = true
                return { ...a, name }
              }),
            }
          : r,
      )
      return found ? ok({ ...doc, relations }) : fail('That attribute no longer exists.')
    }
    case 'setAttributeFlag': {
      const attrs = existingAttributes(doc, cmd.attributeIds)
      if (!attrs) return fail('Those attributes no longer exist.')
      // Only the named flag changes; combinations are never corrected.
      const relations = doc.relations.map((r) =>
        r.attributes.some((a) => attrs.set.has(a.id))
          ? { ...r, attributes: r.attributes.map((a) => (attrs.set.has(a.id) ? { ...a, [cmd.flag]: cmd.value } : a)) }
          : r,
      )
      return ok({ ...doc, relations })
    }
    case 'deleteAttributes': {
      const attrs = existingAttributes(doc, cmd.attributeIds)
      if (!attrs) return fail('Those attributes no longer exist.')
      const relations = doc.relations
        .map((r) => ({ ...r, attributes: r.attributes.filter((a) => !attrs.set.has(a.id)) }))
        .filter((r) => r.attributes.length > 0)
      const touches = (ref: Reference) => [...ref.from.attributeIds, ...ref.to.attributeIds].some((id) => attrs.set.has(id))
      const references = doc.references.filter((ref) => !touches(ref))
      const removedRefs = doc.references.length - references.length
      const parts = [`Deleted ${plural(attrs.ordered.length, 'attribute')}`]
      if (removedRefs > 0) parts.push(`and ${plural(removedRefs, 'reference')} that used ${attrs.ordered.length === 1 ? 'it' : 'them'}`)
      let notice = parts.join(' ') + '.'
      const emptied = emptiedTablesNotice(doc, relations)
      if (emptied) notice += ` ${emptied}`
      return ok({ ...doc, relations, references }, notice)
    }
    case 'shiftAttributes': {
      const attrs = existingAttributes(doc, cmd.attributeIds)
      if (!attrs) return fail('Those attributes no longer exist.')
      let changed = false
      const relations = doc.relations.map((r) => {
        if (!r.attributes.some((a) => attrs.set.has(a.id))) return r
        const list = [...r.attributes]
        // Each selected attribute swaps with an unselected neighbour; a selected block moves as one.
        const indices = list.map((_, i) => i)
        if (cmd.delta > 0) indices.reverse()
        for (const i of indices) {
          const j = i + cmd.delta
          if (j < 0 || j >= list.length) continue
          if (attrs.set.has(list[i]!.id) && !attrs.set.has(list[j]!.id)) {
            ;[list[i], list[j]] = [list[j]!, list[i]!]
            changed = true
          }
        }
        return { ...r, attributes: list }
      })
      return changed ? ok({ ...doc, relations }) : ok(doc)
    }
    case 'moveAttributes': {
      const attrs = existingAttributes(doc, cmd.attributeIds)
      if (!attrs) return fail('Those attributes no longer exist.')
      const dest = cmd.destination
      if (dest.kind === 'newTable' && !freshIds(doc, [dest.relationId])) return fail('Table ID is not unique.')
      const destRelationId = dest.relationId
      // A reference end must stay within one table: all of its attributes move, or none.
      for (const ref of doc.references) {
        for (const end of [ref.from, ref.to]) {
          const moving = end.attributeIds.filter((id) => attrs.set.has(id)).length
          if (moving > 0 && moving < end.attributeIds.length) return fail(SPLIT_REFERENCE_ERROR)
        }
      }
      const byId = attributeById(doc)
      const moved = attrs.ordered.map((id) => byId.get(id)!)
      // The index refers to the destination as it is now; moved attributes before it no longer count.
      let adjust = 0
      if (dest.kind === 'table' && dest.index !== undefined) {
        const target = doc.relations.find((r) => r.id === dest.relationId)
        if (target) adjust = target.attributes.slice(0, dest.index).filter((a) => attrs.set.has(a.id)).length
      }
      const stripped = doc.relations.map((r) =>
        r.attributes.some((a) => attrs.set.has(a.id)) ? { ...r, attributes: r.attributes.filter((a) => !attrs.set.has(a.id)) } : r,
      )
      const relations = placeAttributes(stripped, moved, dest, adjust)
      if (!relations) return fail('That table no longer exists.')
      const references = doc.references.map((ref) => {
        const moveEnd = (end: Reference['from']) =>
          end.attributeIds.every((id) => attrs.set.has(id)) ? { ...end, relationId: destRelationId } : end
        return { ...ref, from: moveEnd(ref.from), to: moveEnd(ref.to) }
      })
      return ok({ ...doc, relations, references }, emptiedTablesNotice(doc, relations))
    }
    case 'copyAttributes': {
      const attrs = existingAttributes(doc, cmd.attributeIds)
      if (!attrs) return fail('Those attributes no longer exist.')
      if (cmd.newIds.length !== attrs.ordered.length) return fail('Copy IDs do not match the attributes.')
      const dest = cmd.destination
      const fresh = dest.kind === 'newTable' ? [...cmd.newIds, dest.relationId] : cmd.newIds
      if (!freshIds(doc, fresh)) return fail('Copy IDs are not unique.')
      const byId = attributeById(doc)
      const copies = attrs.ordered.map((id, i) => ({ ...byId.get(id)!, id: cmd.newIds[i]! }))
      const relations = placeAttributes(doc.relations, copies, dest)
      if (!relations) return fail('That table no longer exists.')
      return ok({ ...doc, relations })
    }
  }
}
