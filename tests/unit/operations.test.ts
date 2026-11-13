/** Milestone 2 state machine: Move/Copy modes, multi-selection, undo/redo, and the acceptance scenario. */
import { describe, expect, it } from 'vitest'
import { addSourceFields } from '../../src/commands/builders'
import type { Id } from '../../src/model/types'
import { HISTORY_LIMIT, initialState, NO_ATTRIBUTES_MESSAGE, reducer, type Action, type AppState } from '../../src/state/appState'
import { resolveCanvasClick, type CanvasTarget } from '../../src/state/interaction'

function run(state: AppState, ...actions: (Action | null)[]): AppState {
  return actions.reduce<AppState>((s, a) => {
    if (!a) throw new Error('no action')
    return reducer(s, a)
  }, state)
}
const click = (s: AppState, target: CanvasTarget, point = { x: 0, y: 0 }) => {
  const a = resolveCanvasClick(s, target, point)
  return a ? reducer(s, a) : s
}
const EMPTY: CanvasTarget = { kind: 'empty' }
const attrNames = (s: AppState) => s.doc.relations.map((r) => r.attributes.map((a) => a.name))

/** A state with one unnamed table holding the given attribute names, built with clicks. */
function withTable(names: string[]): AppState {
  let s = run(initialState(), { type: 'command', command: addSourceFields(names)! })
  for (const f of s.doc.sourceFields) s = run(s, { type: 'toggleField', fieldId: f.id })
  s = run(s, { type: 'startPlace' })
  s = click(s, EMPTY, { x: 100, y: 100 })
  return run(s, { type: 'cancel' }) // clear selection
}
const cellOf = (s: AppState, name: string): CanvasTarget => {
  for (const r of s.doc.relations) {
    const a = r.attributes.find((x) => x.name === name)
    if (a) return { kind: 'attribute', relationId: r.id, attributeId: a.id }
  }
  throw new Error(`no cell ${name}`)
}
const headerOf = (s: AppState, index: number): CanvasTarget => ({ kind: 'relation', relationId: s.doc.relations[index]!.id })

/** Selects cells by plain clicks: the first one, then "Add to selection" and the rest. */
function select(s: AppState, ...names: string[]): AppState {
  s = click(s, EMPTY)
  s = click(s, cellOf(s, names[0]!))
  if (names.length > 1) s = run(s, { type: 'ui', patch: { multiSelect: true } })
  for (const n of names.slice(1)) s = click(s, cellOf(s, n))
  return s
}
const idOf = (s: AppState, name: string) => (cellOf(s, name) as { attributeId: Id }).attributeId

describe('Milestone 2 acceptance (state level)', () => {
  it('splits a 10-attribute table into three, copies one back, and undoes/redoes each step, without dragging', () => {
    const TEN = ['Ordernr', 'Datum', 'Klantnr', 'Naam', 'Adres', 'Plaats', 'Artikelnr', 'Omschrijving', 'Aantal', 'Prijs']
    let s = withTable(TEN)
    const snapshots = [s.doc]

    // Move 1: select by plain clicks, "Move", click empty canvas.
    s = select(s, 'Naam', 'Klantnr', 'Plaats', 'Adres')
    s = run(s, { type: 'startAttributes', kind: 'move' })
    expect(s.ui.operation).toEqual({ kind: 'move' })
    s = click(s, EMPTY, { x: 100, y: 250 })
    snapshots.push(s.doc)
    expect(s.ui.operation.kind).toBe('select')

    // The moved attributes stay selected to show where they went; a click on empty canvas clears that.
    expect(s.ui.selection.kind === 'attributes' && s.ui.selection.attributeIds).toHaveLength(4)
    s = click(s, EMPTY)
    expect(s.ui.multiSelect).toBe(false)

    // Move 2.
    s = select(s, 'Artikelnr', 'Omschrijving', 'Prijs')
    s = run(s, { type: 'startAttributes', kind: 'move' })
    s = click(s, EMPTY, { x: 100, y: 400 })
    snapshots.push(s.doc)

    expect(attrNames(s)).toEqual([
      ['Ordernr', 'Datum', 'Aantal'],
      ['Klantnr', 'Naam', 'Adres', 'Plaats'],
      ['Artikelnr', 'Omschrijving', 'Prijs'],
    ])

    // Copy an attribute back: Klantnr into the first table, by clicking its header.
    s = select(s, 'Klantnr')
    s = run(s, { type: 'startAttributes', kind: 'copy' })
    s = click(s, headerOf(s, 0))
    snapshots.push(s.doc)
    expect(attrNames(s)[0]).toEqual(['Ordernr', 'Datum', 'Aantal', 'Klantnr'])
    expect(attrNames(s)[1]).toContain('Klantnr')

    // Each change is one undo step; redo replays them.
    for (let i = snapshots.length - 2; i >= 0; i--) {
      s = run(s, { type: 'undo' })
      expect(s.doc).toBe(snapshots[i])
    }
    expect(s.history.past).toHaveLength(2) // adding the fields and the first placement remain
    for (let i = 1; i < snapshots.length; i++) {
      s = run(s, { type: 'redo' })
      expect(s.doc).toBe(snapshots[i])
    }
  })
})

