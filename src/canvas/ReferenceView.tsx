/**
 * One reference in SVG: the connector, its arrowhead at the referenced end,
 * and a curly brace at each end of several attributes. A wide invisible
 * stroke along the connector (and braces) is the hit target, so a reference
 * is easy to click and wins over the table underneath.
 */
import { memo } from 'react'
import { polylinePath, REFERENCE_METRICS, type ReferenceGeometry } from '../geometry/references'

interface Props {
  geometry: ReferenceGeometry
  selected: boolean
  label: string
}

export const ReferenceView = memo(function ReferenceView({ geometry, selected, label }: Props) {
  const d = polylinePath(geometry.points)
  return (
    <g
      className="reference"
      data-kind="reference"
      data-reference={geometry.referenceId}
      data-selected={selected || undefined}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={label}
    >
      <path className="reference-hit" d={d} />
      {geometry.braces.map((b) => (
        <path key={`hit-${b}`} className="reference-hit brace-hit" d={b} />
      ))}
      {selected && <path className="reference-halo" d={d} />}
      <path className="reference-line" d={d} />
      <path className="reference-arrow" d={geometry.arrow} />
      {geometry.braces.map((b) => (
        <path key={b} className="reference-brace" d={b} />
      ))}
      {geometry.dots.map((p) => (
        <circle key={`${p.x},${p.y}`} className="reference-dot" cx={p.x} cy={p.y} r={REFERENCE_METRICS.memberDot} />
      ))}
    </g>
  )
})
