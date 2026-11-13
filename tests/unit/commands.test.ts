import { describe, expect, it } from 'vitest'
import { applyCommand, type Command } from '../../src/commands/commands'
import { addAttributesFromNames, addSourceFields, createRelationFromNames, orderedFieldLabels, parseFieldList } from '../../src/commands/builders'
import { emptyDocument, newAttribute, type KrijtDocument } from '../../src/model/types'
import { integrityProblem } from '../../src/model/validate'

function apply(doc: KrijtDocument, cmd: Command | null): KrijtDocument {
  if (!cmd) throw new Error('no command')
  const r = applyCommand(doc, cmd)
  if (!r.ok) throw new Error(r.error)
  expect(integrityProblem(r.doc)).toBeNull()
  return r.doc
}

function withFields(labels: string[]): KrijtDocument {
  return apply(emptyDocument(), addSourceFields(labels))
}

describe('parseFieldList', () => {
  it('trims, drops blank lines, keeps order and duplicates', () => {
    expect(parseFieldList('  Klantnummer \n\n\tNaam\r\nNaam\r\n   \nPlaats')).toEqual(['Klantnummer', 'Naam', 'Naam', 'Plaats'])
  })
  it('keeps diacritics, punctuation and long names verbatim', () => {
    const long = 'Omschrijving van het geleverde artikel inclusief verpakking'
    expect(parseFieldList(`Café\nÉén/twee\n<b>x</b>\n${long}`)).toEqual(['Café', 'Één/twee', '<b>x</b>', long])
  })
  it('handles old Mac line endings and empty input', () => {
    expect(parseFieldList('a\rb')).toEqual(['a', 'b'])
    expect(parseFieldList('\n \n')).toEqual([])
  })
})

describe('source fields', () => {
  it('adds fields in order with unique IDs', () => {
    const doc = withFields(['a', 'b', 'a'])
    expect(doc.sourceFields.map((f) => f.label)).toEqual(['a', 'b', 'a'])
    expect(new Set(doc.sourceFields.map((f) => f.id)).size).toBe(3)
  })
  it('renames and deletes without touching anything else', () => {
    let doc = withFields(['a', 'b'])
    const [a, b] = doc.sourceFields
    doc = apply(doc, { type: 'renameSourceField', fieldId: a!.id, label: '  A1 ' })
    expect(doc.sourceFields[0]).toEqual({ id: a!.id, label: 'A1' })
    doc = apply(doc, { type: 'deleteSourceFields', fieldIds: [b!.id] })
    expect(doc.sourceFields).toEqual([{ id: a!.id, label: 'A1' }])
  })
  it('rejects a blank rename and unknown fields', () => {
    const doc = withFields(['a'])
    expect(applyCommand(doc, { type: 'renameSourceField', fieldId: doc.sourceFields[0]!.id, label: '  ' }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'deleteSourceFields', fieldIds: ['nope'] }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'setSourceFieldsTicked', fieldIds: ['nope'], value: true }).ok).toBe(false)
  })
  it('deletes several fields at once', () => {
    let doc = withFields(['a', 'b', 'c'])
    const [a, , c] = doc.sourceFields
    doc = apply(doc, { type: 'deleteSourceFields', fieldIds: [c!.id, a!.id] })
    expect(doc.sourceFields.map((f) => f.label)).toEqual(['b'])
  })
  it('ticks and unticks fields; an unticked field carries no flag', () => {
    let doc = withFields(['a', 'b'])
    const [a, b] = doc.sourceFields
    doc = apply(doc, { type: 'setSourceFieldsTicked', fieldIds: [a!.id, b!.id], value: true })
    expect(doc.sourceFields.map((f) => f.ticked)).toEqual([true, true])
    doc = apply(doc, { type: 'setSourceFieldsTicked', fieldIds: [a!.id], value: false })
    expect(doc.sourceFields[0]).toEqual({ id: a!.id, label: 'a' })
    expect(doc.sourceFields[1]).toEqual({ id: b!.id, label: 'b', ticked: true })
  })
  it('rejects reused IDs', () => {
    const doc = withFields(['a'])
    const r = applyCommand(doc, { type: 'addSourceFields', fields: [{ id: doc.sourceFields[0]!.id, label: 'x' }] })
    expect(r.ok).toBe(false)
  })
  it('ignores empty labels in the builder', () => {
    expect(addSourceFields(['', '  '])).toBeNull()
  })
})

