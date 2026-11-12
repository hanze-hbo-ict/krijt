/**
 * Strip geometry, independent of React and of the DOM.
 *
 * Text widths come from a TextMeasurer: in the browser a canvas measurer using
 * the diagram font (measure.ts), in tests a deterministic estimate. The same
 * layout feeds the on-screen canvas and, later, the PNG export renderer.
 */
import type { Attribute, Id, KrijtDocument, Relation } from '../model/types'
import { layoutReferences } from './references'

export interface TextMeasurer {
  /** Width in diagram units of `text` at the given style. */
  width(text: string, style: TextStyle): number
}
export type TextStyle = 'regular' | 'bold' | 'suffix' | 'superscript' | 'label'

export const METRICS = {
  fontSize: 15,
  superscriptSize: 11,
  labelSize: 13,
  cellHeight: 34,
  cellPaddingX: 10,
  cellMinWidth: 44,
  /** Header band above the strip: the table's move handle and name. */
  headerHeight: 24,
  headerMinWidth: 96,
  /** The grip at the start of the header band, editor only. */
  gripWidth: 20,
  /** The "+" cell after the last attribute, editor only. */
  addCellWidth: 34,
  addCellGap: 6,
  /** Gap between the name/handle row and the strip. */
  headerGap: 2,
} as const

export const DIAGRAM_FONT_FAMILY = "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

export function fontFor(style: TextStyle): string {
  switch (style) {
    case 'bold':
      return `700 ${METRICS.fontSize}px ${DIAGRAM_FONT_FAMILY}`
    case 'superscript':
      return `400 ${METRICS.superscriptSize}px ${DIAGRAM_FONT_FAMILY}`
    case 'label':
      return `600 ${METRICS.labelSize}px ${DIAGRAM_FONT_FAMILY}`
    default:
      return `400 ${METRICS.fontSize}px ${DIAGRAM_FONT_FAMILY}`
  }
}

/**
 * How an attribute is written: its stored name plus notation. The notation is
 * derived from flags, never stored in the name. Order: name, `/`, superscript o.
 */
export type LabelParts = { name: string; bold: boolean; underline: boolean; slash: boolean; superO: boolean }

export function labelParts(a: Attribute): LabelParts {
  return { name: a.name, bold: a.primaryKey, underline: a.primaryKey, slash: a.calculated, superO: a.nullable }
}

export function labelWidth(parts: LabelParts, m: TextMeasurer): number {
  let w = m.width(parts.name, parts.bold ? 'bold' : 'regular')
  if (parts.slash) w += m.width('/', 'suffix')
  if (parts.superO) w += 1 + m.width('o', 'superscript')
  return w
}

export type CellBox = { attributeId: Id; x: number; width: number }

export type RelationLayout = {
  relationId: Id
  /** Strip origin (= relation.position). */
  x: number
  y: number
  stripWidth: number
  height: number
  cells: CellBox[]
  /** Header band (move handle + name), above the strip. */
  header: { x: number; y: number; width: number; height: number }
  /** The editor-only "+" cell, in absolute coordinates. */
  addCell: { x: number; y: number; width: number; height: number }
}

export function cellWidth(a: Attribute, m: TextMeasurer): number {
  return Math.max(METRICS.cellMinWidth, Math.ceil(labelWidth(labelParts(a), m) + 2 * METRICS.cellPaddingX))
}

export function layoutRelation(r: Relation, m: TextMeasurer): RelationLayout {
  const { x, y } = r.position
  const cells: CellBox[] = []
  let cursor = x
  for (const a of r.attributes) {
    const width = cellWidth(a, m)
    cells.push({ attributeId: a.id, x: cursor, width })
    cursor += width
  }
  const stripWidth = cursor - x
  const nameWidth = r.name ? METRICS.gripWidth + Math.ceil(m.width(r.name, 'label')) + METRICS.cellPaddingX : 0
  const headerHeight = METRICS.headerHeight
  return {
    relationId: r.id,
    x,
    y,
    stripWidth,
    height: METRICS.cellHeight,
    cells,
    header: {
      x,
      y: y - headerHeight - METRICS.headerGap,
      width: Math.max(stripWidth, METRICS.headerMinWidth, nameWidth),
      height: headerHeight,
    },
    addCell: { x: cursor + METRICS.addCellGap, y, width: METRICS.addCellWidth, height: METRICS.cellHeight },
  }
}

export type Rect = { x: number; y: number; width: number; height: number }

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.width)
    maxY = Math.max(maxY, r.y + r.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Bounds of everything drawn for the diagram. `editor` includes editor-only
 * affordances (header band, "+" cell); without it only what an export shows.
 * Connectors and braces are always included.
 */
export function contentBounds(doc: KrijtDocument, m: TextMeasurer, editor = true): Rect | null {
  const rects: Rect[] = []
  const layouts = new Map<Id, RelationLayout>()
  for (const r of doc.relations) {
    const l = layoutRelation(r, m)
    layouts.set(r.id, l)
    rects.push({ x: l.x, y: l.y, width: l.stripWidth, height: l.height })
    if (editor) {
      rects.push(l.header, l.addCell)
    } else if (r.name) {
      rects.push({ ...l.header, width: Math.ceil(m.width(r.name, 'label')) + 2 * METRICS.cellPaddingX })
    }
  }
  for (const g of layoutReferences(doc.references, layouts)) rects.push(g.bounds)
  return unionRects(rects)
}

/** A rough measurer: deterministic, for tests and as a fallback without a canvas. */
export const estimateMeasurer: TextMeasurer = {
  width(text, style) {
    const per = style === 'superscript' ? 6 : style === 'label' ? 7.5 : style === 'bold' ? 9 : 8.4
    return [...text].length * per
  },
}