describe('move and copy', () => {
  it('start from the selection and go straight to the destination; without one they explain', () => {
    let s = withTable(['a', 'b'])
    s = click(s, cellOf(s, 'a'))
    expect(run(s, { type: 'startAttributes', kind: 'copy' }).ui).toMatchObject({ operation: { kind: 'copy' }, selection: { kind: 'attributes' } })
    const none = run(withTable(['a']), { type: 'startAttributes', kind: 'move' })
    expect(none.ui.operation).toEqual({ kind: 'select' })
    expect(none.ui.message?.text).toBe(NO_ATTRIBUTES_MESSAGE)
  })

  it('a cell edge chooses the insertion point', () => {
    let s = select(withTable(['a', 'b', 'c', 'd']), 'd')
    s = run(s, { type: 'startAttributes', kind: 'move' })
    s = click(s, { ...cellOf(s, 'b'), side: 'before' } as CanvasTarget)
    expect(attrNames(s)).toEqual([['a', 'd', 'b', 'c']])
  })

  it('Escape leaves the document unchanged, returns to Select and keeps the selection', () => {
    for (const kind of ['move', 'copy'] as const) {
      let s = select(withTable(['a', 'b']), 'a')
      const doc = s.doc
      s = run(s, { type: 'startAttributes', kind }, { type: 'cancel' })
      expect(s.doc).toBe(doc)
      expect(s.ui.operation.kind).toBe('select')
      expect(s.ui.selection).toEqual({ kind: 'attributes', attributeIds: [idOf(s, 'a')] })
      expect(s.history.past).toHaveLength(2)
    }
  })

  it('moving one member of a composite reference end moves and selects the whole end', () => {
    let s = withTable(['a', 'b', 'c', 'd'])
    const r = s.doc.relations[0]!
    const [a, b, c, d] = r.attributes.map((x) => x.id)
    s = { ...s, doc: { ...s.doc, references: [{ id: 'R', from: { relationId: r.id, attributeIds: [a!, b!] }, to: { relationId: r.id, attributeIds: [c!, d!] } }] } }
    s = select(s, 'a')
    s = run(s, { type: 'startAttributes', kind: 'move' })
    s = click(s, EMPTY, { x: 0, y: 300 })
    expect(attrNames(s)).toEqual([['c', 'd'], ['a', 'b']])
    expect(s.ui.selection).toEqual({ kind: 'attributes', attributeIds: [a, b] })
    expect(s.ui.message?.text).toMatch(/Moved b along/)
  })

  it('copy selects the new copies afterwards', () => {
    let s = select(withTable(['a']), 'a')
    s = run(s, { type: 'startAttributes', kind: 'copy' })
    s = click(s, EMPTY, { x: 0, y: 300 })
    const copyId = s.doc.relations[1]!.attributes[0]!.id
    expect(s.ui.selection).toEqual({ kind: 'attributes', attributeIds: [copyId] })
  })
})

