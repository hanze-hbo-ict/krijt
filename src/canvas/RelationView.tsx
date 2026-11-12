/**
 * One table strip in SVG: header band (move handle + optional name), the
 * attribute cells, and the editor-only "+" cell. Hit targets carry data-kind /
 * data-relation / data-attribute; the Canvas resolves clicks from those.
 */
import { memo } from 'react'
import type { Attribute, Relation } from '../model/types'
import { labelParts, labelWidth, METRICS, type RelationLayout, type TextMeasurer } from '../geometry/layout'

interface Props {
  relation: Relation
  layout: RelationLayout
  measurer: TextMeasurer
  selected: boolean
  selectedAttributeId: string | null
  /** A placement or move operation is active: the whole table is a destination. */
  destination: boolean
  dragging: boolean
}

export function relationLabel(r: Relation): string {
  return r.name ? `Table ${r.name}` : 'Unnamed table'
}

function AttributeText({ attribute, x, y, measurer }: { attribute: Attribute; x: number; y: number; measurer: TextMeasurer }) {
  const parts = labelParts(attribute)
  const nameWidth = measurer.width(parts.name, parts.bold ? 'bold' : 'regular')
  return (
    <>
      <text x={x} y={y} className="attr-text" fontWeight={parts.bold ? 700 : 400}>
        <tspan>{parts.name}</tspan>
        {parts.slash && <tspan fontWeight={400}>/</tspan>}
        {parts.superO && (
          <tspan fontWeight={400} fontSize={METRICS.superscriptSize} dx={1} dy={-6}>
            o
          </tspan>
        )}
      </text>
      {parts.underline && nameWidth > 0 && <line className="attr-underline" x1={x} x2={x + nameWidth} y1={y + 3} y2={y + 3} />}
    </>
  )
}

function Grip({ x, y }: { x: number; y: number }) {
  const dots = []
  for (let col = 0; col < 2; col++) for (let row = 0; row < 3; row++) dots.push(<circle key={`${col}${row}`} cx={x + col * 5} cy={y + row * 5} r={1.3} />)
  return <g className="grip">{dots}</g>
}

export const RelationView = memo(function RelationView({ relation, layout, measurer, selected, selectedAttributeId, destination, dragging }: Props) {
  const { header, cells } = layout
  const textY = layout.y + METRICS.cellHeight / 2 + METRICS.fontSize * 0.35
  const label = relationLabel(relation)
  const where = relation.name ? `table ${relation.name}` : 'unnamed table'
  return (
    <g
      className="relation"
      data-selected={selected || undefined}
      data-destination={destination || undefined}
      data-dragging={dragging || undefined}
      data-relation-id={relation.id}
    >
      {/* Header band: the table's handle. Clicking it selects the table; dragging it moves the table. */}
      <g
        className="relation-header"
        data-kind="relation"
        data-relation={relation.id}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={`${label}, ${relation.attributes.length} attribute${relation.attributes.length === 1 ? '' : 's'}`}
      >
        <rect className="header-band" x={header.x} y={header.y} width={header.width} height={header.height} rx={5} />
        <Grip x={header.x + 7} y={header.y + header.height / 2 - 5} />
        {relation.name ? (
          <text
            className="relation-name"
            data-kind="relationName"
            data-relation={relation.id}
            x={header.x + METRICS.gripWidth}
            y={header.y + header.height / 2 + METRICS.labelSize * 0.35}
          >
            {relation.name}
          </text>
        ) : (
          selected && (
            <text
              className="relation-name placeholder"
              data-kind="relationName"
              data-relation={relation.id}
              x={header.x + METRICS.gripWidth}
              y={header.y + header.height / 2 + METRICS.labelSize * 0.35}
            >
              Add name
            </text>
          )
        )}
      </g>

      {selected && (
        <rect
          className="relation-outline"
          x={layout.x - 4}
          y={layout.y - 4}
          width={layout.stripWidth + 8}
          height={layout.height + 8}
          rx={4}
        />
      )}

      {relation.attributes.map((a, i) => {
        const c = cells[i]!
        const isSel = a.id === selectedAttributeId
        const w = labelWidth(labelParts(a), measurer)
        return (
          <g
            key={a.id}
            className="cell"
            data-kind="attribute"
            data-relation={relation.id}
            data-attribute={a.id}
            data-selected={isSel || undefined}
            role="button"
            tabIndex={0}
            aria-pressed={isSel}
            aria-label={`Attribute ${a.name || '(no name)'} in ${where}`}
          >
            <rect className="cell-box" x={c.x} y={layout.y} width={c.width} height={layout.height} />
            <AttributeText attribute={a} x={c.x + (c.width - w) / 2} y={textY} measurer={measurer} />
            {isSel && <rect className="cell-selection" x={c.x + 2.5} y={layout.y + 2.5} width={c.width - 5} height={layout.height - 5} />}
          </g>
        )
      })}

      <g
        className="add-cell"
        data-kind="addCell"
        data-relation={relation.id}
        role="button"
        tabIndex={0}
        aria-label={`Add attribute to ${where}`}
      >
        <rect x={layout.addCell.x} y={layout.addCell.y} width={layout.addCell.width} height={layout.addCell.height} rx={4} />
        <path
          d={`M${layout.addCell.x + layout.addCell.width / 2} ${layout.y + 11}v12M${layout.addCell.x + layout.addCell.width / 2 - 6} ${layout.y + 17}h12`}
        />
      </g>
    </g>
  )
})
