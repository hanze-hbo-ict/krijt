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

describe('Milestone 2 acceptance (state level)', () => {
  it('splits a 10-attribute table into three, copies one back, and undoes/redoes each step, without dragging', () => {
    const TEN = ['Ordernr', 'Datum', 'Klantnr', 'Naam', 'Adres', 'Plaats', 'Artikelnr', 'Omschrijving', 'Aantal', 'Prijs']
    let s = withTable(TEN)
    const snapshots = [s.doc]

    // Move 1: command first, then select by plain clicks, Next, click empty canvas.
    s = run(s, { type: 'startAttributes', kind: 'move' })
    for (const n of ['Naam', 'Klantnr', 'Plaats', 'Adres']) s = click(s, cellOf(s, n))
    s = run(s, { type: 'next' })
    s = click(s, EMPTY, { x: 100, y: 250 })
    snapshots.push(s.doc)
    expect(s.ui.operation.kind).toBe('select')

    // The moved attributes stay selected to show where they went; a click on empty canvas clears that.
    expect(s.ui.selection.kind === 'attributes' && s.ui.selection.attributeIds).toHaveLength(4)
    s = click(s, EMPTY)

    // Move 2: selection first (Select several), then "Move to…", straight to the destination.
    s = run(s, { type: 'ui', patch: { multiSelect: true } })
    for (const n of ['Artikelnr', 'Omschrijving', 'Prijs']) s = click(s, cellOf(s, n))
    s = run(s, { type: 'ui', patch: { multiSelect: false } })
    s = run(s, { type: 'startAttributes', kind: 'move', fromSelection: true })
    expect(s.ui.operation).toEqual({ kind: 'move', phase: 'destination' })
    s = click(s, EMPTY, { x: 100, y: 400 })
    snapshots.push(s.doc)

    expect(attrNames(s)).toEqual([
      ['Ordernr', 'Datum', 'Aantal'],
      ['Klantnr', 'Naam', 'Adres', 'Plaats'],
      ['Artikelnr', 'Omschrijving', 'Prijs'],
    ])

    // Copy an attribute back: Klantnr into the first table, by clicking its header.
    // The Copy tool starts with an empty selection, whatever was selected before.
    s = run(s, { type: 'startAttributes', kind: 'copy' })
    expect(s.ui.selection.kind).toBe('none')
    s = click(s, cellOf(s, 'Klantnr'))
    s = run(s, { type: 'next' })
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

describe('move and copy modes', () => {
  it('the tool starts empty; "Move to…" on a selection goes straight to the destination', () => {
    let s = withTable(['a', 'b'])
    s = click(s, cellOf(s, 'a'))
    expect(run(s, { type: 'startAttributes', kind: 'move' }).ui).toMatchObject({ operation: { kind: 'move', phase: 'selecting' }, selection: { kind: 'none' } })
    expect(run(s, { type: 'startAttributes', kind: 'copy', fromSelection: true }).ui).toMatchObject({
      operation: { kind: 'copy', phase: 'destination' },
      selection: { kind: 'attributes' },
    })
    // Without a selection, "from selection" falls back to selecting first.
    const none = run(withTable(['a']), { type: 'startAttributes', kind: 'move', fromSelection: true })
    expect(none.ui.operation).toEqual({ kind: 'move', phase: 'selecting' })
  })

  it('in the selecting phase, clicks toggle cells and stray clicks do nothing', () => {
    let s = withTable(['a', 'b', 'c'])
    s = run(s, { type: 'startAttributes', kind: 'move' })
    s = click(s, cellOf(s, 'b'))
    s = click(s, cellOf(s, 'a'))
    s = click(s, cellOf(s, 'b'))
    expect(s.ui.selection).toEqual({ kind: 'attributes', attributeIds: [(cellOf(s, 'a') as { attributeId: Id }).attributeId] })
    const doc = s.doc
    s = click(s, EMPTY)
    s = click(s, headerOf(s, 0))
    expect(s.doc).toBe(doc)
    expect(s.ui.selection.kind).toBe('attributes')
  })

  it('Next without a selection explains instead of advancing', () => {
    let s = withTable(['a'])
    s = run(s, { type: 'startAttributes', kind: 'copy' }, { type: 'next' })
    expect(s.ui.operation).toEqual({ kind: 'copy', phase: 'selecting' })
    expect(s.ui.message?.text).toBe(NO_ATTRIBUTES_MESSAGE)
  })

  it('a cell edge chooses the insertion point', () => {
    let s = withTable(['a', 'b', 'c', 'd'])
    s = run(s, { type: 'startAttributes', kind: 'move' })
    s = click(s, cellOf(s, 'd'))
    s = run(s, { type: 'next' })
    s = click(s, { ...cellOf(s, 'b'), side: 'before' } as CanvasTarget)
    expect(attrNames(s)).toEqual([['a', 'd', 'b', 'c']])
  })

  it('Escape in either phase leaves the document unchanged and returns to Select', () => {
    for (const kind of ['move', 'copy'] as const) {
      let s = withTable(['a', 'b'])
      const doc = s.doc
      s = run(s, { type: 'startAttributes', kind })
      s = click(s, cellOf(s, 'a'))
      s = run(s, { type: 'next' }, { type: 'cancel' })
      expect(s.doc).toBe(doc)
      expect(s.ui.operation.kind).toBe('select')
      expect(s.history.past).toHaveLength(2)
    }
  })

  it('a refused move keeps the operation open with an explanation', () => {
    let s = withTable(['a', 'b'])
    const r = s.doc.relations[0]!
    const [a, b] = r.attributes
    s = { ...s, doc: { ...s.doc, references: [{ id: 'R', from: { relationId: r.id, attributeIds: [a!.id, b!.id] }, to: { relationId: r.id, attributeIds: [b!.id, a!.id] } }] } }
    s = run(s, { type: 'startAttributes', kind: 'move' })
    s = click(s, cellOf(s, 'a'))
    s = run(s, { type: 'next' })
    s = click(s, EMPTY)
    expect(s.doc.relations).toHaveLength(1)
    expect(s.ui.message?.kind).toBe('error')
    expect(s.ui.operation).toEqual({ kind: 'move', phase: 'destination' })
  })

  it('copy selects the new copies afterwards; move keeps the moved attributes selected', () => {
    let s = withTable(['a'])
    s = run(s, { type: 'startAttributes', kind: 'copy' })
    s = click(s, cellOf(s, 'a'))
    s = run(s, { type: 'next' })
    s = click(s, EMPTY, { x: 0, y: 300 })
    const copyId = s.doc.relations[1]!.attributes[0]!.id
    expect(s.ui.selection).toEqual({ kind: 'attributes', attributeIds: [copyId] })
  })
})

describe('selection', () => {
  it('Select several: successive clicks add and remove, no modifier keys', () => {
    let s = withTable(['a', 'b', 'c'])
    s = run(s, { type: 'ui', patch: { multiSelect: true } })
    s = click(s, cellOf(s, 'c'))
    s = click(s, cellOf(s, 'a'))
    expect(s.ui.selection.kind === 'attributes' && s.ui.selection.attributeIds).toHaveLength(2)
    s = click(s, cellOf(s, 'c'))
    expect(s.ui.selection.kind === 'attributes' && s.ui.selection.attributeIds).toHaveLength(1)
  })

  it('in plain Select, a click replaces the selection', () => {
    let s = withTable(['a', 'b'])
    s = click(s, cellOf(s, 'a'))
    s = click(s, cellOf(s, 'b'))
    expect(s.ui.selection).toEqual({ kind: 'attributes', attributeIds: [(cellOf(s, 'b') as { attributeId: Id }).attributeId] })
  })

  it('selection follows undo: attributes that no longer exist are dropped', () => {
    let s = withTable(['a'])
    s = run(s, { type: 'startAttributes', kind: 'copy' })
    s = click(s, cellOf(s, 'a'))
    s = run(s, { type: 'next' })
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
