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
import { addAttributesFromNames, orderedFieldLabels } from '../commands/builders'
import { expandToUnits, orderAttributeIds } from '../commands/commands'
import { InlineInput } from '../components/InlineInput'
import { toValidName, typedName } from '../model/names'
import { contentBounds, layoutRelation, METRICS, type Rect, type RelationLayout, type TextMeasurer } from '../geometry/layout'
import { endCentreX, layoutReferences, polylinePath, type ReferenceGeometry } from '../geometry/references'
import { snapMove, type SnapConnector, type SnapGuide } from '../geometry/snap'
import { fitToBounds, panBy, screenToWorld, zoomAt, type Viewport } from '../geometry/viewport'
import { newAttribute, type Attribute, type Id, type Point, type Reference } from '../model/types'
import { selectedAttributeIds, type Action, type AppState } from '../state/appState'
import {
  choosingDestination,
  describeReference,
  destinationFor,
  newTablePosition,
  referenceIntent,
  resolveCanvasClick,
  transferAction,
  type CanvasTarget,
} from '../state/interaction'
import { ReferenceView } from './ReferenceView'
import { RelationView, type CellMark } from './RelationView'
import { SelectionToolbar, type ToolbarAnchor } from './SelectionToolbar'

/** Screen pixels a pointer must travel before a press becomes a drag. */
export const DRAG_THRESHOLD = 6
/** Screen pixels within which a dragged table snaps into alignment; guides reach this far (world units) past the tables. */
const SNAP_DISTANCE = 6
const SNAP_OVERHANG = 12
const ZOOM_STEP = 1.2

export type DragGhost = { text: string; x: number; y: number } | null

/** What the sidebar needs from the canvas to drop form fields onto it. */
export interface CanvasHandle {
  /**
   * The target under a screen point, or null if the point is not over the diagram. On empty canvas the point is
   * nudged so the new table made from `fieldIds` lines up with other tables, unless `free` (Shift is held).
   */
  hitTest(clientX: number, clientY: number, fieldIds?: Id[], free?: boolean): { target: CanvasTarget; point: Point } | null
  /** Shows (or clears) the destination preview for an outside drag of the form fields `fieldIds`. */
  previewAt(clientX: number, clientY: number, fieldIds: Id[], free: boolean): void
  clearPreview(): void
  zoomIn(): void
  zoomOut(): void
  /** Fit the whole diagram in view. */
  fit(): void
  /** Back to 100%, around the middle of the view. */
  resetZoom(): void
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
  | { kind: 'table'; relationId: Id; dx: number; dy: number; guides: SnapGuide[] }
  | { kind: 'attributes'; attributeIds: Id[] }
/** `external`: the hover comes from a drag that started outside the canvas (the sidebar). */
type Hover = {
  target: CanvasTarget
  point: Point
  count: number
  external?: boolean
  /** Alignment guides for where a table would land. */
  guides?: SnapGuide[]
  /** The width a new table made here would have. */
  newWidth?: number
}
/** What would become a new table on empty canvas: form fields being placed, or attributes being moved or copied. */
type NewTableSource = { fields: Id[] } | { attributes: Id[]; move: boolean }

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

