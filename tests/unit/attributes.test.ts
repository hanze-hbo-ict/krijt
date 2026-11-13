/** Milestone 2 commands: attribute editing, notation flags, ordering, move, copy, delete. */
import { describe, expect, it } from 'vitest'
import { NAME_RULE } from '../../src/model/names'
import { applyCommand, orderAttributeIds, type Command } from '../../src/commands/commands'
import { copyAttributes, moveAttributes } from '../../src/commands/builders'
import { emptyDocument, newAttribute, type KrijtDocument, type Reference, type Relation } from '../../src/model/types'
import { integrityProblem } from '../../src/model/validate'

const rel = (id: string, names: string[], y = 0): Relation => ({
  id,
  name: null,
  position: { x: 0, y },
  attributes: names.map((n) => newAttribute(`${id}.${n}`, n)),
})

function docWith(relations: Relation[], references: Reference[] = []): KrijtDocument {
  const doc = { ...emptyDocument(), relations, references }
  expect(integrityProblem(doc)).toBeNull()
  return doc
}

function apply(doc: KrijtDocument, cmd: Command | null) {
  if (!cmd) throw new Error('no command')
  const r = applyCommand(doc, cmd)
  if (!r.ok) throw new Error(r.error)
  expect(integrityProblem(r.doc)).toBeNull()
  return r
}

const names = (doc: KrijtDocument, id: string) => doc.relations.find((r) => r.id === id)?.attributes.map((a) => a.name)
const ref = (id: string, from: [string, string[]], to: [string, string[]]): Reference => ({
  id,
  from: { relationId: from[0], attributeIds: from[1] },
  to: { relationId: to[0], attributeIds: to[1] },
})

describe('rename and flags', () => {
  it('renames an attribute, trimming but otherwise verbatim, and refuses names with other characters', () => {
    const doc = docWith([rel('A', ['x'])])
    const { doc: next } = apply(doc, { type: 'renameAttribute', attributeId: 'A.x', name: '  Prijs-incl_btw ' })
    expect(names(next, 'A')).toEqual(['Prijs-incl_btw'])
    expect(applyCommand(doc, { type: 'renameAttribute', attributeId: 'A.x', name: 'Prijs (€)' })).toEqual({ ok: false, error: NAME_RULE })
    expect(applyCommand(doc, { type: 'renameAttribute', attributeId: 'A.x', name: ' ' }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'renameAttribute', attributeId: 'nope', name: 'y' }).ok).toBe(false)
  })

  it('toggling one flag changes only that flag, on all selected attributes, across tables', () => {
    let doc = docWith([rel('A', ['x', 'y']), rel('B', ['z'], 100)])
    doc = apply(doc, { type: 'setAttributeFlag', attributeIds: ['A.x', 'B.z'], flag: 'primaryKey', value: true }).doc
    doc = apply(doc, { type: 'setAttributeFlag', attributeIds: ['A.x'], flag: 'nullable', value: true }).doc
    doc = apply(doc, { type: 'setAttributeFlag', attributeIds: ['A.x'], flag: 'calculated', value: true }).doc
    const [x, y] = doc.relations[0]!.attributes
    // Questionable combinations (a nullable, calculated key) are kept, never corrected.
    expect(x).toMatchObject({ name: 'x', primaryKey: true, nullable: true, calculated: true })
    expect(y).toMatchObject({ primaryKey: false, nullable: false, calculated: false })
    expect(doc.relations[1]!.attributes[0]!.primaryKey).toBe(true)
    doc = apply(doc, { type: 'setAttributeFlag', attributeIds: ['A.x'], flag: 'nullable', value: false }).doc
    expect(doc.relations[0]!.attributes[0]).toMatchObject({ primaryKey: true, nullable: false, calculated: true })
  })

  it('supports composite keys: several primary-key attributes in one table', () => {
    let doc = docWith([rel('A', ['a', 'b', 'c'])])
    doc = apply(doc, { type: 'setAttributeFlag', attributeIds: ['A.a', 'A.b'], flag: 'primaryKey', value: true }).doc
    expect(doc.relations[0]!.attributes.map((a) => a.primaryKey)).toEqual([true, true, false])
  })
})

