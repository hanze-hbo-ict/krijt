/** Milestone 4: export scene, clipboard results and errors, JSON serialization, Clear diagram, recovery status. */
import { describe, expect, it } from 'vitest'
import { applyCommand } from '../../src/commands/commands'
import { copyImage, copyText, failureMessage, type ClipboardEnv } from '../../src/clipboard/clipboard'
import {
  EXPORT_MARGIN,
  exportScale,
  exportScene,
  EXPORT_SCALE,
  MAX_EXPORT_AREA,
  MAX_EXPORT_SIDE,
  type SceneOp,
} from '../../src/clipboard/scene'
import { contentBounds, estimateMeasurer as m, fontFor, layoutRelation, METRICS } from '../../src/geometry/layout'
import { exportTables, serializeDocument } from '../../src/model/serialize'
import { emptyDocument, newAttribute, type KrijtDocument, type Reference, type Relation } from '../../src/model/types'
import { readSession, SESSION_KEY, serializeSession } from '../../src/persistence/session'
import { initialState, reducer } from '../../src/state/appState'

const rel = (id: string, names: string[], x = 0, y = 0, name: string | null = null): Relation => ({
  id,
  name,
  position: { x, y },
  attributes: names.map((n) => newAttribute(`${id}.${n}`, n)),
})
const ref = (id: string, from: [string, string[]], to: [string, string[]]): Reference => ({
  id,
  from: { relationId: from[0], attributeIds: from[1] },
  to: { relationId: to[0], attributeIds: to[1] },
})
const docWith = (relations: Relation[], references: Reference[] = []): KrijtDocument => ({ ...emptyDocument(), relations, references })

function sample(): KrijtDocument {
  const klant = rel('k', ['klantnr', 'naam'], 0, 0, 'Klant')
  klant.attributes[0]!.primaryKey = true
  const order = rel('o', ['ordernr', 'klantnr', 'totaal'], 0, 200)
  order.attributes[2] = { ...order.attributes[2]!, nullable: true, calculated: true }
  const regel = rel('r', ['ordernr', 'regelnr'], 300, 0)
  const lev = rel('l', ['ordernr', 'regelnr', 'datum'], 300, 200)
  return {
    ...docWith([klant, order, regel, lev], [ref('x', ['o', ['o.klantnr']], ['k', ['k.klantnr']]), ref('y', ['l', ['l.ordernr', 'l.regelnr']], ['r', ['r.ordernr', 'r.regelnr']])]),
    sourceFields: [{ id: 'f1', label: 'Klantnr' }],
  }
}
const texts = (ops: SceneOp[]) => ops.filter((o): o is Extract<SceneOp, { kind: 'text' }> => o.kind === 'text')

