import { describe, expect, it } from 'vitest'
import { addSourceFields, parseFieldList } from '../../src/commands/builders'
import { initialState, reducer, type Action, type AppState } from '../../src/state/appState'
import { NO_FIELDS_MESSAGE, newTablePosition, resolveCanvasClick, type CanvasTarget } from '../../src/state/interaction'

function run(state: AppState, ...actions: (Action | null)[]): AppState {
  return actions.reduce<AppState>((s, a) => {
    if (!a) throw new Error('no action')
    return reducer(s, a)
  }, state)
}
const click = (s: AppState, target: CanvasTarget, point = { x: 0, y: 0 }) => run(s, resolveCanvasClick(s, target, point))
const EMPTY: CanvasTarget = { kind: 'empty' }

function withFields(labels: string[]): AppState {
  return run(initialState(), { type: 'command', command: addSourceFields(labels)! })
}

const TWELVE = `Ordernummer
Orderdatum
Klantnummer
Klantnaam
Adres
Postcode
Plaats

Artikelnummer
Omschrijving
Aantal
Prijs
Subtotaal`

describe('Milestone 1 acceptance (state level)', () => {
  it('pastes 12 fields and builds an unnamed table from a subset with clicks only', () => {
    let s = withFields(parseFieldList(TWELVE))
    expect(s.doc.sourceFields).toHaveLength(12)

    // Selection → command → destination. Click order differs from inventory order.
    const id = (label: string) => s.doc.sourceFields.find((f) => f.label === label)!.id
    s = run(s, { type: 'toggleField', fieldId: id('Klantnaam') }, { type: 'toggleField', fieldId: id('Klantnummer') }, { type: 'toggleField', fieldId: id('Plaats') })
    s = run(s, { type: 'startPlace' })
    s = click(s, EMPTY, { x: 200, y: 150 })

    expect(s.doc.relations).toHaveLength(1)
    const r = s.doc.relations[0]!
    expect(r.name).toBeNull()
    expect(r.attributes.map((a) => a.name)).toEqual(['Klantnummer', 'Klantnaam', 'Plaats'])
    expect(r.position).toEqual(newTablePosition({ x: 200, y: 150 }))
    expect(s.doc.sourceFields).toHaveLength(12) // inventory is never consumed
    // One-shot: back to select, field selection cleared, new table selected.
    expect(s.ui.operation.kind).toBe('select')
    expect(s.ui.selectedFieldIds).toEqual([])
    expect(s.ui.selection).toEqual({ kind: 'relation', relationId: r.id })
  })
})

describe('place operation', () => {
  it('supports command → selection → destination', () => {
    let s = withFields(['a', 'b'])
    s = run(s, { type: 'startPlace' }, { type: 'toggleField', fieldId: s.doc.sourceFields[1]!.id })
    expect(s.ui.operation.kind).toBe('place')
    s = click(s, EMPTY)
    expect(s.doc.relations[0]!.attributes.map((a) => a.name)).toEqual(['b'])
  })

  it('adds to an existing table when a table part is clicked', () => {
    let s = withFields(['a', 'b', 'c'])
    const [a, b, c] = s.doc.sourceFields
    s = run(s, { type: 'toggleField', fieldId: a!.id }, { type: 'startPlace' })
    s = click(s, EMPTY)
    const rid = s.doc.relations[0]!.id
    for (const [field, target] of [
      [b!, { kind: 'attribute', relationId: rid, attributeId: s.doc.relations[0]!.attributes[0]!.id }],
      [c!, { kind: 'relation', relationId: rid }],
    ] as const) {
      s = run(s, { type: 'toggleField', fieldId: field.id }, { type: 'startPlace' })
      s = click(s, target)
    }
    expect(s.doc.relations).toHaveLength(1)
    expect(s.doc.relations[0]!.attributes.map((x) => x.name)).toEqual(['a', 'b', 'c'])
  })

  it('without selected fields, explains instead of creating anything', () => {
    let s = withFields(['a'])
    s = run(s, { type: 'startPlace' })
    s = click(s, EMPTY)
    expect(s.doc.relations).toHaveLength(0)
    expect(s.ui.operation.kind).toBe('place')
    expect(s.ui.message?.text).toBe(NO_FIELDS_MESSAGE)
  })

  it('cancel leaves the document unchanged and keeps the field selection', () => {
    let s = withFields(['a'])
    s = run(s, { type: 'toggleField', fieldId: s.doc.sourceFields[0]!.id }, { type: 'startPlace' })
    const doc = s.doc
    s = run(s, { type: 'cancel' })
    expect(s.doc).toBe(doc)
    expect(s.ui.operation.kind).toBe('select')
    expect(s.ui.selectedFieldIds).toHaveLength(1)
  })
})

