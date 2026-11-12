/**
 * Viewport math: screen = world * zoom + offset.
 */
import type { Point } from '../model/types'
import type { Rect } from './layout'

export type Viewport = { x: number; y: number; zoom: number }

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 3
export const DEFAULT_VIEWPORT: Viewport = { x: 40, y: 40, zoom: 1 }

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

export function screenToWorld(v: Viewport, p: Point): Point {
  return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom }
}

export function worldToScreen(v: Viewport, p: Point): Point {
  return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y }
}

/** Zoom by `factor`, keeping the screen point `anchor` fixed. */
export function zoomAt(v: Viewport, factor: number, anchor: Point): Viewport {
  const zoom = clampZoom(v.zoom * factor)
  const world = screenToWorld(v, anchor)
  return { zoom, x: anchor.x - world.x * zoom, y: anchor.y - world.y * zoom }
}

export function panBy(v: Viewport, dx: number, dy: number): Viewport {
  return { ...v, x: v.x + dx, y: v.y + dy }
}

/** Fit `bounds` into a screen area of `size`, never enlarging beyond 100%. */
export function fitToBounds(bounds: Rect | null, size: { width: number; height: number }, margin = 40): Viewport {
  if (!bounds || size.width <= 0 || size.height <= 0) return DEFAULT_VIEWPORT
  const zoom = clampZoom(
    Math.min(1, (size.width - 2 * margin) / Math.max(1, bounds.width), (size.height - 2 * margin) / Math.max(1, bounds.height)),
  )
  return {
    zoom,
    x: (size.width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (size.height - bounds.height * zoom) / 2 - bounds.y * zoom,
  }
}
