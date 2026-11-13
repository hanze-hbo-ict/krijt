/**
 * Alignment snapping while a table is moved, like slide editors do: when the
 * moving strip's left or right edge (or top or bottom) comes close to the same
 * edge of another strip, the move is nudged so they line up exactly, and a
 * guide line shows it. A connector can also snap straight: when the moving
 * table sits above or below a table it shares a reference with, and the two
 * ends are nearly above each other, it is nudged so the connector runs
 * exactly vertical. Each axis snaps on its own; y first, since whether a
 * connector can run straight depends on it. A snapped position is a whole
 * number, as table positions are (a connector end may lie half-way).
 */
import type { Rect } from './layout'
import { stacked } from './references'

/** A guide line in world coordinates: vertical (`x` fixed) or horizontal (`y` fixed). */
export type SnapGuide = { axis: 'x'; x: number; y1: number; y2: number } | { axis: 'y'; y: number; x1: number; x2: number }

export type SnapResult = { dx: number; dy: number; guides: SnapGuide[] }

/** A reference between the moving table and `other`: its end on the moving table is at x `at` (before the move), its other end at `to`. */
export type SnapConnector = { at: number; to: number; other: Rect }

const xs = (r: Rect) => [r.x, r.x + r.width]
const ys = (r: Rect) => [r.y, r.y + r.height]
const EPS = 0.5

/** The vertical gap a straight connector would cross, if one strip is stacked above the other. */
function between(a: Rect, b: Rect): [number, number] | null {
  if (stacked(a.y + a.height, b.y)) return [a.y + a.height, b.y]
  if (stacked(b.y + b.height, a.y)) return [b.y + b.height, a.y]
  return null
}

/**
 * Snaps `moving` (its position before the move) shifted by (dx, dy) to `others` and to straight `connectors`.
 * `threshold` is in world units (pass screen pixels / zoom).
 */
export function snapMove(moving: Rect, dx: number, dy: number, others: Rect[], threshold: number, connectors: SnapConnector[] = []): SnapResult {
  const closest = (shifts: number[]) => {
    let best: number | null = null
    for (const d of shifts) if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d
    return best
  }
  const edgeShifts = (lines: (r: Rect) => number[], at: Rect) => others.flatMap((o) => lines(o).flatMap((b) => lines(at).map((a) => b - a)))

  const moved = { ...moving, x: moving.x + dx, y: moving.y + dy }
  const sy = closest(edgeShifts(ys, moved))
  const placedY = { ...moved, y: sy === null ? moved.y : Math.round(moved.y + sy) }
  const straight = connectors.filter((c) => between(placedY, c.other))
  const sx = closest([...edgeShifts(xs, placedY), ...straight.map((c) => c.to - (c.at + dx))])
  const final = { ...placedY, x: sx === null ? placedY.x : Math.round(placedY.x + sx) }
  const ddx = final.x - moving.x

  const guides: SnapGuide[] = []
  for (const x of xs(final)) {
    const hits = others.filter((o) => xs(o).some((v) => Math.abs(v - x) < EPS))
    if (!hits.length) continue
    const all = [final, ...hits]
    guides.push({ axis: 'x', x, y1: Math.min(...all.map((r) => r.y)), y2: Math.max(...all.map((r) => r.y + r.height)) })
  }
  for (const y of ys(final)) {
    const hits = others.filter((o) => ys(o).some((v) => Math.abs(v - y) < EPS))
    if (!hits.length) continue
    const all = [final, ...hits]
    guides.push({ axis: 'y', y, x1: Math.min(...all.map((r) => r.x)), x2: Math.max(...all.map((r) => r.x + r.width)) })
  }
  for (const c of straight) {
    const gap = between(final, c.other)
    // Within half a unit the connector is drawn straight, half-way between the two ends.
    const from = c.at + ddx
    if (gap && Math.abs(from - c.to) <= 0.5) guides.push({ axis: 'x', x: (from + c.to) / 2, y1: gap[0], y2: gap[1] })
  }
  return { dx: ddx, dy: final.y - moving.y, guides }
}
