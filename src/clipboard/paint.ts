/** Paints an export scene onto a 2D canvas and encodes it as PNG. Browser only. */
import { EXPORT_INK, EXPORT_PAPER, type Scene } from './scene'

export function paintScene(ctx: CanvasRenderingContext2D, scene: Scene, scale: number) {
  const { bounds, ops } = scene
  ctx.save()
  ctx.fillStyle = EXPORT_PAPER
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale)
  ctx.fillStyle = EXPORT_INK
  ctx.strokeStyle = EXPORT_INK
  ctx.lineJoin = 'round'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  for (const op of ops) {
    switch (op.kind) {
      case 'rect':
        ctx.lineWidth = op.lineWidth
        ctx.strokeRect(op.x, op.y, op.width, op.height)
        break
      case 'text':
        ctx.font = op.font
        ctx.fillText(op.text, op.x, op.y)
        break
      case 'line':
        ctx.lineWidth = op.lineWidth
        ctx.beginPath()
        ctx.moveTo(op.x1, op.y1)
        ctx.lineTo(op.x2, op.y2)
        ctx.stroke()
        break
      case 'path': {
        const p = new Path2D(op.d)
        if (op.fill) ctx.fill(p)
        else {
          ctx.lineWidth = op.lineWidth ?? 1
          ctx.stroke(p)
        }
        break
      }
      case 'dot':
        ctx.beginPath()
        ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2)
        ctx.fill()
        break
    }
  }
  ctx.restore()
}

/** Renders the scene to a PNG blob at `scale` pixels per diagram unit. */
export function renderPng(scene: Scene, scale: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(scene.bounds.width * scale))
    canvas.height = Math.max(1, Math.round(scene.bounds.height * scale))
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) {
      reject(new Error('the browser could not create a drawing surface'))
      return
    }
    paintScene(ctx, scene, scale)
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the browser could not encode the image'))), 'image/png')
  })
}
