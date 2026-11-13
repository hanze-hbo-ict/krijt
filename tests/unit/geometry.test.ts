import { describe, expect, it } from 'vitest'
import { contentBounds, estimateMeasurer as m, fitsInBand, labelParts, labelWidth, layoutRelation, METRICS, tableNameBox } from '../../src/geometry/layout'
import { fitToBounds, MAX_ZOOM, MIN_ZOOM, screenToWorld, worldToScreen, zoomAt } from '../../src/geometry/viewport'
import { emptyDocument, newAttribute, type Relation } from '../../src/model/types'

const rel = (names: string[], x = 0, y = 0, name: string | null = null): Relation => ({
  id: 'r1',
  name,
  position: { x, y },
  attributes: names.map((n, i) => newAttribute(`a${i}`, n)),
})

describe('strip layout', () => {
  it('places cells side by side from the table position, fitted to text with a minimum width', () => {
    const l = layoutRelation(rel(['Klantnummer', 'a', ''], 100, 50), m)
    expect(l.cells.map((c) => c.attributeId)).toEqual(['a0', 'a1', 'a2'])
    expect(l.cells[0]!.x).toBe(100)
    expect(l.cells[1]!.x).toBe(100 + l.cells[0]!.width)
    expect(l.cells[0]!.width).toBe(Math.ceil(11 * 8.4 + 2 * METRICS.cellPaddingX))
    expect(l.cells[1]!.width).toBe(METRICS.cellMinWidth)
    expect(l.cells[2]!.width).toBe(METRICS.cellMinWidth)
    expect(l.stripWidth).toBe(l.cells.reduce((s, c) => s + c.width, 0))
  })

  it('puts the header band above the strip and the + cell after it', () => {
    const l = layoutRelation(rel(['a'], 0, 100), m)
    expect(l.header.y + l.header.height).toBeLessThanOrEqual(100)
    expect(l.header).toMatchObject({ x: 0, width: l.stripWidth }) // exactly as wide as the table
    expect(l.addCell.x).toBe(l.stripWidth + METRICS.addCellGap)
  })

  it('keeps the band at the table width, growing to the left only for a name that needs more room', () => {
    expect(layoutRelation(rel(['a', 'b', 'c', 'd'], 0, 0, 'K'), m).header).toMatchObject({ x: 0, width: layoutRelation(rel(['a', 'b', 'c', 'd']), m).stripWidth })
    const name = 'Bestellingregel'
    const l = layoutRelation(rel(['a'], 0, 0, name), m)
    expect(l.header.x + l.header.width).toBe(l.stripWidth) // the band still ends where the strip ends
    const box = tableNameBox(l, name, m)
    expect(box.x + box.width).toBe(l.stripWidth) // right-aligned over the strip's end
    expect(box.x).toBeGreaterThanOrEqual(l.header.x + METRICS.gripWidth) // inside the band, beside the grip
    // "Add name" never widens the band: it shows only where it fits.
    expect(fitsInBand(layoutRelation(rel(['a']), m), 'Add name', m)).toBe(false)
    expect(fitsInBand(layoutRelation(rel(['a', 'b', 'c', 'd']), m), 'Add name', m)).toBe(true)
  })

  it('accounts for notation in the cell width without storing it in the name', () => {
    const plain = newAttribute('x', 'prijs')
    const marked = { ...plain, primaryKey: true, calculated: true, nullable: true }
    expect(labelParts(marked)).toEqual({ name: 'prijs', bold: true, underline: true, slash: true, superO: true })
    expect(labelWidth(labelParts(marked), m)).toBeGreaterThan(labelWidth(labelParts(plain), m))
    expect(marked.name).toBe('prijs')
  })
})

describe('content bounds', () => {
  it('is null for an empty diagram', () => {
    expect(contentBounds(emptyDocument(), m)).toBeNull()
  })
  it('covers every table, including editor affordances when asked', () => {
    const doc = { ...emptyDocument(), relations: [rel(['a'], 0, 0), { ...rel(['b', 'c'], 300, 200), id: 'r2' }] }
    const editor = contentBounds(doc, m)!
    const exported = contentBounds(doc, m, false)!
    expect(editor.x).toBe(0)
    expect(editor.y).toBeLessThan(0) // header band above the first strip
    expect(exported.y).toBe(0) // unnamed tables export no header
    expect(exported.x + exported.width).toBe(300 + layoutRelation(doc.relations[1]!, m).stripWidth)
    expect(editor.x + editor.width).toBeGreaterThan(exported.x + exported.width)
  })
})

describe('viewport', () => {
  it('converts between screen and world coordinates', () => {
    const v = { x: 40, y: -10, zoom: 2 }
    const p = { x: 13, y: 7 }
    expect(screenToWorld(v, worldToScreen(v, p))).toEqual(p)
  })
  it('zooms around an anchor and clamps', () => {
    const v = { x: 0, y: 0, zoom: 1 }
    const anchor = { x: 200, y: 100 }
    const z = zoomAt(v, 2, anchor)
    expect(z.zoom).toBe(2)
    expect(worldToScreen(z, screenToWorld(v, anchor))).toEqual(anchor)
    expect(zoomAt(v, 100, anchor).zoom).toBe(MAX_ZOOM)
    expect(zoomAt(v, 0.001, anchor).zoom).toBe(MIN_ZOOM)
  })
  it('fits content into the view without enlarging past 100%', () => {
    const small = fitToBounds({ x: 0, y: 0, width: 100, height: 50 }, { width: 800, height: 600 })
    expect(small.zoom).toBe(1)
    const big = fitToBounds({ x: 100, y: 100, width: 2000, height: 500 }, { width: 800, height: 600 })
    expect(big.zoom).toBeCloseTo((800 - 80) / 2000)
    const topLeft = worldToScreen(big, { x: 100, y: 100 })
    expect(topLeft.x).toBeCloseTo(40)
  })
})
