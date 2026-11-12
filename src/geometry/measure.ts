/** Canvas-based text measurement with the diagram font, cached. */
import { estimateMeasurer, fontFor, type TextMeasurer, type TextStyle } from './layout'

export function createCanvasMeasurer(): TextMeasurer {
  let ctx: CanvasRenderingContext2D | null = null
  try {
    ctx = document.createElement('canvas').getContext('2d')
  } catch {
    ctx = null
  }
  if (!ctx) return estimateMeasurer
  const cache = new Map<string, number>()
  return {
    width(text: string, style: TextStyle) {
      const key = `${style}\u0000${text}`
      let w = cache.get(key)
      if (w === undefined) {
        ctx!.font = fontFor(style)
        w = ctx!.measureText(text).width
        if (cache.size > 5000) cache.clear()
        cache.set(key, w)
      }
      return w
    },
  }
}
