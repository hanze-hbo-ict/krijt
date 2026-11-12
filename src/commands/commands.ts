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
import { isValidName, NAME_RULE } from '../model/names'
import type { Attribute, Id, KrijtDocument, Point, Reference, ReferenceEnd, Relation, SourceField } from '../model/types'

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
  /** Ends are stored in table order: the i-th foreign-key attribute (left to right) refers to the i-th referenced one. */
  | { type: 'addReference'; reference: Reference }
  | { type: 'deleteReference'; referenceId: Id }
  /** New diagram: removes all tables and references, and also the form fields unless `keepFields`. */
  | { type: 'clearDocument'; keepFields: boolean }

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

/**
 * Reference ends are units: each end's attributes sit side by side in its
 * table and stay that way. These ranges (index [start, end], merged where ends
 * overlap) are what ← → shift as one block and what insertions never split.
 * Ends containing an attribute in `exclude` (the ones being moved) are left out.
 */
export function referenceBlocks(doc: KrijtDocument, relationId: Id, exclude?: ReadonlySet<Id>): [number, number][] {
  const r = doc.relations.find((x) => x.id === relationId)
  if (!r) return []
  const index = new Map(r.attributes.map((a, i) => [a.id, i]))
  const ranges: [number, number][] = []
  for (const ref of doc.references)
    for (const end of [ref.from, ref.to]) {
      if (end.relationId !== relationId || end.attributeIds.length < 2) continue
      if (exclude && end.attributeIds.some((id) => exclude.has(id))) continue
      const at = end.attributeIds.map((id) => index.get(id)).filter((i): i is number => i !== undefined)
      if (at.length) ranges.push([Math.min(...at), Math.max(...at)])
    }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const [a, b] of ranges) {
    const last = merged[merged.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else merged.push([a, b])
  }
  return merged
}

/** An insertion index that would land inside a block moves to the block's nearer edge (after it, on a tie). */
export function snapIndex(blocks: [number, number][], index: number): number {
  for (const [a, b] of blocks) if (a < index && index <= b) return index - a < b + 1 - index ? a : b + 1
  return index
}

function snapDestination(doc: KrijtDocument, dest: Destination, exclude?: ReadonlySet<Id>): Destination {
  if (dest.kind !== 'table' || dest.index === undefined) return dest
  return { ...dest, index: snapIndex(referenceBlocks(doc, dest.relationId, exclude), dest.index) }
}

/** The attributes plus every other member of any reference end they belong to (repeated for overlapping ends). */
export function expandToUnits(doc: KrijtDocument, ids: Iterable<Id>): Id[] {
  const set = new Set(ids)
  let grew = true
  while (grew) {
    grew = false
    for (const ref of doc.references)
      for (const end of [ref.from, ref.to])
        if (end.attributeIds.some((id) => set.has(id)) && !end.attributeIds.every((id) => set.has(id))) {
          end.attributeIds.forEach((id) => set.add(id))
          grew = true
        }
  }
  return orderAttributeIds(doc, set)
}

/** Whether the attributes are side by side (in one table). */
export function isContiguous(doc: KrijtDocument, ids: Id[]): boolean {
  if (ids.length < 2) return true
  for (const r of doc.relations) {
    const at = r.attributes.map((a, i) => (ids.includes(a.id) ? i : -1)).filter((i) => i >= 0)
    if (at.length === 0) continue
    return at.length === new Set(ids).size && at[at.length - 1]! - at[0]! === at.length - 1
  }
  return false
}

function isContiguousIn(list: Attribute[], ids: Id[]): boolean {
  const at = list.map((a, i) => (ids.includes(a.id) ? i : -1)).filter((i) => i >= 0)
  return at.length < 2 || at[at.length - 1]! - at[0]! === at.length - 1
}

/**
 * One shift step: each selected item swaps with an unselected neighbour in the direction `delta`; selected items
 * side by side move as one. Returns the new list, or null if nothing could move.
 */
function swapSelected<T>(items: T[], selected: (t: T) => boolean, delta: -1 | 1): T[] | null {
  const list = [...items]
  let changed = false
  const indices = list.map((_, i) => i)
  if (delta > 0) indices.reverse()
  for (const i of indices) {
    const j = i + delta
    if (j < 0 || j >= list.length) continue
    if (selected(list[i]!) && !selected(list[j]!)) {
      ;[list[i], list[j]] = [list[j]!, list[i]!]
      changed = true
    }
  }
  return changed ? list : null
}

export const REFERENCE_ADJACENT_ERROR =
  'The attributes of each end must be next to each other in their table. Put them side by side first (← →).'

