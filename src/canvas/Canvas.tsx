/**
 * The diagram canvas: SVG content, pan/zoom, hit testing, destination
 * previews, drag shortcuts, and HTML overlays for inline editing.
 *
 * Every pointer interaction is resolved into one CanvasTarget and handed to
 * the shared resolvers in state/interaction.ts, so a click, a keyboard
 * activation and a drop mean the same thing. Drags are optional shortcuts:
 * a table's header band (move the table), a cell (move attributes), and form
 * fields from the sidebar (through CanvasHandle).
 */
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent,
} from 'react'
import { addAttributesFromNames } from '../commands/builders'
import { orderAttributeIds } from '../commands/commands'
import { Icon } from '../components/Icon'
import { InlineInput } from '../components/InlineInput'
import { contentBounds, layoutRelation, METRICS, type RelationLayout, type TextMeasurer } from '../geometry/layout'
import { layoutReferences } from '../geometry/references'
import { fitToBounds, panBy, screenToWorld, zoomAt, type Viewport } from '../geometry/viewport'
import type { Id, Point } from '../model/types'
import { selectedAttributeIds, type Action, type AppState } from '../state/appState'
import {
  choosingDestination,
  describeReference,
  destinationFor,
  nextStepAction,
  resolveCanvasClick,
  transferAction,
  type CanvasTarget,
} from '../state/interaction'
import { ReferenceView } from './ReferenceView'
import { RelationView, type CellMark } from './RelationView'

/** Screen pixels a pointer must travel before a press becomes a drag. */
export const DRAG_THRESHOLD = 6
const ZOOM_STEP = 1.2

export type DragGhost = { text: string; x: number; y: number } | null

/** What the sidebar needs from the canvas to drop form fields onto it. */
export interface CanvasHandle {
  /** The target under a screen point, or null if the point is not over the diagram. */
  hitTest(clientX: number, clientY: number): { target: CanvasTarget; point: Point } | null
  /** Shows (or clears) the destination preview for an outside drag of `count` items. */
  previewAt(clientX: number, clientY: number, count: number): void
  clearPreview(): void
}

interface Props {
  state: AppState
  dispatch: Dispatch<Action>
  measurer: TextMeasurer
  handleRef: MutableRefObject<CanvasHandle | null>
  onGhost: (ghost: DragGhost) => void
}

/** Reads the target from an element; for cells, the side comes from where in the cell the point is. */
function targetFrom(el: Element | null, clientX?: number): CanvasTarget {
  const node = el ? el.closest('[data-kind]') : null
  if (!node) return { kind: 'empty' }
  const kind = node.getAttribute('data-kind')
  if (kind === 'reference') return { kind, referenceId: node.getAttribute('data-reference') ?? '' }
  const relationId = node.getAttribute('data-relation') ?? ''
  if (kind === 'attribute') {
    const attributeId = node.getAttribute('data-attribute') ?? ''
    if (clientX === undefined) return { kind, relationId, attributeId }
    const box = node.getBoundingClientRect()
    return { kind, relationId, attributeId, side: clientX < box.left + box.width / 2 ? 'before' : 'after' }
  }
  if (kind === 'relation' || kind === 'relationName' || kind === 'addCell') return { kind, relationId }
  return { kind: 'empty' }
}

type Press = { pointerId: number; start: Point; target: CanvasTarget }
type Drag =
  | { kind: 'table'; relationId: Id; dx: number; dy: number }
  | { kind: 'attributes'; attributeIds: Id[] }
/** `external`: the hover comes from a drag that started outside the canvas (the sidebar). */
type Hover = { target: CanvasTarget; point: Point; count: number; external?: boolean }