  const zoomCenter = { x: size.width / 2, y: size.height / 2 }

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
    hitTest(clientX, clientY, fieldIds, free = false) {
      const hit = hitTest(clientX, clientY)
      return hit && fieldIds ? { ...hit, point: snapNewTable(hit.target, hit.point, { fields: fieldIds }, free).point } : hit
    },
    previewAt(clientX, clientY, fieldIds, free) {
      const hit = hitTest(clientX, clientY)
      setHover(hit ? { ...hit, ...snapNewTable(hit.target, hit.point, { fields: fieldIds }, free), count: fieldIds.length, external: true } : null)
    },
    clearPreview() {
      setHover(null)
    },
    zoomIn: () => setViewport(zoomAt(stateRef.current.ui.viewport, ZOOM_STEP, zoomCenter)),
    zoomOut: () => setViewport(zoomAt(stateRef.current.ui.viewport, 1 / ZOOM_STEP, zoomCenter)),
    fit: () => setViewport(fitToBounds(contentBounds(stateRef.current.doc, measurer), size)),
    resetZoom: () => {
      const v = stateRef.current.ui.viewport
      setViewport(zoomAt(v, 1 / v.zoom, zoomCenter))
    },
  }))

  const activate = (target: CanvasTarget, point: Point, additive = false) => {
    const action = resolveCanvasClick(stateRef.current, target, point, additive)
    if (action) dispatch(action)
  }

  /** Whether the pointer (or focus) previews what a click would do: a destination, a reference, a table's new place. */
  const previewing = (s: AppState) => choosingDestination(s) !== null || s.ui.operation.kind === 'reference' || s.ui.operation.kind === 'moveTable' || s.ui.operation.kind === 'copyTable'

  // Keyboard users get the same preview as the pointer, for the focused cell or table.
  const onFocus = (e: React.FocusEvent<SVGSVGElement>) => {
    const s = stateRef.current
    if (!previewing(s)) return
    const target = targetFrom(e.target as Element)
    if (target.kind === 'empty' || target.kind === 'reference') return
    const box = (e.target as Element).getBoundingClientRect()
    const count = s.ui.operation.kind === 'place' ? s.ui.selectedFieldIds.length : selectedAttributeIds(s.ui).length
    setHover({
      target: target.kind === 'attribute' ? { ...target, side: 'after' } : target,
      point: toWorld(box.left + box.width / 2, box.top + box.height / 2),
      count: Math.max(count, 1),
    })
  }

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    press.current = { pointerId: e.pointerId, start: { x: e.clientX, y: e.clientY }, target: targetFrom(e.target as Element, e.clientX) }
  }

  // A dragged table snaps into alignment with other tables' edges and centres; Shift moves it freely.
  const lastPointer = useRef<Point | null>(null)
  const strip = (l: RelationLayout) => ({ x: l.x, y: l.y, width: l.stripWidth, height: l.height })
  const others = (except?: Id) => [...layouts.values()].filter((l) => l.relationId !== except).map(strip)
  /** The references of table `id` to other tables, as connectors that may snap straight; `shift` moves its ends. */
  const connectorsOf = (id: Id, shift = 0): SnapConnector[] => {
    const own = layouts.get(id)
    if (!own) return []
    return stateRef.current.doc.references.flatMap((ref) => {
      if (ref.from.relationId === ref.to.relationId) return []
      const [mine, theirs] = ref.from.relationId === id ? [ref.from, ref.to] : ref.to.relationId === id ? [ref.to, ref.from] : [null, null]
      if (!mine || !theirs) return []
      const other = layouts.get(theirs.relationId)
      const at = endCentreX(own, mine)
      const to = other ? endCentreX(other, theirs) : null
      return other && at !== null && to !== null ? [{ at: at + shift, to, other: strip(other) }] : []
    })
  }
  const snapAt = (box: Rect, point: Point, except?: Id, connectors: SnapConnector[] = []) => {
    const r = snapMove(box, 0, 0, others(except), SNAP_DISTANCE / stateRef.current.ui.viewport.zoom, connectors)
    return { point: { x: point.x + r.dx, y: point.y + r.dy }, guides: r.guides }
  }
  /** The strip width of a new table made from `src`, measured as it will be laid out. */
  const newTableWidth = (src: NewTableSource): number => {
    const doc = stateRef.current.doc
    let attributes: Attribute[]
    if ('fields' in src) {
      const names = orderedFieldLabels(doc, src.fields).map(toValidName).filter((n) => n !== '')
      attributes = names.map((n, i) => newAttribute(`new-${i}`, n))
    } else {
      const ids = new Set(src.move ? expandToUnits(doc, src.attributes) : src.attributes)
      attributes = doc.relations.flatMap((r) => r.attributes.filter((a) => ids.has(a.id)))
    }
    return layoutRelation({ id: 'new', name: null, position: { x: 0, y: 0 }, attributes }, measurer).stripWidth
  }
  /** On empty canvas: the point nudged so the new table made from `src` lines up (unless `free`), its guides and width. */
  const snapNewTable = (target: CanvasTarget, point: Point, src: NewTableSource | null, free: boolean) => {
    if (!src || (target.kind !== 'empty' && target.kind !== 'reference')) return { point, guides: [] }
    const width = newTableWidth(src)
    const at = newTablePosition(point)
    const snapped = free ? { point, guides: [] } : snapAt({ x: at.x, y: at.y, width, height: METRICS.cellHeight }, point)
    return { ...snapped, newWidth: width }
  }
  /** What a click in the current operation would turn into a new table on empty canvas. */
  const clickSource = (s: AppState): NewTableSource | null => {
    const kind = choosingDestination(s)
    if (kind === 'place') return { fields: s.ui.selectedFieldIds }
    if (kind === 'move' || kind === 'copy') return { attributes: selectedAttributeIds(s.ui), move: kind === 'move' }
    return null
  }
  /** Where a click at `point` lands: snapped for Move/Copy table and for new tables, unless `free`. */
  const snapClick = (target: CanvasTarget, point: Point, free: boolean): { point: Point; guides: SnapGuide[]; newWidth?: number } => {
    const s = stateRef.current
    const op = s.ui.operation
    if (op.kind === 'moveTable' || op.kind === 'copyTable') {
      const own = layouts.get(op.relationId)
      if (free || !own) return { point, guides: [] }
      const at = newTablePosition(point)
      // A copy may line up with its original, but has no references; a moved table lines up with the others.
      const box = { ...strip(own), x: at.x, y: at.y }
      if (op.kind === 'copyTable') return snapAt(box, point)
      return snapAt(box, point, op.relationId, connectorsOf(op.relationId, at.x - own.x))
    }
    return snapNewTable(target, point, clickSource(s), free)
  }
  const previewAt = (target: CanvasTarget, clientX: number, clientY: number, free: boolean) => {
    const s = stateRef.current
    const count = s.ui.operation.kind === 'place' ? s.ui.selectedFieldIds.length : selectedAttributeIds(s.ui).length
    setHover({ target, ...snapClick(target, toWorld(clientX, clientY), free), count: Math.max(count, 1) })
  }
  const dragAttributesTo = (active: Extract<Drag, { kind: 'attributes' }>, clientX: number, clientY: number, free: boolean) => {
    const hit = hitTest(clientX, clientY)
    const src = { attributes: active.attributeIds, move: true }
    setHover(hit ? { ...hit, ...snapNewTable(hit.target, hit.point, src, free), count: active.attributeIds.length } : null)
  }
  const dragTableTo = (active: Extract<Drag, { kind: 'table' }>, p: Press, clientX: number, clientY: number, free: boolean) => {
    const s = stateRef.current
    const zoom = s.ui.viewport.zoom
    const dx = (clientX - p.start.x) / zoom
    const dy = (clientY - p.start.y) / zoom
    const own = layouts.get(active.relationId)
    if (free || !own) return setDrag({ ...active, dx, dy, guides: [] })
    setDrag({ ...active, ...snapMove(strip(own), dx, dy, others(active.relationId), SNAP_DISTANCE / zoom, connectorsOf(active.relationId)) })
  }
  // Pressing or releasing Shift mid-move switches snapping without waiting for the pointer to move.
  const snapping = drag !== null || choosingDestination(state) !== null || ui.operation.kind === 'moveTable' || ui.operation.kind === 'copyTable'
  useEffect(() => {
    if (!snapping) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Shift') return
      const active = dragRef.current
      const p = press.current
      const at = lastPointer.current
      const free = e.type === 'keydown'
      if (!at) return
      if (active?.kind === 'table' && p) dragTableTo(active, p, at.x, at.y, free)
      else if (active?.kind === 'attributes') dragAttributesTo(active, at.x, at.y, free)
      else if (hover && !hover.external) previewAt(hover.target, at.x, at.y, free)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  })

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const s = stateRef.current
    const p = press.current
    const d = dragRef.current
    if (p && p.pointerId === e.pointerId && !d && s.ui.operation.kind === 'select') {
      if (Math.hypot(e.clientX - p.start.x, e.clientY - p.start.y) >= DRAG_THRESHOLD) {
        const t = p.target
        let started: Drag | null = null
        if (t.kind === 'relation' || t.kind === 'relationName') started = { kind: 'table', relationId: t.relationId, dx: 0, dy: 0, guides: [] }
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
      lastPointer.current = { x: e.clientX, y: e.clientY }
      dragTableTo(active, p, e.clientX, e.clientY, e.shiftKey)
      return
    }
    if (active?.kind === 'attributes') {
      const n = active.attributeIds.length
      onGhost({ text: n === 1 ? 'Move 1 attribute' : `Move ${n} attributes`, x: e.clientX, y: e.clientY })
      lastPointer.current = { x: e.clientX, y: e.clientY }
      dragAttributesTo(active, e.clientX, e.clientY, e.shiftKey)
      return
    }
    // Preview of what a click would do: a destination, a reference, or a table's new place.
    if (previewing(s)) {
      lastPointer.current = { x: e.clientX, y: e.clientY }
      previewAt(targetFrom(e.target as Element, e.clientX), e.clientX, e.clientY, e.shiftKey)
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
        const point = hit && snapNewTable(hit.target, hit.point, { attributes: d.attributeIds, move: true }, e.shiftKey).point
        const action = hit && point && transferAction(s, 'move', d.attributeIds, hit.target, point)
        if (action) dispatch(action)
      }
      return
    }
    if (cancelled) return
    // A press that wandered off (beyond the threshold) without being a drag is not a click.
    if (Math.hypot(e.clientX - p.start.x, e.clientY - p.start.y) >= DRAG_THRESHOLD) return
    activate(p.target, snapClick(p.target, toWorld(e.clientX, e.clientY), e.shiftKey).point, e.shiftKey)
  }

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const target = targetFrom(e.target as Element)
    if (target.kind === 'empty') return
    e.preventDefault()
    e.stopPropagation()
    const s = stateRef.current
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
  // While creating a reference, its foreign key shows as such rather than as the selection.
  const selectedSet = useMemo(
    () => new Set(selection.kind === 'attributes' && op.kind !== 'reference' ? selection.attributeIds : []),
    [selection, op.kind],
  )
  // The reference a click on the hovered (or focused) cell would create: its ends and connector.
  const referencePreview = useMemo(() => {
    if (op.kind !== 'reference' || hover?.target.kind !== 'attribute') return null
    const intent = referenceIntent(state, hover.target.attributeId)
    if (!intent || 'problem' in intent) return null
    const ref: Reference = { id: 'preview', from: intent.from, to: intent.to }
    const geometry = layoutReferences([...doc.references, ref], layouts).find((g) => g.referenceId === 'preview') ?? null
    return { to: intent.to, geometry }
  }, [op, hover, state, doc.references, layouts])
  const draggedSet = useMemo(() => new Set(drag?.kind === 'attributes' ? drag.attributeIds : []), [drag])
  const editing = ui.editing

  // Cells of the reference being created, or of the selected reference; composite ends are numbered left to right.
  const marks = useMemo(() => {
    const map = new Map<Id, CellMark>()
    const mark = (ids: Id[], role: CellMark['role'], numbered: boolean, viewing = false) =>
      orderAttributeIds(doc, ids).forEach((id, i) => map.set(id, { role, viewing, ...(numbered ? { index: i + 1 } : {}) }))
    if (op.kind === 'reference') {
      const numbered = op.source.length > 1
      mark(op.source, 'source', numbered)
      if (referencePreview) mark(referencePreview.to.attributeIds, 'target', numbered)
    } else if (selection.kind === 'reference') {
      const ref = doc.references.find((r) => r.id === selection.referenceId)
      if (ref) {
        const numbered = ref.from.attributeIds.length > 1
        mark(ref.from.attributeIds, 'source', numbered, true)
        mark(ref.to.attributeIds, 'target', numbered, true)
      }
    }
    return map
  }, [op, selection, doc, referencePreview])
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

  // Where the context toolbar attaches: the selected table or cells, or beside a selected reference's line.
  // It stays during the operations it starts (with that button pressed), but not while dragging or renaming.
  const toolbarAnchor = ((): ToolbarAnchor | null => {
    if (op.kind === 'place' || drag || (editing && editing.kind !== 'newAttribute')) return null
    const toScreen = (x: number, y: number, width: number, height: number) => ({
      left: x * viewport.zoom + viewport.x,
      top: y * viewport.zoom + viewport.y,
      width: width * viewport.zoom,
      height: height * viewport.zoom,
    })
    if (selection.kind === 'relation') {
      const l = layouts.get(selection.relationId)
      if (!l) return null
      const top = Math.min(l.header.y, l.y)
      return { rect: toScreen(Math.min(l.x, l.header.x), top, Math.max(l.stripWidth, l.header.width), l.y + l.height - top), side: 'above' }
    }
    if (selection.kind === 'reference') {
      const g = referenceGeometry.find((x) => x.referenceId === selection.referenceId)
      const segment = g && longestSegment(g)
      if (!segment) return null
      const { mid, horizontal } = segment
      return { rect: toScreen(mid.x, mid.y, 0, 0), side: horizontal ? 'above' : 'right' }
    }
    if (selection.kind === 'attributes') {
      // One table: above its header band (which stays clickable), over the selected cells.
      let table: RelationLayout | null = null
      let x1 = Infinity
      let x2 = -Infinity
      for (const l of layouts.values())
        for (const c of l.cells)
          if (selection.attributeIds.includes(c.attributeId)) {
            table = l
            x1 = Math.min(x1, c.x)
            x2 = Math.max(x2, c.x + c.width)
          }
      if (!table) return null
      const top = Math.min(table.header.y, table.y)
      return { rect: toScreen(x1, top, x2 - x1, table.y + table.height - top), side: 'above' }
    }
    return null
  })()

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
        onFocus={onFocus}
        onBlur={() => !dragRef.current && setHover(null)}
        onDoubleClick={onDoubleClick}
      >
        <rect className="canvas-background" data-kind="empty" width="100%" height="100%" fill="transparent" />
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
          {doc.relations.map((r) => {
            const dragged = drag?.kind === 'table' && drag.relationId === r.id
            const shown = dragged ? { ...r, position: { x: r.position.x + drag.dx, y: r.position.y + drag.dy } } : r
            const layout = shownLayouts.get(r.id)!
            const relSelected =
              (selection.kind === 'relation' && selection.relationId === r.id) || ((op.kind === 'moveTable' || op.kind === 'copyTable') && op.relationId === r.id)
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
          {preview && <DestinationPreview intent={preview} layouts={layouts} count={hover!.count} newWidth={hover!.newWidth} />}
          {referencePreview?.geometry && <ReferencePreview geometry={referencePreview.geometry} />}
          {(drag?.kind === 'table' ? drag.guides : (hover?.guides ?? [])).map((g) =>
              g.axis === 'x' ? (
                <line key={`x${g.x}`} className="snap-guide" x1={g.x} x2={g.x} y1={g.y1 - SNAP_OVERHANG} y2={g.y2 + SNAP_OVERHANG} />
              ) : (
                <line key={`y${g.y}`} className="snap-guide" x1={g.x1 - SNAP_OVERHANG} x2={g.x2 + SNAP_OVERHANG} y1={g.y} y2={g.y} />
              ),
            )}
          {(op.kind === 'moveTable' || op.kind === 'copyTable') && hover && <TablePreview layout={layouts.get(op.relationId)} point={hover.point} />}
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
          // Right-aligned like the name it edits: its right edge stays at the strip's right edge.
          const width = Math.max(180, l.header.width - METRICS.gripWidth + 4)
          return (
            <InlineInput
              key={`name-${r.id}`}
              className="canvas-input name-input"
              style={{
                ...screenRect(l.x + l.stripWidth - width, l.header.y, width, l.header.height),
                fontSize: METRICS.labelSize * viewport.zoom,
              }}
              initial={r.name ?? ''}
              label="Table name (leave empty for an unnamed table)"
              placeholder="Table name"
              sanitize={typedName}
              onCommit={(value) => {
                dispatch({ type: 'ui', patch: { editing: null } })
                const name = toValidName(value) || null
                if (name !== r.name) dispatch({ type: 'command', command: { type: 'renameRelation', relationId: r.id, name } })
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
              sanitize={typedName}
              onCommit={(value) => {
                const name = toValidName(value)
                const command = name ? addAttributesFromNames(editing.relationId, [name]) : null
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
              sanitize={typedName}
              onCommit={(value) => {
                dispatch({ type: 'ui', patch: { editing: null } })
                const name = toValidName(value)
                if (name !== '' && name !== a.name) dispatch({ type: 'command', command: { type: 'renameAttribute', attributeId: a.id, name } })
              }}
              onCancel={() => dispatch({ type: 'ui', patch: { editing: null } })}
            />
          )
        })()}

      {toolbarAnchor && <SelectionToolbar state={state} dispatch={dispatch} anchor={toolbarAnchor} bounds={size} />}
    </div>
  )
}

/** Shows where a click (or drop) would put things: an insertion bar, or the outline of a new table. */
function DestinationPreview({
  intent,
  layouts,
  count,
  newWidth,
}: {
  intent: NonNullable<ReturnType<typeof destinationFor>>
  layouts: Map<string, RelationLayout>
  count: number
  /** The new table's real width, when known. */
  newWidth?: number
}) {
  if (intent.kind === 'newTable') {
    const { x, y } = intent.position
    const width = newWidth ?? Math.max(90, Math.min(count, 6) * 56)
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

/** The middle of a reference's longest straight piece, where its toolbar goes. */
function longestSegment(g: ReferenceGeometry): { mid: Point; horizontal: boolean } | null {
  let best: { mid: Point; horizontal: boolean; length: number } | null = null
  for (let i = 1; i < g.points.length; i++) {
    const a = g.points[i - 1]!
    const b = g.points[i]!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (!best || length > best.length)
      best = { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, horizontal: Math.abs(b.x - a.x) >= Math.abs(b.y - a.y), length }
  }
  return best
}

/** The connector a click would create while choosing the referenced attributes. */
function ReferencePreview({ geometry }: { geometry: ReferenceGeometry }) {
  return (
    <g className="preview preview-reference" aria-hidden="true">
      <path className="reference-line" d={polylinePath(geometry.points)} />
      <path className="reference-arrow" d={geometry.arrow} />
      {geometry.braces.map((b) => (
        <path key={b} className="reference-brace" d={b} />
      ))}
    </g>
  )
}

/** Where Move table would put the table: its outline, following the pointer. */
function TablePreview({ layout, point }: { layout: RelationLayout | undefined; point: Point }) {
  if (!layout) return null
  const at = newTablePosition(point)
  const dx = at.x - layout.x
  const dy = at.y - layout.y
  return (
    <g className="preview" aria-hidden="true" transform={`translate(${dx} ${dy})`}>
      <rect className="preview-table" x={layout.header.x} y={layout.header.y} width={layout.header.width} height={layout.header.height} />
      <rect className="preview-table" x={layout.x} y={layout.y} width={layout.stripWidth} height={layout.height} />
    </g>
  )
}