/**
 * Why a reference cannot be created, or null if it can. Structure only: both
 * ends exist, each lies in one table, has no repeats and the same size as the
 * other, no attribute refers to itself, and each end's attributes are side by
 * side (the course convention, which keeps every end a movable unit). Keys and
 * names are never checked.
 */
export function referenceProblem(doc: KrijtDocument, from: ReferenceEnd, to: ReferenceEnd): string | null {
  const owner = new Map<Id, Id>()
  for (const r of doc.relations) for (const a of r.attributes) owner.set(a.id, r.id)
  if (from.attributeIds.length === 0) return 'Select the foreign-key attributes first.'
  if (to.attributeIds.length === 0) return 'Select the referenced attributes first.'
  for (const end of [from, to]) {
    if (new Set(end.attributeIds).size !== end.attributeIds.length) return 'An attribute can be used only once in each end of a reference.'
    if (!end.attributeIds.every((id) => owner.has(id))) return 'Those attributes no longer exist.'
    if (!end.attributeIds.every((id) => owner.get(id) === end.relationId)) return REFERENCE_ONE_TABLE_ERROR
  }
  if (from.attributeIds.length !== to.attributeIds.length)
    return `The foreign key has ${plural(from.attributeIds.length, 'attribute')}; select the same number of referenced attributes.`
  if (from.attributeIds.some((id) => to.attributeIds.includes(id))) return 'An attribute cannot refer to itself.'
  if (!isContiguous(doc, from.attributeIds) || !isContiguous(doc, to.attributeIds)) return REFERENCE_ADJACENT_ERROR
  return null
}

export const REFERENCE_ONE_TABLE_ERROR = 'Each end of a reference must lie within one table.'

