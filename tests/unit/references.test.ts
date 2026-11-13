/** Milestone 3: reference commands, geometry, the Reference state machine, and the acceptance scenario. */
import { describe, expect, it } from 'vitest'
import { addSourceFields } from '../../src/commands/builders'
import { applyCommand, type Command } from '../../src/commands/commands'
import { contentBounds, estimateMeasurer as m, layoutRelation, type RelationLayout } from '../../src/geometry/layout'
import { bracePath, layoutReferences, REFERENCE_METRICS } from '../../src/geometry/references'
import { emptyDocument, newAttribute, type Id, type KrijtDocument, type Reference, type Relation } from '../../src/model/types'
import { parseDocument } from '../../src/model/validate'
import { initialState, NO_ATTRIBUTES_MESSAGE, reducer, type Action, type AppState } from '../../src/state/appState'
import { referenceBlock, resolveCanvasClick, type CanvasTarget } from '../../src/state/interaction'

const rel = (id: string, names: string[], x = 0, y = 0, name: string | null = null): Relation => ({
  id,
  name,
  position: { x, y },
  attributes: names.map((n) => newAttribute(`${id}.${n}`, n)),
})

function docWith(relations: Relation[], references: Reference[] = []): KrijtDocument {
  return { ...emptyDocument(), relations, references }
}

const apply = (doc: KrijtDocument, cmd: Command) => {
  const r = applyCommand(doc, cmd)
  if (!r.ok) throw new Error(r.error)
  return r.doc
}
const err = (doc: KrijtDocument, cmd: Command) => {
  const r = applyCommand(doc, cmd)
  if (r.ok) throw new Error('expected failure')
  return r.error
}
const ref = (id: string, from: [string, string[]], to: [string, string[]]): Reference => ({
  id,
  from: { relationId: from[0], attributeIds: from[1] },
  to: { relationId: to[0], attributeIds: to[1] },
})

// Bestelling(ordernr, klantnr) → Klant(klantnr); Regel(ordernr, regelnr) composite.
const BESTELLING = rel('b', ['ordernr', 'datum', 'klantnr'], 0, 200)
const KLANT = rel('k', ['klantnr', 'naam'], 0, 0)