describe('ordering', () => {
  const doc = docWith([rel('A', ['a', 'b', 'c', 'd', 'e'])])

  it('shifts a single attribute and stops at the edge', () => {
    let d = apply(doc, { type: 'shiftAttributes', attributeIds: ['A.c'], delta: -1 }).doc
    expect(names(d, 'A')).toEqual(['a', 'c', 'b', 'd', 'e'])
    d = apply(d, { type: 'shiftAttributes', attributeIds: ['A.c'], delta: -1 }).doc
    expect(names(d, 'A')).toEqual(['c', 'a', 'b', 'd', 'e'])
    const atEdge = apply(d, { type: 'shiftAttributes', attributeIds: ['A.c'], delta: -1 })
    expect(atEdge.doc).toBe(d) // unchanged, so no undo step
  })

  it('shifts a block and scattered attributes together', () => {
    expect(names(apply(doc, { type: 'shiftAttributes', attributeIds: ['A.b', 'A.c'], delta: 1 }).doc, 'A')).toEqual(['a', 'd', 'b', 'c', 'e'])
    expect(names(apply(doc, { type: 'shiftAttributes', attributeIds: ['A.b', 'A.d'], delta: -1 }).doc, 'A')).toEqual(['b', 'a', 'd', 'c', 'e'])
  })
})

describe('move', () => {
  it('orders a cross-table selection by table, then attribute order', () => {
    const doc = docWith([rel('A', ['a', 'b', 'c']), rel('B', ['d', 'e'], 100)])
    expect(orderAttributeIds(doc, ['B.e', 'A.c', 'A.a', 'B.d'])).toEqual(['A.a', 'A.c', 'B.d', 'B.e'])
  })

  it('moves two attributes to empty canvas: one new table, same IDs, order preserved, sources removed', () => {
    const doc = docWith([rel('A', ['a', 'b', 'c', 'd'])])
    const { doc: next } = apply(doc, { type: 'moveAttributes', attributeIds: ['A.d', 'A.b'], destination: { kind: 'newTable', relationId: 'N', position: { x: 300.4, y: 50 } } })
    expect(names(next, 'A')).toEqual(['a', 'c'])
    expect(next.relations).toHaveLength(2)
    const created = next.relations[1]!
    expect(created).toMatchObject({ id: 'N', name: null, position: { x: 300, y: 50 } })
    expect(created.attributes.map((a) => a.id)).toEqual(['A.b', 'A.d'])
  })

  it('keeps notation flags on moved attributes', () => {
    let doc = docWith([rel('A', ['a', 'b']), rel('B', ['c'], 100)])
    doc = apply(doc, { type: 'setAttributeFlag', attributeIds: ['A.a'], flag: 'primaryKey', value: true }).doc
    doc = apply(doc, { type: 'moveAttributes', attributeIds: ['A.a'], destination: { kind: 'table', relationId: 'B' } }).doc
    expect(doc.relations[1]!.attributes[1]).toMatchObject({ id: 'A.a', primaryKey: true })
  })

  it('inserts at an index of the destination as it looks before the move', () => {
    const doc = docWith([rel('A', ['a', 'b', 'c', 'd', 'e'])])
    // Move a and b to "before e" (index 4): result c d a b e.
    const d1 = apply(doc, { type: 'moveAttributes', attributeIds: ['A.a', 'A.b'], destination: { kind: 'table', relationId: 'A', index: 4 } }).doc
    expect(names(d1, 'A')).toEqual(['c', 'd', 'a', 'b', 'e'])
    // Move e to the front.
    const d2 = apply(doc, { type: 'moveAttributes', attributeIds: ['A.e'], destination: { kind: 'table', relationId: 'A', index: 0 } }).doc
    expect(names(d2, 'A')).toEqual(['e', 'a', 'b', 'c', 'd'])
  })

  it('removes a table that becomes empty', () => {
    const doc = docWith([rel('A', ['a']), rel('B', ['b'], 100)])
    const r = apply(doc, { type: 'moveAttributes', attributeIds: ['A.a'], destination: { kind: 'table', relationId: 'B', index: 0 } })
    expect(r.doc.relations.map((x) => x.id)).toEqual(['B'])
    expect(names(r.doc, 'B')).toEqual(['a', 'b'])
  })

  it('moving all attributes of a table into itself is a reorder, not a removal', () => {
    const doc = docWith([rel('A', ['a', 'b'])])
    const r = apply(doc, { type: 'moveAttributes', attributeIds: ['A.a', 'A.b'], destination: { kind: 'table', relationId: 'A', index: 0 } })
    expect(names(r.doc, 'A')).toEqual(['a', 'b'])
  })

  it('references stay attached: an end that moves completely follows to the new table', () => {
    const doc = docWith([rel('A', ['id', 'x']), rel('B', ['fk1', 'fk2', 'y'], 100)], [ref('R', ['B', ['B.fk1', 'B.fk2']], ['A', ['A.id', 'A.x']])])
    const d = apply(doc, moveAttributes(['B.fk1', 'B.fk2'], { kind: 'newTable', relationId: 'N', position: { x: 0, y: 200 } })).doc
    expect(d.references[0]!.from).toEqual({ relationId: 'N', attributeIds: ['B.fk1', 'B.fk2'] })
    expect(d.references[0]!.to).toEqual({ relationId: 'A', attributeIds: ['A.id', 'A.x'] })
  })

  it('moves a whole reference end when one member moves, and says so', () => {
    const doc = docWith([rel('A', ['id', 'x']), rel('B', ['fk1', 'fk2'], 100)], [ref('R', ['B', ['B.fk1', 'B.fk2']], ['A', ['A.id', 'A.x']])])
    const r = applyCommand(doc, { type: 'moveAttributes', attributeIds: ['B.fk1'], destination: { kind: 'newTable', relationId: 'N', position: { x: 0, y: 0 } } })
    if (!r.ok) throw new Error(r.error)
    expect(r.doc.relations.map((x) => x.id)).toEqual(['A', 'N'])
    expect(r.doc.relations[1]!.attributes.map((a) => a.id)).toEqual(['B.fk1', 'B.fk2'])
    expect(r.doc.references[0]!.from).toEqual({ relationId: 'N', attributeIds: ['B.fk1', 'B.fk2'] })
  })

  it('rejects missing attributes and destinations', () => {
    const doc = docWith([rel('A', ['a'])])
    expect(applyCommand(doc, { type: 'moveAttributes', attributeIds: ['nope'], destination: { kind: 'table', relationId: 'A' } }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'moveAttributes', attributeIds: ['A.a'], destination: { kind: 'table', relationId: 'Z' } }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'moveAttributes', attributeIds: [], destination: { kind: 'table', relationId: 'A' } }).ok).toBe(false)
  })
})