export function Canvas({ state, dispatch, measurer, handleRef, onGhost }: Props) {
  const { doc, ui } = state
  const viewport = ui.viewport
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const press = useRef<Press | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDragState] = useState<Drag | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const stateRef = useRef(state)
  stateRef.current = state

  const setDrag = (d: Drag | null) => {
    dragRef.current = d
    setDragState(d)
  }
  const setViewport = (v: Viewport) => dispatch({ type: 'ui', patch: { viewport: v } })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Wheel / two-finger scroll pans; pinch (reported as ctrl+wheel) zooms. Non-passive to prevent page zoom.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = stateRef.current.ui.viewport
      const rect = svg.getBoundingClientRect()
      if (e.ctrlKey) {
        const factor = Math.exp(-e.deltaY * 0.01)
        dispatch({ type: 'ui', patch: { viewport: zoomAt(v, factor, { x: e.clientX - rect.left, y: e.clientY - rect.top }) } })
      } else {
        const unit = e.deltaMode === 1 ? 16 : 1
        dispatch({ type: 'ui', patch: { viewport: panBy(v, -e.deltaX * unit, -e.deltaY * unit) } })
      }
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [dispatch])

  const layouts = useMemo(() => {
    const map = new Map<string, RelationLayout>()
    for (const r of doc.relations) map.set(r.id, layoutRelation(r, measurer))
    return map
  }, [doc.relations, measurer])

  // While a table is dragged, its connectors follow it.
  const shownLayouts = useMemo(() => {
    if (drag?.kind !== 'table') return layouts
    const r = doc.relations.find((x) => x.id === drag.relationId)
    if (!r) return layouts
    const map = new Map(layouts)
    map.set(r.id, layoutRelation({ ...r, position: { x: r.position.x + drag.dx, y: r.position.y + drag.dy } }, measurer))
    return map
  }, [layouts, drag, doc.relations, measurer])
  const referenceGeometry = useMemo(() => layoutReferences(doc.references, shownLayouts), [doc.references, shownLayouts])

  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = svgRef.current!.getBoundingClientRect()
    return screenToWorld(stateRef.current.ui.viewport, { x: clientX - rect.left, y: clientY - rect.top })
  }

  /** Hit test by screen point (works during pointer capture and for outside drags). */
  const hitTest = (clientX: number, clientY: number): { target: CanvasTarget; point: Point } | null => {
    const svg = svgRef.current
    if (!svg) return null
    const el = document.elementFromPoint(clientX, clientY)
    if (!el || !svg.contains(el)) return null
    return { target: targetFrom(el, clientX), point: toWorld(clientX, clientY) }
  }

  useImperativeHandle(handleRef, () => ({
    hitTest,
    previewAt(clientX, clientY, count) {
      const hit = hitTest(clientX, clientY)
      setHover(hit ? { ...hit, count, external: true } : null)
    },
    clearPreview() {
      setHover(null)
    },
  }))

  const activate = (target: CanvasTarget, point: Point) => {
    const action = resolveCanvasClick(stateRef.current, target, point)
    if (action) dispatch(action)
  }

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    press.current = { pointerId: e.pointerId, start: { x: e.clientX, y: e.clientY }, target: targetFrom(e.target as Element, e.clientX) }
  }

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const s = stateRef.current
    const p = press.current
    const d = dragRef.current
    if (p && p.pointerId === e.pointerId && !d && s.ui.operation.kind === 'select') {
      if (Math.hypot(e.clientX - p.start.x, e.clientY - p.start.y) >= DRAG_THRESHOLD) {
        const t = p.target
        let started: Drag | null = null
        if (t.kind === 'relation' || t.kind === 'relationName') started = { kind: 'table', relationId: t.relationId, dx: 0, dy: 0 }
        else if (t.kind === 'attribute') {
          // Dragging a selected cell drags the whole selection; otherwise just that cell.
          const sel = selectedAttributeIds(s.ui)
          started = { kind: 'attributes', attributeIds: sel.includes(t.attributeId) ? sel : [t.attributeId] }
        }
        if (started) {
          // Capture only once it is a drag, so plain clicks and double-clicks keep their real target.
          e.currentTarget.setPointerCapture(e.pointerId)
          setDrag(started)
        }
      }
    }
    const active = dragRef.current
    if (active?.kind === 'table' && p) {
      const zoom = s.ui.viewport.zoom
      setDrag({ ...active, dx: (e.clientX - p.start.x) / zoom, dy: (e.clientY - p.start.y) / zoom })
      return
    }
    if (active?.kind === 'attributes') {
      const n = active.attributeIds.length
      onGhost({ text: n === 1 ? 'Move 1 attribute' : `Move ${n} attributes`, x: e.clientX, y: e.clientY })
      const hit = hitTest(e.clientX, e.clientY)
      setHover(hit ? { ...hit, count: n } : null)
      return
    }
    // Destination preview while choosing a destination by clicks.
    if (choosingDestination(s)) {
      const count = s.ui.operation.kind === 'place' ? s.ui.selectedFieldIds.length : selectedAttributeIds(s.ui).length
      setHover({ target: targetFrom(e.target as Element, e.clientX), point: toWorld(e.clientX, e.clientY), count })
    } else if (hover) setHover(null)
  }

  const finishPress = (e: PointerEvent<SVGSVGElement>, cancelled: boolean) => {
    const p = press.current
    if (!p || p.pointerId !== e.pointerId) return
    press.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    const d = dragRef.current
    if (d) {
      setDrag(null)
      onGhost(null)
      setHover(null)
      if (cancelled) return
      const s = stateRef.current
      if (d.kind === 'table') {
        const r = s.doc.relations.find((x) => x.id === d.relationId)
        if (r)
          dispatch({
            type: 'command',
            command: { type: 'moveRelation', relationId: r.id, position: { x: r.position.x + d.dx, y: r.position.y + d.dy } },
            after: { selection: { kind: 'relation', relationId: r.id } },
          })
      } else {
        const hit = hitTest(e.clientX, e.clientY)
        const action = hit && transferAction(s, 'move', d.attributeIds, hit.target, hit.point)
        if (action) dispatch(action)
      }
      return
    }
    if (cancelled) return
    // A press that wandered off (beyond the threshold) without being a drag is not a click.
    if (Math.hypot(e.clientX - p.start.x, e.clientY - p.start.y) >= DRAG_THRESHOLD) return
    activate(p.target, toWorld(e.clientX, e.clientY))
  }

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const target = targetFrom(e.target as Element)
    if (target.kind === 'empty') return
    e.preventDefault()
    e.stopPropagation()
    const s = stateRef.current
    // While choosing attributes for Move/Copy/Reference, Enter is always Next/Finish (Space toggles the focused cell).
    const step = e.key === 'Enter' ? nextStepAction(s) : null
    if (step) {
      dispatch(step)
      return
    }
    if (target.kind === 'reference') {
      activate(target, { x: 0, y: 0 })
      return
    }
    // Enter on the one selected cell renames it (as double-click does); otherwise Enter/Space activate.
    const sel = selectedAttributeIds(s.ui)
    if (
      e.key === 'Enter' &&
      target.kind === 'attribute' &&
      s.ui.operation.kind === 'select' &&
      sel.length === 1 &&
      sel[0] === target.attributeId
    ) {
      dispatch({ type: 'ui', patch: { editing: { kind: 'attributeName', attributeId: target.attributeId } } })
      return
    }
    const l = layouts.get(target.relationId)
    activate(target.kind === 'attribute' ? { ...target, side: 'after' } : target, l ? { x: l.x, y: l.y + l.height / 2 } : { x: 0, y: 0 })
  }

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (ui.operation.kind !== 'select' || ui.multiSelect) return
    const target = targetFrom(e.target as Element)
    if (target.kind === 'relation' || target.kind === 'relationName')
      dispatch({
        type: 'ui',
        patch: { selection: { kind: 'relation', relationId: target.relationId }, editing: { kind: 'relationName', relationId: target.relationId } },
      })
    else if (target.kind === 'attribute')
      dispatch({
        type: 'ui',
        patch: { selection: { kind: 'attributes', attributeIds: [target.attributeId] }, editing: { kind: 'attributeName', attributeId: target.attributeId } },
      })
  }

  const selection = ui.selection
  const op = ui.operation
  const choosing = choosingDestination(state)
  const destinationMode = choosing !== null || drag?.kind === 'attributes'
  const selectedSet = useMemo(() => new Set(selection.kind === 'attributes' ? selection.attributeIds : []), [selection])
  const draggedSet = useMemo(() => new Set(drag?.kind === 'attributes' ? drag.attributeIds : []), [drag])
  const editing = ui.editing

  // Cells of the reference being created, or of the selected reference; composite ends are numbered left to right.
  const marks = useMemo(() => {
    const map = new Map<Id, CellMark>()
    const mark = (ids: Id[], role: CellMark['role'], numbered: boolean) =>
      orderAttributeIds(doc, ids).forEach((id, i) => map.set(id, numbered ? { role, index: i + 1 } : { role }))
    if (op.kind === 'reference') {
      const numbered = op.source.length > 1
      mark(op.source, 'source', numbered)
      mark(op.target, 'target', numbered)
    } else if (selection.kind === 'reference') {
      const ref = doc.references.find((r) => r.id === selection.referenceId)
      if (ref) {
        const numbered = ref.from.attributeIds.length > 1
        mark(ref.from.attributeIds, 'source', numbered)
        mark(ref.to.attributeIds, 'target', numbered)
      }
    }
    return map
  }, [op, selection, doc])
  const referenceLabels = useMemo(() => {
    const map = new Map<Id, string>()
    for (const ref of doc.references) {
      const { from, to } = describeReference(doc, ref)
      map.set(ref.id, `Reference from ${from} to ${to}`)
    }
    return map
  }, [doc])

  const screenRect = (x: number, y: number, width: number, height: number) => ({
    left: x * viewport.zoom + viewport.x,
    top: y * viewport.zoom + viewport.y,
    width: width * viewport.zoom,
    height: height * viewport.zoom,
    fontSize: METRICS.fontSize * viewport.zoom,
  })

  const grid = 20 * viewport.zoom
  const zoomCenter = { x: size.width / 2, y: size.height / 2 }
  const preview = hover && hover.count > 0 && (destinationMode || hover.external) ? destinationFor(doc, hover.target, hover.point) : null

  return (
    <div className="canvas" ref={containerRef} data-operation={op.kind} data-choosing={destinationMode || undefined}>
      <svg
        ref={svgRef}
        className="canvas-svg"
        role="group"
        aria-label="Diagram"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finishPress(e, false)}
        onPointerCancel={(e) => finishPress(e, true)}
        onPointerLeave={() => !dragRef.current && setHover(null)}
        onKeyDown={onKeyDown}
        onDoubleClick={onDoubleClick}
      >
        <defs>
          <pattern id="krijt-grid" width={grid} height={grid} x={viewport.x} y={viewport.y} patternUnits="userSpaceOnUse">
            <circle cx={1} cy={1} r={1} className="grid-dot" />
          </pattern>
        </defs>
        <rect className="canvas-background" data-kind="empty" width="100%" height="100%" fill="url(#krijt-grid)" />
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
          {doc.relations.map((r) => {
            const dragged = drag?.kind === 'table' && drag.relationId === r.id
            const shown = dragged ? { ...r, position: { x: r.position.x + drag.dx, y: r.position.y + drag.dy } } : r
            const layout = shownLayouts.get(r.id)!
            const relSelected =
              (selection.kind === 'relation' && selection.relationId === r.id) || (op.kind === 'moveTable' && op.relationId === r.id)
            return (
              <RelationView
                key={r.id}
                relation={shown}
                layout={layout}
                measurer={measurer}
                selected={relSelected}
                selectedAttributeIds={selectedSet}
                draggedAttributeIds={draggedSet}
                destination={destinationMode}
                dragging={dragged}
                marks={marks}
              />
            )
          })}
          <g className="references">
            {referenceGeometry.map((g) => (
              <ReferenceView
                key={g.referenceId}
                geometry={g}
                selected={selection.kind === 'reference' && selection.referenceId === g.referenceId}
                label={referenceLabels.get(g.referenceId) ?? 'Reference'}
              />
            ))}
          </g>
          {preview && <DestinationPreview intent={preview} layouts={layouts} count={hover!.count} />}
        </g>
      </svg>

      {doc.relations.length === 0 && (
        <div className="canvas-empty" aria-hidden="true">
          <p>Select form fields in the sidebar, choose Place in diagram, then click here to create a table.</p>
        </div>
      )}

      {editing?.kind === 'relationName' &&
        (() => {
          const l = layouts.get(editing.relationId)
          const r = doc.relations.find((x) => x.id === editing.relationId)
          if (!l || !r) return null
          return (
            <InlineInput
              key={`name-${r.id}`}
              className="canvas-input name-input"
              style={{
                ...screenRect(l.header.x + METRICS.gripWidth - 4, l.header.y, Math.max(180, l.header.width), l.header.height),
                fontSize: METRICS.labelSize * viewport.zoom,
              }}
              initial={r.name ?? ''}
              label="Table name (leave empty for an unnamed table)"
              placeholder="Table name"
              onCommit={(value) => {
                dispatch({ type: 'ui', patch: { editing: null } })
                if ((value.trim() || null) !== r.name) dispatch({ type: 'command', command: { type: 'renameRelation', relationId: r.id, name: value } })
              }}
              onCancel={() => dispatch({ type: 'ui', patch: { editing: null } })}
            />
          )
        })()}

      {editing?.kind === 'newAttribute' &&
        (() => {
          const l = layouts.get(editing.relationId)
          if (!l) return null
          return (
            <InlineInput
              key={`attr-${editing.relationId}`}
              className="canvas-input attr-input"
              style={screenRect(l.addCell.x, l.addCell.y, 180, l.addCell.height)}
              initial=""
              repeat
              label="New attribute name (Enter adds it, Escape closes)"
              placeholder="Attribute name"
              onCommit={(value) => {
                const command = addAttributesFromNames(editing.relationId, [value.trim()])
                if (command) dispatch({ type: 'command', command })
              }}
              onCancel={() => dispatch({ type: 'ui', patch: { editing: null } })}
            />
          )
        })()}

      {editing?.kind === 'attributeName' &&
        (() => {
          const r = doc.relations.find((x) => x.attributes.some((a) => a.id === editing.attributeId))
          const a = r?.attributes.find((x) => x.id === editing.attributeId)
          const cell = r && layouts.get(r.id)?.cells.find((c) => c.attributeId === editing.attributeId)
          if (!r || !a || !cell) return null
          return (
            <InlineInput
              key={`rename-${a.id}`}
              className="canvas-input attr-input"
              style={screenRect(cell.x, r.position.y, Math.max(cell.width, 160), METRICS.cellHeight)}
              initial={a.name}
              label={`Rename attribute ${a.name}`}
              onCommit={(value) => {
                dispatch({ type: 'ui', patch: { editing: null } })
                if (value.trim() !== '' && value.trim() !== a.name)
                  dispatch({ type: 'command', command: { type: 'renameAttribute', attributeId: a.id, name: value } })
              }}
              onCancel={() => dispatch({ type: 'ui', patch: { editing: null } })}
            />
          )
        })()}

      <div className="zoom-controls" role="group" aria-label="Zoom">
        <button type="button" className="icon-button" aria-label="Zoom out" data-tooltip="Zoom out" onClick={() => setViewport(zoomAt(viewport, 1 / ZOOM_STEP, zoomCenter))}>
          <Icon name="minus" />
        </button>
        <button
          type="button"
          className="zoom-level"
          aria-label={`Zoom ${Math.round(viewport.zoom * 100)}%, reset to 100%`}
          onClick={() => setViewport(zoomAt(viewport, 1 / viewport.zoom, zoomCenter))}
        >
          {Math.round(viewport.zoom * 100)}%
        </button>
        <button type="button" className="icon-button" aria-label="Zoom in" data-tooltip="Zoom in" onClick={() => setViewport(zoomAt(viewport, ZOOM_STEP, zoomCenter))}>
          <Icon name="plus" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Fit diagram"
          data-tooltip="Fit diagram"
          data-tooltip-pos="above-end"
          onClick={() => setViewport(fitToBounds(contentBounds(doc, measurer), size))}
        >
          <Icon name="fit" />
        </button>
      </div>
    </div>
  )
}