describe('export scene', () => {
  it('is empty for a diagram without tables', () => {
    expect(exportScene(emptyDocument(), m)).toBeNull()
  })

  it('draws cells, notation and names, but none of the editor chrome', () => {
    const scene = exportScene(sample(), m)!
    const t = texts(scene.ops)
    // Primary key: bold name plus an underline exactly under the name.
    const pk = t.find((o) => o.text === 'klantnr' && o.font === fontFor('bold'))!
    const underline = scene.ops.find((o) => o.kind === 'line')!
    expect(underline).toMatchObject({ x1: pk.x, x2: pk.x + m.width('klantnr', 'bold'), y1: pk.y + 3 })
    // Calculated + nullable: "/" first, then the name, then a raised, smaller "o".
    const name = t.find((o) => o.text === 'totaal')!
    const slash = t.find((o) => o.text === '/')!
    const o = t.find((x) => x.text === 'o')!
    expect(name.x).toBeCloseTo(slash.x + m.width('/', 'suffix'))
    expect(o.x).toBeGreaterThan(name.x + m.width('totaal', 'regular'))
    expect(o.y).toBe(name.y - 6)
    expect(o.font).toBe(fontFor('superscript'))
    // Table names appear only for named tables, in capitals and right-aligned over the strip; nothing like "Unnamed".
    const klant = t.find((x) => x.text === 'KLANT')!
    const strip = layoutRelation(sample().relations[0]!, m)
    expect(klant.x + m.width('KLANT', 'label')).toBeCloseTo(strip.x + strip.stripWidth - METRICS.namePadding)
    expect(t.some((x) => /unnamed|add name|\+/i.test(x.text))).toBe(false)
    // One rectangle per attribute, and nothing for header bands or + cells.
    expect(scene.ops.filter((x) => x.kind === 'rect')).toHaveLength(10)
  })

  it('draws connectors, arrowheads and braces at both ends of a composite reference', () => {
    const ops = exportScene(sample(), m)!.ops
    const paths = ops.filter((o): o is Extract<SceneOp, { kind: 'path' }> => o.kind === 'path')
    expect(paths.filter((p) => p.fill)).toHaveLength(2) // two arrowheads
    // Simple: line + arrow. Composite: line + two braces + arrow.
    expect(paths.filter((p) => !p.fill)).toHaveLength(1 + 3)
  })

  it('crops to content plus a margin, including connectors and braces', () => {
    const doc = sample()
    const scene = exportScene(doc, m)!
    const content = contentBounds(doc, m, false)!
    expect(scene.bounds.x).toBeLessThanOrEqual(content.x - EXPORT_MARGIN)
    expect(scene.bounds.x + scene.bounds.width).toBeGreaterThanOrEqual(content.x + content.width + EXPORT_MARGIN)
    // A connector routed below everything widens the picture beyond the strips.
    const side = docWith([rel('a', ['p'], 0, 0), rel('b', ['q'], 300, 0)], [ref('z', ['a', ['a.p']], ['b', ['b.q']])])
    const strips = layoutRelation(side.relations[0]!, m)
    expect(exportScene(side, m)!.bounds.height).toBeGreaterThan(strips.height + 2 * EXPORT_MARGIN + 20)
  })

  it('uses 2× when it fits, shrinks for big diagrams, and refuses unreadably small output', () => {
    expect(exportScale({ x: 0, y: 0, width: 800, height: 600 })).toBe(EXPORT_SCALE)
    const wide = exportScale({ x: 0, y: 0, width: 6000, height: 400 })!
    expect(wide * 6000).toBeLessThanOrEqual(MAX_EXPORT_SIDE)
    const big = exportScale({ x: 0, y: 0, width: 3000, height: 3000 })!
    expect(big * big * 9_000_000).toBeLessThanOrEqual(MAX_EXPORT_AREA + 1)
    expect(exportScale({ x: 0, y: 0, width: 20000, height: 400 })).toBeNull()
  })
})

// --- Clipboard -----------------------------------------------------------------------------------

class FakeItem {
  constructor(public items: Record<string, Blob | Promise<Blob>>) {}
}
const blob = () => Promise.resolve(new Blob(['png'], { type: 'image/png' }))
const domError = (name: string) => Object.assign(new Error(`${name} happened`), { name })

function env(write?: (items: unknown[]) => Promise<void>, extra: Partial<ClipboardEnv> = {}): ClipboardEnv & { writes: unknown[][] } {
  const writes: unknown[][] = []
  return {
    isSecureContext: true,
    clipboard: {
      write: write
        ? (items) => {
            writes.push(items)
            return write(items)
          }
        : undefined,
      writeText: async () => undefined,
    },
    ClipboardItem: FakeItem as never,
    writes,
    ...extra,
  }
}