const sameIds = (a: Id[], b: Id[]) => a.length === b.length && a.every((id, i) => id === b[i])

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
      const tableName = normalizeName(r.name)
      if (tableName !== null && !isValidName(tableName)) return fail(NAME_RULE)
      if (!r.attributes.every((a) => isValidName(a.name))) return fail(NAME_RULE)
      const relation: Relation = {
        id: r.id,
        name: tableName,
        position: { ...r.position },
        attributes: r.attributes.map((a) => ({ ...a })),
      }
      return ok({ ...doc, relations: [...doc.relations, relation] })
    }
    case 'addAttributes': {
      if (cmd.attributes.length === 0) return fail('No attributes to add.')
      if (!freshIds(doc, cmd.attributes.map((a) => a.id))) return fail('Attribute IDs are not unique.')
      if (!cmd.attributes.every((a) => isValidName(a.name))) return fail(NAME_RULE)
      const next = mapRelation(doc, cmd.relationId, (r) => {
        const attributes = [...r.attributes]
        const at = cmd.index === undefined ? undefined : snapIndex(referenceBlocks(doc, r.id), cmd.index)
        attributes.splice(clampIndex(at, attributes.length), 0, ...cmd.attributes.map((a) => ({ ...a })))
        return { ...r, attributes }
      })
      return next ? ok(next) : fail('That table no longer exists.')
    }
    case 'renameRelation': {
      const name = normalizeName(cmd.name)
      if (name !== null && !isValidName(name)) return fail(NAME_RULE)
      const next = mapRelation(doc, cmd.relationId, (r) => ({ ...r, name }))
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
      if (!isValidName(name)) return fail(NAME_RULE)
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
      const isSel = (a: Attribute) => attrs.set.has(a.id)
      let changed = false
      const relations = doc.relations.map((r) => {
        if (!r.attributes.some(isSel)) return r
        const blocks = referenceBlocks(doc, r.id)
        const ends = doc.references.flatMap((ref) => [ref.from, ref.to]).filter((e) => e.relationId === r.id)
        let attributes = [...r.attributes]
        // Blocks that move as a whole: fully selected ones, and partly selected ones whose selection cannot
        // move further inside (it reached the block's edge), so a press is never a dead key.
        const wholeBlocks = new Set<number>()
        blocks.forEach(([a, b], k) => {
          const slice = attributes.slice(a, b + 1)
          const count = slice.filter(isSel).length
          if (count === 0) return
          if (count === slice.length) {
            wholeBlocks.add(k)
            return
          }
          // Partly selected: reorder within the block, if every reference end stays side by side.
          const inner = swapSelected(slice, isSel, cmd.delta)
          if (!inner) return wholeBlocks.add(k)
          const trial = [...attributes.slice(0, a), ...inner, ...attributes.slice(b + 1)]
          if (!ends.every((e) => isContiguousIn(trial, e.attributeIds))) return wholeBlocks.add(k)
          attributes = trial
          changed = true
        })
        // Units: each block is one unit, every other attribute its own unit.
        const units: { attrs: Attribute[]; selected: boolean }[] = []
        for (let i = 0; i < attributes.length; ) {
          const k = blocks.findIndex(([a]) => a === i)
          if (k >= 0) {
            units.push({ attrs: attributes.slice(i, blocks[k]![1] + 1), selected: wholeBlocks.has(k) })
            i = blocks[k]![1] + 1
          } else {
            units.push({ attrs: [attributes[i]!], selected: isSel(attributes[i]!) })
            i++
          }
        }
        const moved = swapSelected(units, (u) => u.selected, cmd.delta)
        if (moved) {
          attributes = moved.flatMap((u) => u.attrs)
          changed = true
        }
        return { ...r, attributes }
      })
      if (!changed) return ok(doc)
      // Ends pair up left to right, so after reordering inside an end its stored order follows the table.
      const next = { ...doc, relations }
      const references = doc.references.map((ref) => ({
        ...ref,
        from: { ...ref.from, attributeIds: orderAttributeIds(next, ref.from.attributeIds) },
        to: { ...ref.to, attributeIds: orderAttributeIds(next, ref.to.attributeIds) },
      }))
      return ok({ ...next, references })
    }
    case 'moveAttributes': {
      if (!existingAttributes(doc, cmd.attributeIds)) return fail('Those attributes no longer exist.')
      // A reference end moves as a unit: moving one member brings the others along.
      const asked = new Set(cmd.attributeIds)
      const attrs = existingAttributes(doc, expandToUnits(doc, cmd.attributeIds))!
      const along = attrs.ordered.filter((id) => !asked.has(id))
      const dest = snapDestination(doc, cmd.destination, attrs.set)
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
      const byIdName = (id: Id) => byId.get(id)?.name || '(no name)'
      const notes = [
        along.length > 0 ? `Moved ${along.map(byIdName).join(', ')} along, to keep the reference together.` : undefined,
        emptiedTablesNotice(doc, relations),
      ].filter(Boolean)
      return ok({ ...doc, relations, references }, notes.length ? notes.join(' ') : undefined)
    }
    case 'copyAttributes': {
      const attrs = existingAttributes(doc, cmd.attributeIds)
      if (!attrs) return fail('Those attributes no longer exist.')
      if (cmd.newIds.length !== attrs.ordered.length) return fail('Copy IDs do not match the attributes.')
      const dest = snapDestination(doc, cmd.destination)
      const fresh = dest.kind === 'newTable' ? [...cmd.newIds, dest.relationId] : cmd.newIds
      if (!freshIds(doc, fresh)) return fail('Copy IDs are not unique.')
      const byId = attributeById(doc)
      const copies = attrs.ordered.map((id, i) => ({ ...byId.get(id)!, id: cmd.newIds[i]! }))
      const relations = placeAttributes(doc.relations, copies, dest)
      if (!relations) return fail('That table no longer exists.')
      return ok({ ...doc, relations })
    }
    case 'addReference': {
      const { id, from, to } = cmd.reference
      if (!freshIds(doc, [id])) return fail('Reference ID is not unique.')
      const problem = referenceProblem(doc, from, to)
      if (problem) return fail(problem)
      const f = orderAttributeIds(doc, from.attributeIds)
      const t = orderAttributeIds(doc, to.attributeIds)
      if (doc.references.some((ref) => sameIds(ref.from.attributeIds, f) && sameIds(ref.to.attributeIds, t)))
        return fail('That reference already exists.')
      // Ends are stored in table order: the pairing is left to right, as the diagram shows it.
      const reference: Reference = {
        id,
        from: { relationId: from.relationId, attributeIds: orderAttributeIds(doc, from.attributeIds) },
        to: { relationId: to.relationId, attributeIds: orderAttributeIds(doc, to.attributeIds) },
      }
      return ok({ ...doc, references: [...doc.references, reference] })
    }
    case 'clearDocument': {
      const sourceFields = cmd.keepFields ? doc.sourceFields : []
      if (doc.relations.length === 0 && doc.references.length === 0 && sourceFields.length === doc.sourceFields.length) return ok(doc)
      return ok({ format: 'krijt', version: 1, sourceFields, relations: [], references: [] })
    }
    case 'deleteReference': {
      if (!doc.references.some((ref) => ref.id === cmd.referenceId)) return fail('That reference no longer exists.')
      return ok({ ...doc, references: doc.references.filter((ref) => ref.id !== cmd.referenceId) })
    }
  }
}