/** Shows where a click (or drop) would put things: an insertion bar, or the outline of a new table. */
function DestinationPreview({
  intent,
  layouts,
  count,
}: {
  intent: NonNullable<ReturnType<typeof destinationFor>>
  layouts: Map<string, RelationLayout>
  count: number
}) {
  if (intent.kind === 'newTable') {
    const { x, y } = intent.position
    const width = Math.max(90, Math.min(count, 6) * 56)
    return (
      <g className="preview" aria-hidden="true">
        <rect className="preview-table" x={x} y={y} width={width} height={METRICS.cellHeight} />
        <text className="preview-label" x={x + 8} y={y + METRICS.cellHeight / 2 + 4}>
          New table
        </text>
      </g>
    )
  }
  const l = layouts.get(intent.relationId)
  if (!l) return null
  const index = intent.index ?? l.cells.length
  const x = index < l.cells.length ? l.cells[index]!.x : l.x + l.stripWidth
  return (
    <g className="preview" aria-hidden="true">
      <line className="preview-bar" x1={x} x2={x} y1={l.y - 7} y2={l.y + l.height + 7} />
      <path className="preview-caret" d={`M${x - 5} ${l.y - 12}h10l-5 6z M${x - 5} ${l.y + l.height + 12}h10l-5 -6z`} />
    </g>
  )
}
