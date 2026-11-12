/**
 * The diagram canvas: SVG content, pan/zoom, hit testing, table dragging,
 * and HTML overlays for inline editing.
 *
 * Every pointer interaction is resolved here into one CanvasTarget and handed
 * to resolveCanvasClick, so a click, a keyboard activation and (later) a drop
 * mean the same thing. Dragging a table's header band is an optional shortcut
 * for the click-based "Move table" operation and dispatches the same command.
 */
import { useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type PointerEvent } from 'react'
import { addAttributesFromNames } from '../commands/builders'
import { Icon } from '../components/Icon'
import { InlineInput } from '../components/InlineInput'
import { contentBounds, layoutRelation, METRICS, type RelationLayout, type TextMeasurer } from '../geometry/layout'
import { fitToBounds, panBy, screenToWorld, zoomAt, type Viewport } from '../geometry/viewport'
import type { Point } from '../model/types'
import type { Action, AppState } from '../state/appState'
import { resolveCanvasClick, type CanvasTarget } from '../state/interaction'
import { RelationView } from './RelationView'

/** Screen pixels a pointer must travel before a press on a header becomes a drag. */
export const DRAG_THRESHOLD = 6
const ZOOM_STEP = 1.2

interface Props {
  state: AppState
  dispatch: Dispatch<Action>
  measurer: TextMeasurer
}

function targetFrom(el: EventTarget | null): CanvasTarget {
  const node = el instanceof Element ? el.closest('[data-kind]') : null
  if (!node) return { kind: 'empty' }
  const kind = node.getAttribute('data-kind')
  const relationId = node.getAttribute('data-relation') ?? ''
  if (kind === 'attribute') return { kind, relationId, attributeId: node.getAttribute('data-attribute') ?? '' }
  if (kind === 'relation' || kind === 'relationName' || kind === 'addCell') return { kind, relationId }
  return { kind: 'empty' }
}

type Press = { pointerId: number; start: Point; target: CanvasTarget; draggable: boolean }
type Drag = { relationId: string; dx: number; dy: number }