describe('copy', () => {
  it('copies with new IDs and the same flags, without references; originals stay', () => {
    let doc = docWith([rel('A', ['id', 'x']), rel('B', ['fk'], 100)], [ref('R', ['B', ['B.fk']], ['A', ['A.id']])])
    doc = apply(doc, { type: 'setAttributeFlag', attributeIds: ['B.fk'], flag: 'nullable', value: true }).doc
    const copy = copyAttributes(doc, ['B.fk'], { kind: 'table', relationId: 'A' })!
    const next = apply(doc, copy.command).doc
    const copied = next.relations[0]!.attributes[2]!
    expect(copied.id).toBe(copy.newIds[0])
    expect(copied.id).not.toBe('B.fk')
    expect(copied).toMatchObject({ name: 'fk', nullable: true, primaryKey: false, calculated: false })
    expect(names(next, 'B')).toEqual(['fk'])
    expect(next.references).toEqual(doc.references) // no inherited foreign key
  })

  it('allows duplicate names in the destination', () => {
    const doc = docWith([rel('A', ['x'])])
    const copy = copyAttributes(doc, ['A.x'], { kind: 'table', relationId: 'A' })!
    expect(names(apply(doc, copy.command).doc, 'A')).toEqual(['x', 'x'])
  })

  it('copies a selection into a new table in document order', () => {
    const doc = docWith([rel('A', ['a', 'b', 'c'])])
    const copy = copyAttributes(doc, ['A.c', 'A.a'], { kind: 'newTable', relationId: 'N', position: { x: 0, y: 100 } })!
    expect(names(apply(doc, copy.command).doc, 'N')).toEqual(['a', 'c'])
  })

  it('rejects reused or mismatched IDs', () => {
    const doc = docWith([rel('A', ['a', 'b'])])
    const base = { type: 'copyAttributes' as const, attributeIds: ['A.a'], destination: { kind: 'table' as const, relationId: 'A' } }
    expect(applyCommand(doc, { ...base, newIds: ['A.b'] }).ok).toBe(false)
    expect(applyCommand(doc, { ...base, newIds: [] }).ok).toBe(false)
  })
})

describe('delete', () => {
  it('removes attributes, dangling references and empty tables in one step, and explains it', () => {
    const doc = docWith(
      [rel('A', ['id', 'x']), rel('B', ['fk'], 100), rel('C', ['only'], 200)],
      [ref('R', ['B', ['B.fk']], ['A', ['A.id']])],
    )
    const r = apply(doc, { type: 'deleteAttributes', attributeIds: ['A.id', 'C.only'] })
    expect(names(r.doc, 'A')).toEqual(['x'])
    expect(r.doc.relations.map((x) => x.id)).toEqual(['A', 'B'])
    expect(r.doc.references).toEqual([])
  })

  it('deleting a table removes its references', () => {
    const doc = docWith([rel('A', ['id']), rel('B', ['fk'], 100)], [ref('R', ['B', ['B.fk']], ['A', ['A.id']])])
    expect(apply(doc, { type: 'deleteRelation', relationId: 'A' }).doc.references).toEqual([])
  })
})