describe('placing fields into tables', () => {
  it('orders selected fields by inventory order, not click order', () => {
    const doc = withFields(['a', 'b', 'c', 'd'])
    const [a, , c, d] = doc.sourceFields
    expect(orderedFieldLabels(doc, [d!.id, a!.id, c!.id])).toEqual(['a', 'c', 'd'])
  })

  it('creates an unnamed table of independent attribute copies; the inventory is unchanged', () => {
    let doc = withFields(['Klantnr', 'Naam'])
    const before = doc.sourceFields
    doc = apply(doc, createRelationFromNames(['Klantnr', 'Naam'], { x: 10.4, y: 20.6 }))
    expect(doc.sourceFields).toBe(before)
    const r = doc.relations[0]!
    expect(r.name).toBeNull()
    expect(r.position).toEqual({ x: 10, y: 21 })
    expect(r.attributes.map((a) => a.name)).toEqual(['Klantnr', 'Naam'])
    expect(r.attributes.every((a) => !a.primaryKey && !a.nullable && !a.calculated)).toBe(true)
    // Attributes do not share IDs with the source fields they came from.
    const fieldIds = new Set(doc.sourceFields.map((f) => f.id))
    expect(r.attributes.some((a) => fieldIds.has(a.id))).toBe(false)
  })

  it('renaming or deleting a source field leaves placed attributes alone', () => {
    let doc = withFields(['Naam'])
    doc = apply(doc, createRelationFromNames(['Naam'], { x: 0, y: 0 }))
    const f = doc.sourceFields[0]!
    doc = apply(doc, { type: 'renameSourceField', fieldId: f.id, label: 'Achternaam' })
    doc = apply(doc, { type: 'deleteSourceFields', fieldIds: [f.id] })
    expect(doc.relations[0]!.attributes[0]!.name).toBe('Naam')
  })

  it('appends to an existing table, or inserts at an index', () => {
    let doc = apply(emptyDocument(), createRelationFromNames(['a', 'b'], { x: 0, y: 0 }))
    const id = doc.relations[0]!.id
    doc = apply(doc, addAttributesFromNames(id, ['c', 'c']))
    doc = apply(doc, addAttributesFromNames(id, ['x'], 1))
    expect(doc.relations[0]!.attributes.map((a) => a.name)).toEqual(['a', 'x', 'b', 'c', 'c'])
  })

  it('refuses empty tables and unknown destinations', () => {
    expect(createRelationFromNames([], { x: 0, y: 0 })).toBeNull()
    const r = applyCommand(emptyDocument(), { type: 'createRelation', relation: { id: 'r1', name: null, position: { x: 0, y: 0 }, attributes: [] } })
    expect(r.ok).toBe(false)
    expect(applyCommand(emptyDocument(), addAttributesFromNames('missing', ['a'])!).ok).toBe(false)
  })
})

describe('tables', () => {
  const base = () => apply(emptyDocument(), createRelationFromNames(['a'], { x: 0, y: 0 }))

  it('names are optional: blank means unnamed, text is trimmed', () => {
    let doc = base()
    const id = doc.relations[0]!.id
    doc = apply(doc, { type: 'renameRelation', relationId: id, name: '  Klant ' })
    expect(doc.relations[0]!.name).toBe('Klant')
    doc = apply(doc, { type: 'renameRelation', relationId: id, name: '   ' })
    expect(doc.relations[0]!.name).toBeNull()
  })

  it('moves to rounded positions and rejects non-finite ones', () => {
    let doc = base()
    const id = doc.relations[0]!.id
    doc = apply(doc, { type: 'moveRelation', relationId: id, position: { x: 100.6, y: -3.2 } })
    expect(doc.relations[0]!.position).toEqual({ x: 101, y: -3 })
    expect(applyCommand(doc, { type: 'moveRelation', relationId: id, position: { x: NaN, y: 0 } }).ok).toBe(false)
  })

  it('deleting a table also removes references that touch it', () => {
    let doc = apply(emptyDocument(), createRelationFromNames(['a'], { x: 0, y: 0 }))
    doc = apply(doc, createRelationFromNames(['b'], { x: 0, y: 100 }))
    const [r1, r2] = doc.relations
    doc = {
      ...doc,
      references: [
        { id: 'ref1', from: { relationId: r2!.id, attributeIds: [r2!.attributes[0]!.id] }, to: { relationId: r1!.id, attributeIds: [r1!.attributes[0]!.id] } },
      ],
    }
    expect(integrityProblem(doc)).toBeNull()
    doc = apply(doc, { type: 'deleteRelation', relationId: r1!.id })
    expect(doc.relations.map((r) => r.id)).toEqual([r2!.id])
    expect(doc.references).toEqual([])
  })

  it('commands never mutate their input', () => {
    const doc = base()
    const snapshot = JSON.stringify(doc)
    apply(doc, { type: 'renameRelation', relationId: doc.relations[0]!.id, name: 'X' })
    apply(doc, addAttributesFromNames(doc.relations[0]!.id, ['b']))
    apply(doc, { type: 'moveRelation', relationId: doc.relations[0]!.id, position: { x: 5, y: 5 } })
    expect(JSON.stringify(doc)).toBe(snapshot)
  })

  it('copies attribute objects instead of aliasing them', () => {
    const attr = newAttribute('a1', 'x')
    const doc = apply(emptyDocument(), { type: 'createRelation', relation: { id: 'r1', name: null, position: { x: 0, y: 0 }, attributes: [attr] } })
    attr.name = 'changed'
    expect(doc.relations[0]!.attributes[0]!.name).toBe('x')
  })
})
