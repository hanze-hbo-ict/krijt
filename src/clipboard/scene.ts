/**
 * The export picture of a diagram, as a pure list of drawing operations.
 *
 * It comes from the same document and the same geometry as the canvas
 * (layoutRelation, layoutReferences), but shows only the diagram: strips,
 * notation, table names, connectors and braces, in dark ink on white. No
 * header bands, grips, "+" cells, selection, end marks or grid.
 *
 * Keeping the scene separate from painting makes it testable without a
 * browser; paint.ts draws it onto a 2D canvas.
 */
import { contentBounds, fontFor, labelParts, layoutRelation, METRICS, type Rect, type RelationLayout, type TextMeasurer } from '../geometry/layout'
import { layoutReferences, polylinePath, REFERENCE_METRICS } from '../geometry/references'
import type { Id, KrijtDocument } from '../model/types'

export const EXPORT_INK = '#111827'
export const EXPORT_PAPER = '#ffffff'
/** White space around the content, in diagram units. */
export const EXPORT_MARGIN = 24
/** Preferred pixels per diagram unit: crisp on high-density screens and when an answer is zoomed. */
export const EXPORT_SCALE = 2
/** Canvas limits that hold in every current browser (Safari's area limit is the tightest). */
export const MAX_EXPORT_SIDE = 8192
export const MAX_EXPORT_AREA = 16_000_000
/** Below this the text would be too small to read. */
export const MIN_EXPORT_SCALE = 0.75

export type SceneOp =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; lineWidth: number }
  | { kind: 'text'; text: string; x: number; y: number; font: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; lineWidth: number }
  /** SVG path data, stroked (lineWidth) or filled. */
  | { kind: 'path'; d: string; lineWidth?: number; fill?: boolean }
  | { kind: 'dot'; x: number; y: number; r: number }

export type Scene = {
  /** The area to draw, in diagram units, margin included. */
  bounds: Rect
  ops: SceneOp[]
}

const CELL_LINE = 1.25
const UNDERLINE = 1.3
const CONNECTOR_LINE = 1.5

function relationOps(layout: RelationLayout, doc: KrijtDocument, relationId: Id, m: TextMeasurer, ops: SceneOp[]) {
  const r = doc.relations.find((x) => x.id === relationId)!
  if (r.name) {
    ops.push({
      kind: 'text',
      text: r.name,
      x: layout.x,
      y: layout.header.y + layout.header.height / 2 + METRICS.labelSize * 0.35,
      font: fontFor('label'),
    })
  }
  const textY = layout.y + METRICS.cellHeight / 2 + METRICS.fontSize * 0.35
  r.attributes.forEach((a, i) => {
    const c = layout.cells[i]!
    ops.push({ kind: 'rect', x: c.x, y: layout.y, width: c.width, height: layout.height, lineWidth: CELL_LINE })
    const parts = labelParts(a)
    const nameWidth = m.width(parts.name, parts.bold ? 'bold' : 'regular')
    const slashWidth = parts.slash ? m.width('/', 'suffix') : 0
    const total = nameWidth + slashWidth + (parts.superO ? 1 + m.width('o', 'superscript') : 0)
    const x = c.x + (c.width - total) / 2
    if (parts.name) ops.push({ kind: 'text', text: parts.name, x, y: textY, font: fontFor(parts.bold ? 'bold' : 'regular') })
    if (parts.underline && nameWidth > 0) ops.push({ kind: 'line', x1: x, y1: textY + 3, x2: x + nameWidth, y2: textY + 3, lineWidth: UNDERLINE })
    if (parts.slash) ops.push({ kind: 'text', text: '/', x: x + nameWidth, y: textY, font: fontFor('suffix') })
    if (parts.superO) ops.push({ kind: 'text', text: 'o', x: x + nameWidth + slashWidth + 1, y: textY - 6, font: fontFor('superscript') })
  })
}

/** The export scene, or null for a diagram without tables. */
export function exportScene(doc: KrijtDocument, m: TextMeasurer): Scene | null {
  if (doc.relations.length === 0) return null
  const content = contentBounds(doc, m, false)
  if (!content) return null
  const layouts = new Map<Id, RelationLayout>()
  for (const r of doc.relations) layouts.set(r.id, layoutRelation(r, m))

  const ops: SceneOp[] = []
  for (const r of doc.relations) relationOps(layouts.get(r.id)!, doc, r.id, m, ops)
  for (const g of layoutReferences(doc.references, layouts)) {
    ops.push({ kind: 'path', d: polylinePath(g.points), lineWidth: CONNECTOR_LINE })
    for (const b of g.braces) ops.push({ kind: 'path', d: b, lineWidth: CONNECTOR_LINE })
    ops.push({ kind: 'path', d: g.arrow, fill: true })
    for (const p of g.dots) ops.push({ kind: 'dot', x: p.x, y: p.y, r: REFERENCE_METRICS.memberDot })
  }
  const bounds = {
    x: Math.floor(content.x - EXPORT_MARGIN),
    y: Math.floor(content.y - EXPORT_MARGIN),
    width: Math.ceil(content.width + 2 * EXPORT_MARGIN),
    height: Math.ceil(content.height + 2 * EXPORT_MARGIN),
  }
  return { bounds, ops }
}

/** Pixels per diagram unit for an export of `bounds`, or null if even the smallest readable scale is too big. */
export function exportScale(bounds: Rect): number | null {
  const fits = Math.min(
    EXPORT_SCALE,
    MAX_EXPORT_SIDE / bounds.width,
    MAX_EXPORT_SIDE / bounds.height,
    Math.sqrt(MAX_EXPORT_AREA / (bounds.width * bounds.height)),
  )
  return fits >= MIN_EXPORT_SCALE ? fits : null
}