export function Canvas({ state, dispatch, measurer }: Props) {
  const { doc, ui } = state
  const viewport = ui.viewport
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const press = useRef<Press | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const stateRef = useRef(state)
  stateRef.current = state

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

  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = svgRef.current!.getBoundingClientRect()
    return screenToWorld(stateRef.current.ui.viewport, { x: clientX - rect.left, y: clientY - rect.top })
  }

  const activate = (target: CanvasTarget, point: Point) => {
    const action = resolveCanvasClick(stateRef.current, target, point)
    if (action) dispatch(action)
  }

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const target = targetFrom(e.target)
    const draggable = (target.kind === 'relation' || target.kind === 'relationName') && stateRef.current.ui.operation.kind === 'select'
    press.current = { pointerId: e.pointerId, start: { x: e.clientX, y: e.clientY }, target, draggable }
  }

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const p = press.current
    if (!p || p.pointerId !== e.pointerId || !p.draggable || p.target.kind === 'empty') return
    const dx = e.clientX - p.start.x
    const dy = e.clientY - p.start.y
    if (!drag) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      // Capture only once it is a drag, so plain clicks and double-clicks keep their real target.
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    const zoom = stateRef.current.ui.viewport.zoom
    setDrag({ relationId: p.target.relationId, dx: dx / zoom, dy: dy / zoom })
  }

  const finishPress = (e: PointerEvent<SVGSVGElement>, cancelled: boolean) => {
    const p = press.current
    if (!p || p.pointerId !== e.pointerId) return
    press.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (drag) {
      setDrag(null)
      if (cancelled) return
      const r = stateRef.current.doc.relations.find((x) => x.id === drag.relationId)
      if (r)
        dispatch({
          type: 'command',
          command: { type: 'moveRelation', relationId: r.id, position: { x: r.position.x + drag.dx, y: r.position.y + drag.dy } },
          after: { selection: { kind: 'relation', relationId: r.id } },
        })
      return
    }
    if (cancelled) return
    // A press that wandered off (beyond the threshold) without being a drag is not a click.
    if (Math.hypot(e.clientX - p.start.x, e.clientY - p.start.y) >= DRAG_THRESHOLD) return
    activate(p.target, toWorld(e.clientX, e.clientY))
  }

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const target = targetFrom(e.target)
    if (target.kind === 'empty') return
    e.preventDefault()
    e.stopPropagation()
    const l = layouts.get(target.relationId)
    activate(target, l ? { x: l.x, y: l.y + l.height / 2 } : { x: 0, y: 0 })
  }

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const target = targetFrom(e.target)
    if ((target.kind === 'relation' || target.kind === 'relationName') && ui.operation.kind === 'select')
      dispatch({ type: 'ui', patch: { selection: { kind: 'relation', relationId: target.relationId }, editing: { kind: 'relationName', relationId: target.relationId } } })
  }

  const selection = ui.selection
  const op = ui.operation
  const destinationMode = op.kind === 'place'
  const editing = ui.editing
  const editingLayout = editing ? layouts.get(editing.relationId) : undefined
  const editingRelation = editing ? doc.relations.find((r) => r.id === editing.relationId) : undefined

  const screenRect = (x: number, y: number, width: number, height: number) => ({
    left: x * viewport.zoom + viewport.x,
    top: y * viewport.zoom + viewport.y,
    width: width * viewport.zoom,
    height: height * viewport.zoom,
    fontSize: METRICS.fontSize * viewport.zoom,
  })

  const grid = 20 * viewport.zoom
  const zoomCenter = { x: size.width / 2, y: size.height / 2 }

  return (
    <div className="canvas" ref={containerRef} data-operation={op.kind}>
      <svg
        ref={svgRef}
        className="canvas-svg"
        role="group"
        aria-label="Diagram"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finishPress(e, false)}
        onPointerCancel={(e) => finishPress(e, true)}
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
            const dragged = drag?.relationId === r.id
            const shown = dragged ? { ...r, position: { x: r.position.x + drag.dx, y: r.position.y + drag.dy } } : r
            const layout = dragged ? layoutRelation(shown, measurer) : layouts.get(r.id)!
            const relSelected =
              (selection.kind === 'relation' && selection.relationId === r.id) || (op.kind === 'moveTable' && op.relationId === r.id)
            return (
              <RelationView
                key={r.id}
                relation={shown}
                layout={layout}
                measurer={measurer}
                selected={relSelected}
                selectedAttributeId={selection.kind === 'attribute' && selection.relationId === r.id ? selection.attributeId : null}
                destination={destinationMode}
                dragging={dragged}
              />
            )
          })}
        </g>
      </svg>

      {doc.relations.length === 0 && (
        <div className="canvas-empty" aria-hidden="true">
          <p>Select form fields in the sidebar, choose Place in diagram, then click here to create a table.</p>
        </div>
      )}

      {editing && editingLayout && editingRelation && editing.kind === 'relationName' && (
        <InlineInput
          key={`name-${editingRelation.id}`}
          className="canvas-input name-input"
          style={{
            ...screenRect(editingLayout.header.x + METRICS.gripWidth - 4, editingLayout.header.y, Math.max(180, editingLayout.header.width), editingLayout.header.height),
            fontSize: METRICS.labelSize * viewport.zoom,
          }}
          initial={editingRelation.name ?? ''}
          label="Table name (leave empty for an unnamed table)"
          placeholder="Table name"
          onCommit={(value) => {
            dispatch({ type: 'ui', patch: { editing: null } })
            if ((value.trim() || null) !== editingRelation.name)
              dispatch({ type: 'command', command: { type: 'renameRelation', relationId: editingRelation.id, name: value } })
          }}
          onCancel={() => dispatch({ type: 'ui', patch: { editing: null } })}
        />
      )}

      {editing && editingLayout && editingRelation && editing.kind === 'newAttribute' && (
        <InlineInput
          key={`attr-${editingRelation.id}`}
          className="canvas-input attr-input"
          style={screenRect(editingLayout.addCell.x, editingLayout.addCell.y, 180, editingLayout.addCell.height)}
          initial=""
          repeat
          label="New attribute name (Enter adds it, Escape closes)"
          placeholder="Attribute name"
          onCommit={(value) => {
            const command = addAttributesFromNames(editingRelation.id, [value.trim()])
            if (command) dispatch({ type: 'command', command })
          }}
          onCancel={() => dispatch({ type: 'ui', patch: { editing: null } })}
        />
      )}

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