describe('copy table', () => {
  it('places an unnamed copy with the same notation where clicked, selects it, and is one undo step', () => {
    let s = withTable(['a', 'b'])
    const r = s.doc.relations[0]!
    s = run(s, { type: 'command', command: { type: 'renameRelation', relationId: r.id, name: 'T' } })
    s = run(s, { type: 'command', command: { type: 'setAttributeFlag', attributeIds: [r.attributes[0]!.id], flag: 'primaryKey', value: true } })
    const before = s.doc
    s = run(s, { type: 'startCopyTable', relationId: r.id })
    expect(s.ui.operation).toEqual({ kind: 'copyTable', relationId: r.id })
    s = click(s, EMPTY, { x: 300, y: 300 })
    expect(attrNames(s)).toEqual([['a', 'b'], ['a', 'b']])
    const copy = s.doc.relations[1]!
    expect(copy.name).toBeNull()
    expect(copy.attributes[0]!.primaryKey).toBe(true)
    expect(copy.attributes[0]!.id).not.toBe(r.attributes[0]!.id)
    expect(s.ui).toMatchObject({ operation: { kind: 'select' }, selection: { kind: 'relation', relationId: copy.id } })
    expect(run(s, { type: 'undo' }).doc).toBe(before)
  })
})

describe('selection', () => {
  it('Add to selection: successive clicks add and remove, no modifier keys', () => {
    let s = select(withTable(['a', 'b', 'c']), 'c', 'a')
    expect(s.ui.selection.kind === 'attributes' && s.ui.selection.attributeIds).toHaveLength(2)
    s = click(s, cellOf(s, 'c'))
    expect(s.ui.selection.kind === 'attributes' && s.ui.selection.attributeIds).toHaveLength(1)
  })

  it('Shift-click adds and removes like Add to selection', () => {
    let s = select(withTable(['a', 'b']), 'a')
    const shift = (st: AppState, name: string) => reducer(st, resolveCanvasClick(st, cellOf(st, name), { x: 0, y: 0 }, true)!)
    s = shift(s, 'b')
    expect(s.ui.selection).toEqual({ kind: 'attributes', attributeIds: [idOf(s, 'a'), idOf(s, 'b')] })
    expect(s.ui.multiSelect).toBe(false)
    s = shift(s, 'a')
    expect(s.ui.selection).toEqual({ kind: 'attributes', attributeIds: [idOf(s, 'b')] })
  })

  it('the mode ends when the selection becomes empty', () => {
    let s = select(withTable(['a', 'b']), 'a', 'b')
    expect(s.ui.multiSelect).toBe(true)
    s = click(s, cellOf(s, 'a'))
    s = click(s, cellOf(s, 'b'))
    expect(s.ui.selection.kind).toBe('none')
    expect(s.ui.multiSelect).toBe(false)
  })

  it('a selection stays within one table: a cell elsewhere starts a new selection and ends the mode', () => {
    let s = select(withTable(['a', 'b']), 'a')
    s = run(s, { type: 'startAttributes', kind: 'move' })
    s = click(s, EMPTY, { x: 0, y: 300 }) // a second table holding a
    s = select(s, 'b')
    s = run(s, { type: 'ui', patch: { multiSelect: true } })
    s = click(s, cellOf(s, 'a'))
    expect(s.ui.selection).toEqual({ kind: 'attributes', attributeIds: [idOf(s, 'a')] })
    expect(s.ui.multiSelect).toBe(false)
    // Even a patched mixed selection is cut back to the first cell's table.
    s = run(s, { type: 'ui', patch: { selection: { kind: 'attributes', attributeIds: [idOf(s, 'b'), idOf(s, 'a')] } } })
    expect(s.ui.selection).toEqual({ kind: 'attributes', attributeIds: [idOf(s, 'b')] })
  })

  it('in plain Select, a click replaces the selection', () => {
    let s = withTable(['a', 'b'])
    s = click(s, cellOf(s, 'a'))
    s = click(s, cellOf(s, 'b'))
    expect(s.ui.selection).toEqual({ kind: 'attributes', attributeIds: [idOf(s, 'b')] })
  })

  it('selection follows undo: attributes that no longer exist are dropped', () => {
    let s = select(withTable(['a']), 'a')
    s = run(s, { type: 'startAttributes', kind: 'copy' })
    s = click(s, EMPTY, { x: 0, y: 300 })
    s = run(s, { type: 'undo' })
    expect(s.ui.selection.kind).toBe('none')
  })
})

