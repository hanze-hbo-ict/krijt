/** Alignment snapping of a dragged table. */
import { describe, expect, it } from 'vitest'
import { snapMove } from '../../src/geometry/snap'

const box = (x: number, y: number, width = 100, height = 28) => ({ x, y, width, height })

describe('snapMove', () => {
  it('snaps a nearby left edge and shows a vertical guide', () => {
    const r = snapMove(box(0, 0), 197, 80, [box(200, 200)], 6)
    expect(r.dx).toBe(200)
    expect(r.dy).toBe(80)
    expect(r.guides).toContainEqual({ axis: 'x', x: 200, y1: 80, y2: 228 })
  })
  it('snaps both axes independently, choosing the closest edge', () => {
    const r = snapMove(box(0, 0, 60), 143, 198, [box(100, 200, 100)], 6)
    // Right edge 203 lines up with 200; centres do not count.
    expect(r.dx).toBe(140)
    expect(r.dy).toBe(200)
  })
  it('leaves the move alone when nothing is within the threshold', () => {
    const r = snapMove(box(0, 0), 50, 50, [box(200, 200)], 6)
    expect(r).toEqual({ dx: 50, dy: 50, guides: [] })
  })
  it('does not snap centres', () => {
    // Centre 50+3 = 53 is near the other centre 50, but no edge is near.
    const r = snapMove(box(0, 0), 3, 100, [box(0, 300)], 2)
    expect(r.dx).toBe(3)
  })
  it('snaps a connector straight when the tables are stacked', () => {
    const other = box(0, 0, 200)
    // The moving table's end sits at x 40 before the move; the other end at x 120.
    const r = snapMove(box(0, 200), 77, 0, [other], 6, [{ at: 40, to: 120, other }])
    expect(r.dx).toBe(80)
    expect(r.guides).toContainEqual({ axis: 'x', x: 120, y1: 28, y2: 200 })
  })
  it('does not snap a connector straight between tables side by side', () => {
    const other = box(300, 0, 200)
    const r = snapMove(box(0, 0), 3, 0, [other], 6, [{ at: 40, to: 46, other }])
    expect(r.dx).toBe(3)
  })
})
