/**
 * Reference geometry: connectors and curly braces, independent of React and
 * of the DOM.
 *
 * Endpoints come from stable attribute IDs and the current strip layouts, so a
 * connector follows its cells whenever a table moves, attributes are reordered
 * or renamed, or text widths change. Routing is deliberately simple and
 * deterministic: orthogonal, three segments at most.
 *
 * - Target clearly below the source: leave the source strip at the bottom and
 *   enter the target strip at the top (a Z, or a straight line).
 * - Target clearly above: leave at the top, enter at the bottom.
 * - Otherwise (tables side by side, or one table): leave and enter at the
 *   bottom, with the horizontal run below both strips (a U).
 *
 * A one-attribute end touches the cell's edge. An end of several attributes
 * gets a curly brace spanning its cells, just outside the strip, and the
 * connector meets the brace's tip. Members of a brace that also spans
 * non-member cells are marked with a dot. The arrowhead is always at the
 * referenced end.
 */
import type { Id, Point, Reference, ReferenceEnd } from '../model/types'
import { unionRects, type Rect, type RelationLayout } from './layout'

export const REFERENCE_METRICS = {
  /** Gap between the strip edge and a brace. */
  braceGap: 3,
  /** Distance from a brace's ends to its tip. */
  braceDepth: 10,
  /** Inset of a brace from the outer edges of its first and last cells. */
  braceInset: 6,
  /** Minimum vertical run before the first bend. */
  clearance: 18,
  /** Spacing between parallel horizontal runs. */
  lane: 10,
  arrowLength: 9,
  arrowWidth: 8,
  memberDot: 2.2,
} as const

type Side = 'top' | 'bottom'

export type ReferenceGeometry = {
  referenceId: Id
  /** The connector's polyline, from the foreign-key end to the referenced end. */
  points: Point[]
  /** Filled arrowhead at the referenced end (SVG path data). */
  arrow: string
  /** Brace paths (SVG path data), one per end of several attributes. */
  braces: string[]
  /** Dots marking members of a brace that spans non-member cells. */
  dots: Point[]
  bounds: Rect
}

/** `range`: where along the edge the connector may meet this end (a straight line may use any x in it). */
type Anchor = { point: Point; brace: string | null; dots: Point[]; extent: Rect; range: [number, number] }

/**
 * A horizontal curly brace from x1 to x2; its back lies at y0 and its tip points `dir` (+1 down, -1 up).
 * The tip is at the middle unless `tipX` moves it (kept within the middle half, so the brace stays a brace).
 */
export function bracePath(x1: number, x2: number, y0: number, dir: 1 | -1, depth: number = REFERENCE_METRICS.braceDepth, tipX?: number): string {
  const mid = tipX ?? (x1 + x2) / 2
  const half = y0 + (dir * depth) / 2
  const tip = y0 + dir * depth
  const r = Math.max(0, Math.min(depth / 2, (x2 - x1) / 4))
  const f = (n: number) => Math.round(n * 100) / 100
  return [
    `M${f(x1)} ${f(y0)}`,
    `Q${f(x1)} ${f(half)} ${f(x1 + r)} ${f(half)}`,
    `L${f(mid - r)} ${f(half)}`,
    `Q${f(mid)} ${f(half)} ${f(mid)} ${f(tip)}`,
    `Q${f(mid)} ${f(half)} ${f(mid + r)} ${f(half)}`,
    `L${f(x2 - r)} ${f(half)}`,
    `Q${f(x2)} ${f(half)} ${f(x2)} ${f(y0)}`,
  ].join(' ')
}

function endAnchor(layout: RelationLayout, end: ReferenceEnd, side: Side, tipX?: number): Anchor | null {
  const members = new Set(end.attributeIds)
  const indices: number[] = []
  layout.cells.forEach((c, i) => members.has(c.attributeId) && indices.push(i))
  if (indices.length === 0 || indices.length !== members.size) return null
  const first = layout.cells[indices[0]!]!
  const last = layout.cells[indices[indices.length - 1]!]!
  const dir = side === 'bottom' ? 1 : -1
  const edgeY = side === 'bottom' ? layout.y + layout.height : layout.y
  if (indices.length === 1) {
    const centre = first.x + first.width / 2
    const range: [number, number] = [centre - first.width / 4, centre + first.width / 4]
    const x = tipX ?? centre
    return { point: { x, y: edgeY }, brace: null, dots: [], extent: { x, y: edgeY, width: 0, height: 0 }, range }
  }
  const M = REFERENCE_METRICS
  const x1 = first.x + M.braceInset
  const x2 = last.x + last.width - M.braceInset
  const y0 = edgeY + dir * M.braceGap
  const tipY = y0 + dir * M.braceDepth
  const spanned = indices[indices.length - 1]! - indices[0]! + 1
  const dots =
    spanned > indices.length ? indices.map((i) => ({ x: layout.cells[i]!.x + layout.cells[i]!.width / 2, y: y0 + (dir * M.braceDepth) / 2 })) : []
  const mid = (x1 + x2) / 2
  const range: [number, number] = [mid - (x2 - x1) / 4, mid + (x2 - x1) / 4]
  const x = tipX ?? mid
  return {
    point: { x, y: tipY },
    brace: bracePath(x1, x2, y0, dir, M.braceDepth, tipX),
    dots,
    extent: { x: x1, y: Math.min(y0, tipY), width: x2 - x1, height: M.braceDepth },
    range,
  }
}