describe('history', () => {
  it('records every document change, including layout, and clears redo on a new edit', () => {
    let s = withTable(['a'])
    const rid = s.doc.relations[0]!.id
    s = run(s, { type: 'command', command: { type: 'moveRelation', relationId: rid, position: { x: 500, y: 500 } } })
    s = run(s, { type: 'command', command: { type: 'renameRelation', relationId: rid, name: 'T' } })
    s = run(s, { type: 'undo' })
    expect(s.doc.relations[0]!.name).toBeNull()
    expect(s.history.future).toHaveLength(1)
    s = run(s, { type: 'command', command: { type: 'renameRelation', relationId: rid, name: 'U' } })
    expect(s.history.future).toHaveLength(0)
    s = run(s, { type: 'undo' }, { type: 'undo' })
    expect(s.doc.relations[0]!.position).toEqual({ x: 100, y: 83 })
  })

  it('undo restores a deleted table with its position and attributes', () => {
    let s = withTable(['a', 'b'])
    const before = s.doc
    s = run(s, { type: 'command', command: { type: 'deleteRelation', relationId: s.doc.relations[0]!.id } })
    expect(s.doc.relations).toHaveLength(0)
    s = run(s, { type: 'undo' })
    expect(s.doc).toBe(before)
  })

  it('coalesces consecutive nudges of one table into one step', () => {
    let s = withTable(['a'])
    const start = s.doc
    const rid = s.doc.relations[0]!.id
    for (let i = 1; i <= 5; i++)
      s = run(s, { type: 'command', command: { type: 'moveRelation', relationId: rid, position: { x: 100 + 10 * i, y: 83 } }, coalesceKey: `nudge:${rid}` })
    s = run(s, { type: 'undo' })
    expect(s.doc).toBe(start)
  })

  it('unchanged documents and failed commands add no step', () => {
    let s = withTable(['a'])
    const depth = s.history.past.length
    s = run(s, { type: 'command', command: { type: 'shiftAttributes', attributeIds: [s.doc.relations[0]!.attributes[0]!.id], delta: -1 } })
    s = run(s, { type: 'command', command: { type: 'renameRelation', relationId: 'missing', name: 'x' } })
    expect(s.history.past).toHaveLength(depth)
  })

  it('undo and redo with an empty history do nothing; history is bounded', () => {
    const s0 = initialState()
    expect(run(s0, { type: 'undo' })).toBe(s0)
    expect(run(s0, { type: 'redo' })).toBe(s0)
    let s = withTable(['a'])
    const rid = s.doc.relations[0]!.id
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) s = run(s, { type: 'command', command: { type: 'moveRelation', relationId: rid, position: { x: i, y: 0 } } })
    expect(s.history.past).toHaveLength(HISTORY_LIMIT)
  })

  it('undo ends an operation in progress', () => {
    let s = withTable(['a'])
    s = run(s, { type: 'startAttributes', kind: 'move' }, { type: 'undo' })
    expect(s.ui.operation.kind).toBe('select')
  })
})