describe('copy image', () => {
  it('writes one image/png item, passing the rendering as a promise (no await before the write)', async () => {
    const e = env(async () => undefined)
    let rendered = false
    const result = await copyImage(e, () => {
      rendered = true
      return blob()
    })
    expect(result).toEqual({ ok: true })
    expect(rendered).toBe(true)
    const item = e.writes[0]![0] as FakeItem
    expect(Object.keys(item.items)).toEqual(['image/png'])
    expect(item.items['image/png']).toBeInstanceOf(Promise)
  })

  it('reports blocked permission and does not claim success', async () => {
    const r = await copyImage(env(() => Promise.reject(domError('NotAllowedError'))), blob)
    expect(r).toMatchObject({ ok: false, reason: 'blocked' })
    expect(failureMessage('image', 'blocked')).toMatch(/blocked the clipboard/)
  })

  it('reports unsupported browsers and insecure pages before touching the clipboard', async () => {
    let rendered = false
    const render = () => {
      rendered = true
      return blob()
    }
    expect(await copyImage(env(undefined), render)).toMatchObject({ ok: false, reason: 'unsupported' })
    expect(await copyImage(env(async () => undefined, { ClipboardItem: undefined }), render)).toMatchObject({ ok: false, reason: 'unsupported' })
    expect(await copyImage(env(async () => undefined, { isSecureContext: false }), render)).toMatchObject({ ok: false, reason: 'insecure' })
    expect(await copyImage({ isSecureContext: true }, render)).toMatchObject({ ok: false, reason: 'unsupported' })
    expect(rendered).toBe(false)
  })

  it('retries once with the finished blob when a promised item is rejected for another reason', async () => {
    let calls = 0
    const e = env(async (items) => {
      calls++
      if ((items[0] as FakeItem).items['image/png'] instanceof Promise) throw new TypeError('promises not supported')
    })
    expect(await copyImage(e, blob)).toEqual({ ok: true })
    expect(calls).toBe(2)
    expect((e.writes[1]![0] as FakeItem).items['image/png']).toBeInstanceOf(Blob)
  })

  it('reports a rendering failure as a failure, never as success', async () => {
    const e = env(async (items) => {
      await (items[0] as FakeItem).items['image/png']
    })
    const r = await copyImage(e, () => Promise.reject(new Error('could not encode')))
    expect(r).toEqual({ ok: false, reason: 'failed', detail: 'could not encode' })
    expect(failureMessage('image', 'failed', 'could not encode')).toMatch(/Nothing was copied/)
  })
})

describe('copy data', () => {
  it('writes the text, or reports why not', async () => {
    let written = ''
    const ok = await copyText({ isSecureContext: true, clipboard: { writeText: async (t) => void (written = t) } }, 'abc')
    expect(ok).toEqual({ ok: true })
    expect(written).toBe('abc')
    expect(await copyText({ isSecureContext: true, clipboard: { writeText: () => Promise.reject(domError('NotAllowedError')) } }, 'x')).toMatchObject({
      reason: 'blocked',
    })
    expect(await copyText({ isSecureContext: true }, 'x')).toMatchObject({ reason: 'unsupported' })
    expect(await copyText({ isSecureContext: false, clipboard: { writeText: async () => undefined } }, 'x')).toMatchObject({ reason: 'insecure' })
  })

  it('describes the diagram as plain text: a block per table, *keys*, / and °, references inline', () => {
    expect(serializeDocument(sample())).toBe(
      [
        'KLANT',
        '  *klantnr*',
        '  naam',
        '',
        '#1',
        '  ordernr',
        '  klantnr → KLANT.klantnr',
        '  /totaal°',
        '',
        '#2',
        '  ordernr',
        '  regelnr',
        '',
        '#3',
        '  ordernr',
        '  regelnr',
        '  datum',
        '  (ordernr, regelnr) → #2(ordernr, regelnr)',
        '',
      ].join('\n'),
    )
  })

  it('has no UI state, layout, form fields or internal IDs, and gives the same text for the same diagram', () => {
    const doc = sample()
    const text = serializeDocument(doc)
    expect(text).not.toMatch(/viewport|selection|sidebar|position/)
    expect(text).not.toContain('Klantnr') // the form field (capitalised in the sample) is not exported
    for (const r of doc.relations) for (const a of r.attributes) expect(text).not.toContain(a.id)
    expect(serializeDocument(structuredClone(doc))).toBe(text)
  })

  it('suffixes repeated table names (ignoring case) and column names by occurrence, and numbers unnamed tables', () => {
    const doc = docWith([rel('a', ['x'], 0, 0, 'Foo'), rel('b', ['x', 'x'], 0, 100), rel('c', ['y'], 0, 200, 'FOO'), rel('d', ['z'], 0, 300)])
    doc.relations[1]!.attributes[1] = { ...doc.relations[1]!.attributes[1]!, id: 'b.x#2' }
    doc.references = [ref('r', ['d', ['d.z']], ['b', ['b.x#2']])]
    const out = exportTables(doc)
    expect(out.map((t) => t.name)).toEqual(['FOO', '#1', 'FOO#2', '#2'])
    expect(out[1]!.columns).toEqual(['x', 'x#2'])
    expect(out[3]!.columns).toEqual(['z → #1.x#2'])
  })

  it('writes / before and ° after the name, wraps keys whole in asterisks (duplicate suffix inside), never marks references', () => {
    const t = rel('t', ['a', 'b', 'c', 'd', 'a'])
    const set = (i: number, f: Partial<Record<'primaryKey' | 'nullable' | 'calculated', boolean>>) =>
      (t.attributes[i] = { ...t.attributes[i]!, ...f })
    set(0, { primaryKey: true, nullable: true, calculated: true })
    set(1, { nullable: true })
    set(2, { calculated: true })
    set(4, { primaryKey: true })
    t.attributes[4] = { ...t.attributes[4]!, id: 't.a#2' }
    const u = rel('u', ['fk'], 0, 200)
    const out = exportTables(docWith([t, u], [ref('r', ['u', ['u.fk']], ['t', ['t.a']])]))
    expect(out[0]!.columns).toEqual(['*/a°*', 'b°', '/c', 'd', '*a#2*'])
    expect(out[1]!.columns).toEqual(['fk → #1.a'])
  })

  it('lists several single-column references from one column comma-separated, in order', () => {
    const doc = docWith([rel('a', ['id'], 0, 0, 'A'), rel('b', ['id'], 0, 100, 'B'), rel('c', ['ref', 'other'], 0, 200, 'C')], [
      ref('1', ['c', ['c.ref']], ['a', ['a.id']]),
      ref('2', ['c', ['c.other']], ['a', ['a.id']]),
      ref('3', ['c', ['c.ref']], ['b', ['b.id']]),
    ])
    const c = exportTables(doc)[2]!
    expect(c.columns).toEqual(['ref → A.id, B.id', 'other → A.id'])
    expect(c.references).toEqual([])
  })

  it('keeps the notation on the referencing column and writes composite references after the columns', () => {
    const a = rel('a', ['p', 'q'], 0, 0, 'A')
    const b = rel('b', ['x', 'y', 'z'], 0, 200, 'B')
    b.attributes[0] = { ...b.attributes[0]!, primaryKey: true }
    const doc = docWith([a, b], [ref('1', ['b', ['b.x']], ['a', ['a.p']]), ref('2', ['b', ['b.y', 'b.z']], ['a', ['a.p', 'a.q']])])
    expect(serializeDocument(doc)).toBe('A\n  p\n  q\n\nB\n  *x* → A.p\n  y\n  z\n  (y, z) → A(p, q)\n')
  })

  it('is empty for a diagram without tables', () => {
    expect(serializeDocument(emptyDocument())).toBe('')
  })
})