function arrowPath(tip: Point, from: Point): string {
  const M = REFERENCE_METRICS
  const dx = tip.x - from.x
  const dy = tip.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const bx = tip.x - ux * M.arrowLength
  const by = tip.y - uy * M.arrowLength
  const px = -uy * (M.arrowWidth / 2)
  const py = ux * (M.arrowWidth / 2)
  const f = (n: number) => Math.round(n * 100) / 100
  return `M${f(tip.x)} ${f(tip.y)}L${f(bx + px)} ${f(by + py)}L${f(bx - px)} ${f(by - py)}Z`
}

type Run = { y: number; x1: number; x2: number }

/** Picks a y for a horizontal run that does not lie on top of an earlier one. */
function freeLane(runs: Run[], x1: number, x2: number, preferred: number, min: number, max: number): number {
  const M = REFERENCE_METRICS
  const taken = (y: number) => runs.some((r) => Math.abs(r.y - y) < M.lane - 0.5 && r.x1 <= x2 + 1 && x1 <= r.x2 + 1)
  for (let k = 0; k < 40; k++) {
    // 0, +1, -1, +2, -2, … lanes, kept within [min, max].
    const step = k === 0 ? 0 : (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2)
    const y = preferred + step * M.lane
    if (y < min || y > max) continue
    if (!taken(y)) return y
  }
  return preferred
}

function referenceGeometry(ref: Reference, layouts: Map<Id, RelationLayout>, runs: Run[]): ReferenceGeometry | null {
  const s = layouts.get(ref.from.relationId)
  const t = layouts.get(ref.to.relationId)
  if (!s || !t) return null
  const M = REFERENCE_METRICS
  const reach = M.braceGap + M.braceDepth
  const sBottom = s.y + s.height
  const tBottom = t.y + t.height
  // Above a strip lies its header band (handle and name); a run between two strips stays clear of it.
  const self = ref.from.relationId === ref.to.relationId
  const below = !self && t.header.y - (sBottom + reach) >= 2 * M.clearance
  const above = !self && s.header.y - (tBottom + reach) >= 2 * M.clearance

  let sideS: Side
  let sideT: Side
  if (below) [sideS, sideT] = ['bottom', 'top']
  else if (above) [sideS, sideT] = ['top', 'bottom']
  else [sideS, sideT] = ['bottom', 'bottom']

  let a = endAnchor(s, ref.from, sideS)
  let b = endAnchor(t, ref.to, sideT)
  if (!a || !b) return null
  // One table above the other and the ends overlap horizontally: a single straight line, without a jog.
  if (below || above) {
    const lo = Math.max(a.range[0], b.range[0])
    const hi = Math.min(a.range[1], b.range[1])
    if (lo <= hi && Math.abs(a.point.x - b.point.x) >= 0.5) {
      const x = Math.round(Math.min(hi, Math.max(lo, (a.point.x + b.point.x) / 2)) * 100) / 100
      a = endAnchor(s, ref.from, sideS, x)!
      b = endAnchor(t, ref.to, sideT, x)!
    }
  }
  const p = a.point
  const q = b.point
  const x1 = Math.min(p.x, q.x)
  const x2 = Math.max(p.x, q.x)

  let points: Point[]
  if (below || above) {
    if (Math.abs(p.x - q.x) < 0.5) points = [p, { x: p.x, y: q.y }]
    else {
      // Between the source's edge and the target's header (or the reverse), centred if possible.
      const lo = below ? p.y + M.clearance : q.y + M.clearance
      const hi = below ? t.header.y - M.clearance / 2 : s.header.y - M.clearance / 2
      const y = freeLane(runs, x1, x2, Math.round((lo + hi) / 2), lo, hi)
      runs.push({ y, x1, x2 })
      points = [p, { x: p.x, y }, { x: q.x, y }, q]
    }
  } else {
    const lo = Math.max(p.y, q.y) + M.clearance
    const y = freeLane(runs, x1, x2, lo, lo, lo + 40 * M.lane)
    runs.push({ y, x1, x2 })
    points = [p, { x: p.x, y }, { x: q.x, y }, q]
  }

  const arrow = arrowPath(q, points[points.length - 2]!)
  const braces = [a.brace, b.brace].filter((d): d is string => d !== null)
  const pad = M.arrowWidth / 2 + 1
  const xs = points.map((pt) => pt.x)
  const ys = points.map((pt) => pt.y)
  const line: Rect = {
    x: Math.min(...xs) - pad,
    y: Math.min(...ys) - pad,
    width: Math.max(...xs) - Math.min(...xs) + 2 * pad,
    height: Math.max(...ys) - Math.min(...ys) + 2 * pad,
  }
  return { referenceId: ref.id, points, arrow, braces, dots: [...a.dots, ...b.dots], bounds: unionRects([line, a.extent, b.extent])! }
}

/** Geometry for every reference whose ends can be found in `layouts`, in document order. */
export function layoutReferences(references: Reference[], layouts: Map<Id, RelationLayout>): ReferenceGeometry[] {
  const runs: Run[] = []
  const out: ReferenceGeometry[] = []
  for (const ref of references) {
    const g = referenceGeometry(ref, layouts, runs)
    if (g) out.push(g)
  }
  return out
}

export function polylinePath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${Math.round(p.x * 100) / 100} ${Math.round(p.y * 100) / 100}`).join(' ')
}
