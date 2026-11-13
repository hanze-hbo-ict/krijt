import { describe, expect, it } from 'vitest'
import { applyCommand } from '../../src/commands/commands'
import { addSourceFields, createRelationFromNames } from '../../src/commands/builders'
import { DEFAULT_VIEWPORT } from '../../src/geometry/viewport'
import { emptyDocument, type KrijtDocument } from '../../src/model/types'
import { parseDocument } from '../../src/model/validate'
import { loadSession, parseSession, saveSession, serializeSession, SESSION_KEY } from '../../src/persistence/session'

class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  failWrites = false
  get length() {
    return this.map.size
  }
  clear() {
    this.map.clear()
  }
  getItem(k: string) {
    return this.map.get(k) ?? null
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new DOMException('quota', 'QuotaExceededError')
    this.map.set(k, v)
  }
}

function sampleDoc(): KrijtDocument {
  let doc = emptyDocument()
  for (const cmd of [addSourceFields(['Klantnr', 'Naam', 'Café']), createRelationFromNames(['Klantnr', 'Naam'], { x: 10, y: 20 })]) {
    const r = applyCommand(doc, cmd!)
    if (!r.ok) throw new Error(r.error)
    doc = r.doc
  }
  return { ...doc, relations: doc.relations.map((r) => ({ ...r, name: 'Klant' })) }
}

describe('session recovery', () => {
  it('round-trips document and layout state', () => {
    const storage = new MemoryStorage()
    const doc = sampleDoc()
    const ui = { viewport: { x: 12, y: -4, zoom: 1.5 }, sidebarCollapsed: true, theme: 'dark' as const }
    expect(saveSession(storage, { doc, ui })).toBe(true)
    expect(loadSession(storage)).toEqual({ doc, ui })
  })

  it('returns null for missing, corrupt or incompatible data, without throwing', () => {
    const doc = sampleDoc()
    const good = JSON.parse(serializeSession({ doc, ui: { viewport: DEFAULT_VIEWPORT, sidebarCollapsed: false, theme: 'system' } }))
    const cases: (string | null)[] = [
      null,
      '',
      '{not json',
      'null',
      '[]',
      '42',
      JSON.stringify({ ...good, version: 2 }),
      JSON.stringify({ ...good, doc: { ...good.doc, version: 2 } }),
      JSON.stringify({ ...good, doc: { ...good.doc, format: 'other' } }),
      JSON.stringify({ ...good, doc: { ...good.doc, relations: 'x' } }),
      JSON.stringify({ ...good, doc: { ...good.doc, relations: [{ ...good.doc.relations[0], attributes: [] }] } }),
      JSON.stringify({ ...good, doc: { ...good.doc, relations: [{ ...good.doc.relations[0], position: { x: 'a', y: 0 } }] } }),
    ]
    for (const raw of cases) expect(parseSession(raw)).toBeNull()
  })

  it('rejects duplicate IDs and dangling references', () => {
    const doc = sampleDoc()
    const r = doc.relations[0]!
    const dupe = { ...doc, sourceFields: [...doc.sourceFields, { id: r.id, label: 'x' }] }
    expect(parseDocument(JSON.parse(JSON.stringify(dupe)))).toBeNull()
    const dangling = {
      ...doc,
      references: [{ id: 'ref', from: { relationId: r.id, attributeIds: ['nope'] }, to: { relationId: r.id, attributeIds: [r.attributes[0]!.id] } }],
    }
    expect(parseDocument(JSON.parse(JSON.stringify(dangling)))).toBeNull()
  })

  it('falls back to defaults for odd UI values but keeps the document', () => {
    const doc = sampleDoc()
    const raw = JSON.stringify({ version: 1, doc, ui: { viewport: { x: 0, y: 0, zoom: 99 }, sidebarCollapsed: 'yes', theme: 'sepia' } })
    expect(parseSession(raw)).toEqual({ doc, ui: { viewport: DEFAULT_VIEWPORT, sidebarCollapsed: false, theme: 'system' } })
  })

  it('keeps ticks, and rejects a tick that is not a boolean', () => {
    const doc = sampleDoc()
    const ticked = { ...doc, sourceFields: doc.sourceFields.map((f, i) => (i === 0 ? { ...f, ticked: true as const } : f)) }
    expect(parseDocument(JSON.parse(JSON.stringify(ticked)))).toEqual(ticked)
    const unticked = { ...doc, sourceFields: doc.sourceFields.map((f) => ({ ...f, ticked: false })) }
    expect(parseDocument(JSON.parse(JSON.stringify(unticked)))).toEqual(doc)
    const bad = { ...doc, sourceFields: doc.sourceFields.map((f) => ({ ...f, ticked: 'yes' })) }
    expect(parseDocument(JSON.parse(JSON.stringify(bad)))).toBeNull()
  })

  it('reports failed writes instead of throwing', () => {
    const storage = new MemoryStorage()
    storage.failWrites = true
    expect(saveSession(storage, { doc: emptyDocument(), ui: { viewport: DEFAULT_VIEWPORT, sidebarCollapsed: false, theme: 'system' } })).toBe(false)
    expect(saveSession(null, { doc: emptyDocument(), ui: { viewport: DEFAULT_VIEWPORT, sidebarCollapsed: false, theme: 'system' } })).toBe(false)
    expect(storage.getItem(SESSION_KEY)).toBeNull()
  })
})
