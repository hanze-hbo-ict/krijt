/**
 * Vertical splitter between sidebar and canvas. Usable without dragging:
 * focus it and use ←/→ (or Home/End).
 */
import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

interface Props {
  width: number
  min: number
  max: number
  onChange: (width: number) => void
  label: string
}

export function Splitter({ width, min, max, onChange, label }: Props) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)

  const onKey = (e: KeyboardEvent) => {
    let w: number | null = null
    if (e.key === 'ArrowLeft') w = width - 20
    else if (e.key === 'ArrowRight') w = width + 20
    else if (e.key === 'Home') w = min
    else if (e.key === 'End') w = max
    if (w === null) return
    e.preventDefault()
    onChange(w)
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { startX: e.clientX, startWidth: width }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) onChange(drag.current.startWidth + e.clientX - drag.current.startX)
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span className="splitter-grip" aria-hidden="true" />
    </div>
  )
}