describe('selection state', () => {
  const withTable = () => {
    let s = withFields(['a', 'b'])
    s = run(s, { type: 'toggleField', fieldId: s.doc.sourceFields[0]!.id }, { type: 'startPlace' })
    return click(s, EMPTY)
  }

  it('clicking empty canvas in select mode clears the selection and creates nothing', () => {
    let s = withTable()
    s = click(s, EMPTY)
    expect(s.ui.selection.kind).toBe('none')
    expect(s.doc.relations).toHaveLength(1)
  })

  it('clicking a cell selects it; clicking again deselects', () => {
    let s = withTable()
    const r = s.doc.relations[0]!
    const t: CanvasTarget = { kind: 'attribute', relationId: r.id, attributeId: r.attributes[0]!.id }
    s = click(s, t)
    expect(s.ui.selection).toEqual({ kind: 'attribute', relationId: r.id, attributeId: r.attributes[0]!.id })
    s = click(s, t)
    expect(s.ui.selection.kind).toBe('none')
  })

  it('the name affordance edits only once the table is selected', () => {
    let s = click(withTable(), EMPTY)
    const rid = s.doc.relations[0]!.id
    s = click(s, { kind: 'relationName', relationId: rid })
    expect(s.ui.editing).toBeNull()
    s = click(s, { kind: 'relationName', relationId: rid })
    expect(s.ui.editing).toEqual({ kind: 'relationName', relationId: rid })
  })

  it('the + cell opens attribute entry for that table', () => {
    let s = withTable()
    const rid = s.doc.relations[0]!.id
    s = click(s, { kind: 'addCell', relationId: rid })
    expect(s.ui.editing).toEqual({ kind: 'newAttribute', relationId: rid })
  })

  it('Escape steps back: editing, then operation, then selection', () => {
    let s = withTable()
    const rid = s.doc.relations[0]!.id
    s = run(s, { type: 'startMoveTable', relationId: rid })
    s = run(s, { type: 'cancel' })
    expect(s.ui.operation.kind).toBe('select')
    expect(s.ui.selection.kind).toBe('relation')
    s = run(s, { type: 'cancel' })
    expect(s.ui.selection.kind).toBe('none')
  })

  it('selection referring to deleted things is dropped', () => {
    let s = withTable()
    const rid = s.doc.relations[0]!.id
    s = run(s, { type: 'command', command: { type: 'deleteRelation', relationId: rid } })
    expect(s.ui.selection.kind).toBe('none')
    let t = withFields(['a'])
    t = run(t, { type: 'toggleField', fieldId: t.doc.sourceFields[0]!.id })
    t = run(t, { type: 'command', command: { type: 'deleteSourceField', fieldId: t.doc.sourceFields[0]!.id } })
    expect(t.ui.selectedFieldIds).toEqual([])
  })

  it('failed commands keep the document and report the error', () => {
    const s = withTable()
    const next = run(s, { type: 'command', command: { type: 'renameRelation', relationId: 'missing', name: 'x' } })
    expect(next.doc).toBe(s.doc)
    expect(next.ui.message?.kind).toBe('error')
  })
})

describe('move table by clicks', () => {
  it('the next canvas click sets the position, then returns to select', () => {
    let s = withFields(['a'])
    s = run(s, { type: 'toggleField', fieldId: s.doc.sourceFields[0]!.id }, { type: 'startPlace' })
    s = click(s, EMPTY, { x: 0, y: 0 })
    const rid = s.doc.relations[0]!.id
    s = run(s, { type: 'startMoveTable', relationId: rid })
    s = click(s, EMPTY, { x: 400, y: 300 })
    expect(s.doc.relations[0]!.position).toEqual(newTablePosition({ x: 400, y: 300 }))
    expect(s.ui.operation.kind).toBe('select')
  })
})

describe('sidebar width', () => {
  it('is clamped', () => {
    expect(run(initialState(), { type: 'ui', patch: { sidebarWidth: 5000 } }).ui.sidebarWidth).toBe(480)
    expect(run(initialState(), { type: 'ui', patch: { sidebarWidth: 10 } }).ui.sidebarWidth).toBe(200)
  })
})