describe('Clear diagram', () => {
  it('clears tables and references, keeping or clearing the form fields, in one undoable step', () => {
    let s = initialState(sample())
    s = reducer(s, { type: 'command', command: { type: 'clearDocument', keepFields: true } })
    expect(s.doc.relations).toEqual([])
    expect(s.doc.references).toEqual([])
    expect(s.doc.sourceFields).toHaveLength(1)
    s = reducer(s, { type: 'undo' })
    expect(s.doc).toEqual(sample())
    const all = applyCommand(sample(), { type: 'clearDocument', keepFields: false })
    expect(all.ok && all.doc).toEqual(emptyDocument())
    // Clearing an empty diagram changes nothing and adds no history.
    const empty = reducer(initialState(), { type: 'command', command: { type: 'clearDocument', keepFields: false } })
    expect(empty.history.past).toHaveLength(0)
  })
})

describe('recovery status', () => {
  const store = (value: string | null, throws = false): Storage =>
    ({
      getItem: (k: string) => {
        if (throws) throw new Error('denied')
        return k === SESSION_KEY ? value : null
      },
    }) as Storage

  it('tells apart nothing stored, restored, and unusable data', () => {
    expect(readSession(null).status).toBe('none')
    expect(readSession(store(null)).status).toBe('none')
    const good = serializeSession({ doc: sample(), ui: { viewport: { x: 0, y: 0, zoom: 1 }, sidebarCollapsed: false } })
    expect(readSession(store(good))).toMatchObject({ status: 'restored', data: { doc: sample() } })
    for (const bad of ['{', '"x"', JSON.stringify({ version: 2, doc: sample() }), JSON.stringify({ version: 1, doc: { format: 'krijt' } })])
      expect(readSession(store(bad))).toEqual({ status: 'unreadable', data: null })
    expect(readSession(store(good, true)).status).toBe('unreadable')
  })
})