describe('reference commands', () => {
  const base = docWith([BESTELLING, KLANT])

  it('adds a reference with ends in click order', () => {
    const doc = apply(base, { type: 'addReference', reference: ref('x', ['b', ['b.klantnr']], ['k', ['k.klantnr']]) })
    expect(doc.references).toEqual([ref('x', ['b', ['b.klantnr']], ['k', ['k.klantnr']])])
    expect(parseDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
  })

  it('stores composite ends in table order, so they pair up left to right', () => {
    const doc = apply(base, { type: 'addReference', reference: ref('x', ['b', ['b.klantnr', 'b.datum']], ['k', ['k.naam', 'k.klantnr']]) })
    expect(doc.references[0]!.from.attributeIds).toEqual(['b.datum', 'b.klantnr'])
    expect(doc.references[0]!.to.attributeIds).toEqual(['k.klantnr', 'k.naam'])
  })

  it('requires the attributes of each end to be side by side', () => {
    const add = (from: [string, string[]], to: [string, string[]]) => err(base, { type: 'addReference', reference: ref('x', from, to) })
    expect(add(['b', ['b.ordernr', 'b.klantnr']], ['k', ['k.klantnr', 'k.naam']])).toMatch(/next to each other/)
  })

  it('refuses structurally impossible references, and nothing else', () => {
    const add = (from: [string, string[]], to: [string, string[]]) => err(base, { type: 'addReference', reference: ref('x', from, to) })
    expect(add(['b', []], ['k', ['k.klantnr']])).toMatch(/foreign-key/)
    expect(add(['b', ['b.klantnr', 'b.ordernr']], ['k', ['k.klantnr']])).toMatch(/same number/)
    expect(add(['b', ['b.klantnr', 'b.klantnr']], ['k', ['k.klantnr', 'k.naam']])).toMatch(/only once/)
    expect(add(['b', ['b.datum', 'b.klantnr']], ['k', ['k.klantnr', 'k.klantnr']])).toMatch(/only once/)
    expect(add(['b', ['b.klantnr', 'k.naam']], ['k', ['k.klantnr', 'k.naam']])).toMatch(/one table/)
    expect(add(['b', ['b.gone']], ['k', ['k.klantnr']])).toMatch(/no longer exist/)
    expect(add(['b', ['b.klantnr']], ['b', ['b.klantnr']])).toMatch(/itself/)
    // No key or name checks: a non-PK, differently named target is fine, and so is a reference within one table.
    expect(applyCommand(base, { type: 'addReference', reference: ref('x', ['b', ['b.datum']], ['k', ['k.naam']]) }).ok).toBe(true)
    expect(applyCommand(base, { type: 'addReference', reference: ref('x', ['b', ['b.datum']], ['b', ['b.ordernr']]) }).ok).toBe(true)
  })

  it('refuses an exact duplicate and a reused ID', () => {
    const doc = apply(base, { type: 'addReference', reference: ref('x', ['b', ['b.klantnr']], ['k', ['k.klantnr']]) })
    expect(err(doc, { type: 'addReference', reference: ref('y', ['b', ['b.klantnr']], ['k', ['k.klantnr']]) })).toMatch(/already exists/)
    expect(err(doc, { type: 'addReference', reference: ref('x', ['b', ['b.datum']], ['k', ['k.naam']]) })).toMatch(/not unique/)
  })

  it('deletes a reference', () => {
    const doc = apply(base, { type: 'addReference', reference: ref('x', ['b', ['b.klantnr']], ['k', ['k.klantnr']]) })
    expect(apply(doc, { type: 'deleteReference', referenceId: 'x' }).references).toEqual([])
    expect(err(doc, { type: 'deleteReference', referenceId: 'nope' })).toMatch(/no longer exists/)
  })
})

const layoutsOf = (doc: KrijtDocument) => new Map<Id, RelationLayout>(doc.relations.map((r) => [r.id, layoutRelation(r, m)]))
const geometryOf = (doc: KrijtDocument) => layoutReferences(doc.references, layoutsOf(doc))

describe('reference geometry', () => {
  const M = REFERENCE_METRICS

  it('goes from the bottom of the source to the top of a target below it, arrow at the target', () => {
    // Source Klant at y=0 refers down to Bestelling at y=200.
    const doc = docWith([KLANT, BESTELLING], [ref('x', ['k', ['k.klantnr']], ['b', ['b.klantnr']])])
    const [g] = geometryOf(doc)
    const k = layoutRelation(KLANT, m)
    const b = layoutRelation(BESTELLING, m)
    const kc = k.cells[0]!
    const bc = b.cells[2]!
    expect(g!.points[0]).toEqual({ x: kc.x + kc.width / 2, y: k.y + k.height })
    expect(g!.points[g!.points.length - 1]).toEqual({ x: bc.x + bc.width / 2, y: b.y })
    // Orthogonal: every segment is horizontal or vertical.
    for (let i = 1; i < g!.points.length; i++) {
      const [p, q] = [g!.points[i - 1]!, g!.points[i]!]
      expect(p.x === q.x || p.y === q.y).toBe(true)
    }
    // The horizontal run stays clear of the target's header band.
    expect(g!.points[1]!.y).toBeLessThan(b.header.y)
    expect(g!.braces).toEqual([])
    expect(g!.arrow.startsWith(`M${bc.x + bc.width / 2} ${b.y}`)).toBe(true)
  })

  it('goes from the top of the source to the bottom of a target above it', () => {
    const doc = docWith([BESTELLING, KLANT], [ref('x', ['b', ['b.klantnr']], ['k', ['k.klantnr']])])
    const [g] = geometryOf(doc)
    const b = layoutRelation(BESTELLING, m)
    const k = layoutRelation(KLANT, m)
    expect(g!.points[0]!.y).toBe(b.y)
    expect(g!.points[g!.points.length - 1]!.y).toBe(k.y + k.height)
  })

  it('routes below both strips when the tables are side by side, and for a reference within one table', () => {
    const side = docWith([rel('a', ['x', 'y'], 0, 0), rel('c', ['z'], 400, 10)], [ref('r', ['a', ['a.x']], ['c', ['c.z']])])
    const [g] = geometryOf(side)
    expect(g!.points[0]!.y).toBe(34)
    expect(g!.points[3]!.y).toBe(44)
    expect(g!.points[1]!.y).toBe(44 + M.clearance)
    const self = docWith([rel('a', ['x', 'y'], 0, 0)], [ref('r', ['a', ['a.y']], ['a', ['a.x']])])
    const [h] = geometryOf(self)
    expect(h!.points.every((p) => p.y >= 34)).toBe(true)
  })

  it('draws a brace at both ends of a composite reference and meets their tips', () => {
    const regel = rel('r', ['ordernr', 'regelnr', 'aantal'], 0, 0)
    const levering = rel('l', ['levnr', 'ordernr', 'regelnr'], 0, 250)
    const doc = docWith([levering, regel], [ref('x', ['l', ['l.ordernr', 'l.regelnr']], ['r', ['r.ordernr', 'r.regelnr']])])
    const [g] = geometryOf(doc)
    expect(g!.braces).toHaveLength(2)
    const l = layoutRelation(levering, m)
    const x1 = l.cells[1]!.x + M.braceInset
    const x2 = l.cells[2]!.x + l.cells[2]!.width - M.braceInset
    // Levering is below Regel: its brace sits above the strip, tip up. The ends overlap, so the connector is one
    // straight vertical line, with the tips moved towards each other (no jog).
    const tipY = l.y - M.braceGap - M.braceDepth
    expect(g!.points).toHaveLength(2)
    expect(g!.points[0]!.y).toBe(tipY)
    expect(g!.points[0]!.x).toBe(g!.points[1]!.x)
    expect(g!.braces[0]).toBe(bracePath(x1, x2, l.y - M.braceGap, -1, M.braceDepth, g!.points[0]!.x))
    expect(Math.abs(g!.points[0]!.x - (x1 + x2) / 2)).toBeLessThanOrEqual((x2 - x1) / 4)
    expect(g!.dots).toEqual([])
  })

  it('keeps the bend when the ends do not overlap horizontally', () => {
    const doc = docWith([rel('a', ['p'], 0, 0), rel('c', ['s'], 400, 250)], [ref('x', ['c', ['c.s']], ['a', ['a.p']])])
    const [g] = geometryOf(doc)
    expect(g!.points).toHaveLength(4)
  })

  it('centres the tips when the ends already line up', () => {
    const doc = docWith([rel('a', ['p', 'q'], 0, 0), rel('c', ['p', 'q'], 0, 250)], [ref('x', ['c', ['c.p', 'c.q']], ['a', ['a.p', 'a.q']])])
    const [g] = geometryOf(doc)
    const l = layoutRelation(doc.relations[1]!, m)
    const mid = (l.cells[0]!.x + M.braceInset + l.cells[1]!.x + l.cells[1]!.width - M.braceInset) / 2
    expect(g!.points).toEqual([
      { x: mid, y: l.y - M.braceGap - M.braceDepth },
      { x: mid, y: 34 + M.braceGap + M.braceDepth },
    ])
  })

  it('spans a non-adjacent group and marks its members with dots', () => {
    const a = rel('a', ['p', 'q', 'r'], 0, 0)
    const c = rel('c', ['s', 't'], 0, 250)
    const doc = docWith([a, c], [ref('x', ['a', ['a.r', 'a.p']], ['c', ['c.s', 'c.t']])])
    const [g] = geometryOf(doc)
    const l = layoutRelation(a, m)
    expect(g!.dots.map((d) => d.x)).toEqual([l.cells[0]!.x + l.cells[0]!.width / 2, l.cells[2]!.x + l.cells[2]!.width / 2])
  })

  it('follows table moves and attribute reordering, by attribute ID', () => {
    let doc = docWith([KLANT, BESTELLING], [ref('x', ['b', ['b.klantnr']], ['k', ['k.klantnr']])])
    const before = geometryOf(doc)[0]!
    doc = apply(doc, { type: 'moveRelation', relationId: 'b', position: { x: 300, y: 400 } })
    doc = apply(doc, { type: 'shiftAttributes', attributeIds: ['b.klantnr'], delta: -1 })
    const after = geometryOf(doc)[0]!
    const b = layoutRelation(doc.relations[1]!, m)
    const cell = b.cells.find((c) => c.attributeId === 'b.klantnr')!
    expect(after.points[0]).toEqual({ x: cell.x + cell.width / 2, y: b.y })
    expect(after.points[0]).not.toEqual(before.points[0])
  })

  it('keeps parallel runs apart', () => {
    const a = rel('a', ['p', 'q'], 0, 0)
    const c = rel('c', ['s', 't'], 300, 0)
    const doc = docWith([a, c], [ref('x', ['a', ['a.p']], ['c', ['c.s']]), ref('y', ['a', ['a.q']], ['c', ['c.t']])])
    const [g, h] = geometryOf(doc)
    expect(Math.abs(g!.points[1]!.y - h!.points[1]!.y)).toBeGreaterThanOrEqual(M.lane)
  })

  it('includes connectors and braces in the content bounds', () => {
    const plain = docWith([rel('a', ['p'], 0, 0), rel('c', ['s'], 300, 0)])
    const linked = { ...plain, references: [ref('x', ['a', ['a.p']], ['c', ['c.s']])] }
    const b1 = contentBounds(plain, m, false)!
    const b2 = contentBounds(linked, m, false)!
    expect(b2.y + b2.height).toBeGreaterThan(b1.y + b1.height + M.clearance)
  })
})

// --- State machine ------------------------------------------------------------------------------

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
const cell = (s: AppState, table: number, name: string): CanvasTarget => {
  const r = s.doc.relations[table]!
  const a = r.attributes.find((x) => x.name === name)!
  return { kind: 'attribute', relationId: r.id, attributeId: a.id }
}
/** Selects the foreign-key cells (one table) by clicks, then "Reference". */
function referenceFrom(s: AppState, table: number, ...names: string[]): AppState {
  s = click(s, { kind: 'empty' })
  s = click(s, cell(s, table, names[0]!))
  if (names.length > 1) s = run(s, { type: 'ui', patch: { multiSelect: true } })
  for (const n of names.slice(1)) s = click(s, cell(s, table, n))
  return run(s, { type: 'startReference' })
}
const message = (s: AppState) => s.ui.message?.text ?? null

/** Two tables built through the UI: Klant(klantnr, naam) at the top, Bestelling(ordernr, datum, klantnr) below. */
function twoTables(): AppState {
  let s = initialState(docWith([rel('k', ['klantnr', 'naam'], 0, 0, 'Klant'), rel('b', ['ordernr', 'datum', 'klantnr'], 0, 200, 'Bestelling')]))
  s = run(s, { type: 'command', command: addSourceFields(['unused'])! })
  return s
}

describe('Reference mode', () => {
  it('creates a simple reference with clicks: select the foreign key, Reference, click the referenced cell', () => {
    let s = referenceFrom(twoTables(), 1, 'klantnr')
    expect(s.ui.operation).toEqual({ kind: 'reference', source: ['b.klantnr'] })
    s = click(s, cell(s, 0, 'klantnr'))
    expect(s.doc.references).toHaveLength(1)
    expect(s.doc.references[0]).toMatchObject({ from: { relationId: 'b', attributeIds: ['b.klantnr'] }, to: { relationId: 'k', attributeIds: ['k.klantnr'] } })
    expect(s.ui.operation.kind).toBe('select')
    expect(s.ui.selection).toEqual({ kind: 'reference', referenceId: s.doc.references[0]!.id })
    // One undo step.
    s = run(s, { type: 'undo' })
    expect(s.doc.references).toEqual([])
    expect(s.ui.selection.kind).toBe('none')
  })

  it('one click picks a composite end: that many side-by-side cells from the clicked one, shifted to fit', () => {
    const doc = docWith([rel('r', ['a', 'ordernr', 'regelnr', 'b'], 0, 0), rel('l', ['levnr', 'ordernr', 'regelnr'], 0, 250)])
    const source = ['l.regelnr', 'l.ordernr']
    expect(referenceBlock(doc, source, 'r.ordernr')).toEqual(['r.ordernr', 'r.regelnr'])
    expect(referenceBlock(doc, source, 'r.b')).toEqual(['r.regelnr', 'r.b']) // the last cell: shifted left to fit
    expect(referenceBlock(docWith([rel('r', ['x'])]), source, 'r.x')).toBeNull() // too short

    let s = referenceFrom(initialState(doc), 1, 'regelnr', 'ordernr') // click order does not matter
    s = click(s, cell(s, 0, 'ordernr'))
    expect(s.doc.references[0]!.from.attributeIds).toEqual(['l.ordernr', 'l.regelnr'])
    expect(s.doc.references[0]!.to.attributeIds).toEqual(['r.ordernr', 'r.regelnr'])
  })

  it('a table with too few attributes explains and keeps the operation', () => {
    let s = initialState(docWith([rel('r', ['ordernr'], 0, 0), rel('l', ['ordernr', 'regelnr'], 0, 250)]))
    s = referenceFrom(s, 1, 'ordernr', 'regelnr')
    s = click(s, cell(s, 0, 'ordernr'))
    expect(s.doc.references).toEqual([])
    expect(message(s)).toBe('This table has only 1 attribute; the foreign key has 2.')
    expect(s.ui.operation.kind).toBe('reference')
  })

  it('"Reference" needs a side-by-side selection, and explains otherwise', () => {
    let s = initialState(docWith([rel('l', ['ordernr', 'levnr', 'regelnr'], 0, 250)]))
    s = referenceFrom(s, 0, 'ordernr', 'regelnr')
    expect(s.ui.operation.kind).toBe('select')
    expect(message(s)).toMatch(/next to each other/)
    expect(message(run(twoTables(), { type: 'startReference' }))).toBe(NO_ATTRIBUTES_MESSAGE)
  })
})

describe('reference ends as units', () => {
  // Levering(levnr, ordernr, regelnr, datum) with (ordernr, regelnr) → Regel(ordernr, regelnr).
  const units = () =>
    initialState(
      docWith(
        [rel('r', ['ordernr', 'regelnr'], 0, 0), rel('l', ['levnr', 'ordernr', 'regelnr', 'datum'], 0, 250)],
        [ref('x', ['l', ['l.ordernr', 'l.regelnr']], ['r', ['r.ordernr', 'r.regelnr']])],
      ),
    )
  const names = (s: AppState, i: number) => s.doc.relations[i]!.attributes.map((a) => a.name)
  const shift = (s: AppState, ids: string[], delta: -1 | 1) => run(s, { type: 'command', command: { type: 'shiftAttributes', attributeIds: ids, delta } })

  it('← → on part of an end reorder inside it, and move the block once at its edge', () => {
    // Inside: regelnr ← swaps with ordernr; the pairing follows the table order.
    let s = shift(units(), ['l.regelnr'], -1)
    expect(names(s, 1)).toEqual(['levnr', 'regelnr', 'ordernr', 'datum'])
    expect(s.doc.references[0]!.from.attributeIds).toEqual(['l.regelnr', 'l.ordernr'])
    expect(s.doc.references[0]!.to.attributeIds).toEqual(['r.ordernr', 'r.regelnr'])
    // At the block's left edge: the next ← moves the whole block.
    s = shift(s, ['l.regelnr'], -1)
    expect(names(s, 1)).toEqual(['regelnr', 'ordernr', 'levnr', 'datum'])
    // At the table's edge nothing moves: no change, no history step.
    const before = s.history.past.length
    s = shift(s, ['l.regelnr'], -1)
    expect(s.history.past).toHaveLength(before)
    // One undo per press.
    s = run(s, { type: 'undo' }, { type: 'undo' })
    expect(names(s, 1)).toEqual(['levnr', 'ordernr', 'regelnr', 'datum'])
    expect(s.doc.references[0]!.from.attributeIds).toEqual(['l.ordernr', 'l.regelnr'])
  })

  it('← → on a whole end move it as a block', () => {
    let s = shift(units(), ['l.ordernr', 'l.regelnr'], 1)
    expect(names(s, 1)).toEqual(['levnr', 'datum', 'ordernr', 'regelnr'])
    s = shift(s, ['l.ordernr', 'l.regelnr'], -1)
    s = shift(s, ['l.ordernr', 'l.regelnr'], -1)
    expect(names(s, 1)).toEqual(['ordernr', 'regelnr', 'levnr', 'datum'])
  })

  it('another attribute jumps over the whole block', () => {
    const s = shift(units(), ['l.levnr'], 1)
    expect(names(s, 1)).toEqual(['ordernr', 'regelnr', 'levnr', 'datum'])
    expect(names(shift(units(), ['l.datum'], -1), 1)).toEqual(['levnr', 'datum', 'ordernr', 'regelnr'])
  })

  it('the referenced end can be reordered inside too, changing the pairing', () => {
    const s = shift(units(), ['r.regelnr'], -1)
    expect(names(s, 0)).toEqual(['regelnr', 'ordernr'])
    expect(s.doc.references[0]!.to.attributeIds).toEqual(['r.regelnr', 'r.ordernr'])
    // A whole table that is one end has nowhere to go as a block.
    expect(shift(s, ['r.regelnr'], -1).doc).toBe(s.doc)
  })

  it('never reorders inside overlapping ends in a way that separates one of them', () => {
    // a,b,c with ends (a,b) and (b,c): moving c left of b would split (b,c), so the block moves instead.
    const s0 = initialState(
      docWith(
        [rel('t', ['x', 'a', 'b', 'c'], 0, 0), rel('u', ['p', 'q'], 0, 250)],
        [ref('1', ['t', ['t.a', 't.b']], ['u', ['u.p', 'u.q']]), ref('2', ['t', ['t.b', 't.c']], ['u', ['u.p', 'u.q']])],
      ),
    )
    const s = shift(s0, ['t.c'], -1)
    expect(names(s, 0)).toEqual(['a', 'b', 'c', 'x'])
  })

  it('insertions never land between the members of an end', () => {
    let s = units()
    // Place a field "between" ordernr and regelnr of Levering: it goes to the nearer edge (here: after the block).
    s = run(s, { type: 'command', command: addSourceFields(['nieuw'])! })
    s = run(s, { type: 'toggleField', fieldId: s.doc.sourceFields[0]!.id }, { type: 'startPlace' })
    s = click(s, { ...(cell(s, 1, 'regelnr') as Extract<CanvasTarget, { kind: 'attribute' }>), side: 'before' })
    expect(names(s, 1)).toEqual(['levnr', 'ordernr', 'regelnr', 'nieuw', 'datum'])
    // Moving datum to between ordernr and regelnr: also after the block (a tie goes after).
    s = run(s, { type: 'command', command: { type: 'moveAttributes', attributeIds: ['l.datum'], destination: { kind: 'table', relationId: 'l', index: 2 } } })
    expect(names(s, 1)).toEqual(['levnr', 'ordernr', 'regelnr', 'datum', 'nieuw'])
    expect(geometryOf(s.doc)[0]!.dots).toEqual([])
  })

  it('explains impossible references without changing anything', () => {
    let s = referenceFrom(twoTables(), 1, 'klantnr')
    // A foreign-key attribute as its own target.
    const self = click(s, cell(s, 1, 'klantnr'))
    expect(message(self)).toMatch(/cannot refer to itself/)
    expect(self.doc).toBe(s.doc)
    // A block that is not side by side cannot happen; a block overlapping the foreign key in the same table explains too.
    s = referenceFrom(twoTables(), 1, 'datum', 'klantnr')
    expect(message(click(s, cell(s, 1, 'ordernr')))).toMatch(/cannot refer to itself/)
  })

  it('Escape cancels without touching the document; stray clicks do nothing', () => {
    let s = twoTables()
    const doc = s.doc
    s = referenceFrom(s, 1, 'klantnr')
    const op = s.ui.operation
    s = click(s, { kind: 'empty' })
    s = click(s, { kind: 'relation', relationId: 'k' })
    expect(s.ui.operation).toBe(op)
    s = run(s, { type: 'cancel' })
    expect(s.ui.operation.kind).toBe('select')
    expect(s.ui.selection).toEqual({ kind: 'attributes', attributeIds: ['b.klantnr'] })
    expect(s.doc).toBe(doc)
    expect(s.history.past).toHaveLength(1) // only the setup command
  })

  it('selects a reference by clicking it and deletes it in one undoable step', () => {
    let s = twoTables()
    s = run(s, { type: 'command', command: { type: 'addReference', reference: ref('x', ['b', ['b.klantnr']], ['k', ['k.klantnr']]) } })
    s = click(s, { kind: 'reference', referenceId: 'x' })
    expect(s.ui.selection).toEqual({ kind: 'reference', referenceId: 'x' })
    s = run(s, { type: 'command', command: { type: 'deleteReference', referenceId: 'x' } })
    expect(s.doc.references).toEqual([])
    expect(s.ui.selection.kind).toBe('none')
    s = run(s, { type: 'undo' })
    expect(s.doc.references).toHaveLength(1)
  })

  it('deleting a referenced table removes its references with one undo', () => {
    let s = twoTables()
    s = run(s, { type: 'command', command: { type: 'addReference', reference: ref('x', ['b', ['b.klantnr']], ['k', ['k.klantnr']]) } })
    s = run(s, { type: 'command', command: { type: 'deleteRelation', relationId: 'k' } })
    expect(s.doc.references).toEqual([])
    expect(message(s)).toMatch(/1 reference removed/)
    s = run(s, { type: 'undo' })
    expect(s.doc.relations).toHaveLength(2)
    expect(s.doc.references).toHaveLength(1)
  })
})

describe('Milestone 3 acceptance (state level)', () => {
  it('a simple and a two-column composite foreign key stay attached after moving and reordering', () => {
    // Order(ordernr, klantnr), Klant(klantnr), Regel(ordernr, regelnr), Levering(levnr, ordernr, regelnr).
    let s = initialState(
      docWith([
        rel('o', ['ordernr', 'klantnr'], 0, 0, 'Order'),
        rel('k', ['klantnr', 'naam'], 300, 0, 'Klant'),
        rel('r', ['ordernr', 'regelnr', 'aantal'], 0, 200, 'Regel'),
        rel('l', ['levnr', 'ordernr', 'regelnr'], 0, 400, 'Levering'),
      ]),
    )
    // Simple: Order.klantnr → Klant.klantnr.
    s = referenceFrom(s, 0, 'klantnr')
    s = click(s, cell(s, 1, 'klantnr'))
    // Composite: Levering(ordernr, regelnr) → Regel(ordernr, regelnr).
    s = referenceFrom(s, 3, 'ordernr', 'regelnr')
    s = click(s, cell(s, 2, 'ordernr'))
    expect(s.doc.references).toHaveLength(2)
    const refs = s.doc.references

    // Move tables, reorder attributes, and move the composite group to a new table.
    s = run(s, { type: 'command', command: { type: 'moveRelation', relationId: 'k', position: { x: 500, y: 300 } } })
    s = run(s, { type: 'command', command: { type: 'moveRelation', relationId: 'r', position: { x: 300, y: 600 } } })
    s = run(s, { type: 'command', command: { type: 'shiftAttributes', attributeIds: ['o.klantnr'], delta: -1 } })
    s = run(s, { type: 'command', command: { type: 'shiftAttributes', attributeIds: ['l.levnr'], delta: 1 } })
    s = click(click(s, { kind: 'empty' }), cell(s, 3, 'ordernr'))
    s = run(s, { type: 'startAttributes', kind: 'move' })
    s = click(s, { kind: 'empty' }, { x: 700, y: 700 })
    expect(s.doc.relations).toHaveLength(5)

    // Same references (ID and attribute order); the composite foreign key followed its attributes.
    expect(s.doc.references.map((r) => r.id)).toEqual(refs.map((r) => r.id))
    expect(s.doc.references[0]).toEqual(refs[0])
    const moved = s.doc.references[1]!
    expect(moved.from.attributeIds).toEqual(['l.ordernr', 'l.regelnr'])
    expect(moved.from.relationId).toBe(s.doc.relations[4]!.id)
    expect(parseDocument(JSON.parse(JSON.stringify(s.doc)))).toEqual(s.doc)

    // Both still have geometry: an arrow for the simple one, braces at both ends of the composite one.
    const g = geometryOf(s.doc)
    expect(g).toHaveLength(2)
    expect(g[0]!.braces).toHaveLength(0)
    expect(g[1]!.braces).toHaveLength(2)
  })
})
