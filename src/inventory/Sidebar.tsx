/**
 * Form-field inventory: the fields of the original form, as a plain list.
 *
 * A click selects a field (Shift-click, or Add to selection in the toolbar, adds or removes one). Selected fields
 * get a floating toolbar, as in the diagram: Place in diagram, Tick, Rename and Delete act on all of them. A tick is
 * the student's own marker; nothing else depends on it. Placing copies fields into the diagram and never changes the
 * list.
 *
 * Dragging fields onto the canvas is a shortcut for Place: it uses the same placeAction as clicking a destination in
 * Place mode.
 *
 * New fields are typed into the last row of the list; pasting several lines there adds one field per line.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { DRAG_THRESHOLD, type CanvasHandle, type DragGhost } from '../canvas/Canvas'
import { Separator, ToolButton } from '../canvas/SelectionToolbar'
import { browserEnv, COPY_MESSAGES, copyText, failureMessage } from '../clipboard/clipboard'
import { placeAction } from '../state/interaction'
import { addSourceFields, parseFieldList } from '../commands/builders'
import { Icon } from '../components/Icon'
import { InlineInput } from '../components/InlineInput'
import type { SourceField } from '../model/types'
import { MAX_TEXT_LENGTH } from '../model/validate'
import type { Action, AppState } from '../state/appState'

interface Props {
  state: AppState
  dispatch: Dispatch<Action>
  canvasHandle: MutableRefObject<CanvasHandle | null>
  onGhost: (ghost: DragGhost) => void
}

export function Sidebar({ state, dispatch, canvasHandle, onGhost }: Props) {
  const { doc, ui } = state
  const collapsed = ui.sidebarCollapsed
  const [entry, setEntry] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (copiedTimer.current && clearTimeout(copiedTimer.current)), [])
  const selected = new Set(ui.selectedFieldIds)
  const stateRef = useRef(state)
  stateRef.current = state
  const bodyRef = useRef<HTMLDivElement>(null)
  /** Set after a drag ends, so the click that follows pointerup does not change the selection. */
  const suppressClick = useRef(false)

  const startFieldPress = (e: ReactPointerEvent, fieldId: string) => {
    if (e.button !== 0) return
    const start = { x: e.clientX, y: e.clientY }
    let dragging: string[] | null = null
    const onMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return
        // Dragging a selected field drags all selected fields; otherwise just that one.
        const sel = stateRef.current.ui.selectedFieldIds
        dragging = sel.includes(fieldId) ? [...sel] : [fieldId]
      }
      onGhost({ text: dragging.length === 1 ? 'Place 1 field' : `Place ${dragging.length} fields`, x: ev.clientX, y: ev.clientY })
      canvasHandle.current?.previewAt(ev.clientX, ev.clientY, dragging, ev.shiftKey)
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (!dragging) return
      suppressClick.current = true
      setTimeout(() => (suppressClick.current = false), 0)
      onGhost(null)
      canvasHandle.current?.clearPreview()
      const hit = canvasHandle.current?.hitTest(ev.clientX, ev.clientY, dragging, ev.shiftKey)
      if (!hit) return
      const action = placeAction(stateRef.current, dragging, hit.target, hit.point)
      if (action) dispatch(action)
    }
    const onCancel = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      onGhost(null)
      canvasHandle.current?.clearPreview()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  const add = (labels: string[]) => {
    const command = addSourceFields(labels)
    if (!command) return
    dispatch({ type: 'command', command })
    // The entry row moves down as the list grows: scroll to the end, so it stays in view (with room for its tooltip).
    requestAnimationFrame(() => {
      const body = bodyRef.current
      if (body) body.scrollTop = body.scrollHeight
    })
  }

  const onEntryPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text/plain')
    if (!/[\r\n]/.test(text)) return
    // A multi-line paste adds one field per line.
    e.preventDefault()
    add(parseFieldList(text))
  }

  const say = (kind: 'error' | 'info', text: string) => dispatch({ type: 'ui', patch: { message: { kind, text } } })
  const onCopy = () => {
    const text = stateRef.current.doc.sourceFields.map((f) => f.label).join('\n')
    void copyText(browserEnv(), text).then((result) => {
      if (!result.ok) return say('error', failureMessage('fields', result.reason, result.detail))
      say('info', COPY_MESSAGES.fieldsCopied)
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 1500)
    })
  }

  const deleteSelected = () => {
    const ids = stateRef.current.ui.selectedFieldIds
    if (ids.length > 0) dispatch({ type: 'command', command: { type: 'deleteSourceFields', fieldIds: ids } })
  }

  // Keys on a focused field or the field toolbar: Delete removes the selected fields, Escape clears the selection.
  const onListKeyDown = (e: ReactKeyboardEvent) => {
    const s = stateRef.current
    if (e.ctrlKey || e.metaKey || e.altKey || s.ui.operation.kind !== 'select' || s.ui.selectedFieldIds.length === 0) return
    if (!(e.target instanceof Element) || !e.target.closest('.field-toggle, .field-toolbar')) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      deleteSelected()
    } else if (e.key === 'Escape') {
      // Handled here, so the global Escape (which clears the diagram selection) does not run as well.
      e.preventDefault()
      dispatch({ type: 'ui', patch: { selectedFieldIds: [] } })
    }
  }

  const anchorId = ui.selectedFieldIds[ui.selectedFieldIds.length - 1]
  const showToolbar = !collapsed && anchorId !== undefined && editingId === null

  return (
    <aside className="panel sidebar" aria-labelledby="fields-title">
      <div className="panel-header">
        <h2 id="fields-title">Form fields</h2>
        {!collapsed && (
          <button
            type="button"
            className="icon-button"
            aria-label="Copy form fields"
            data-tooltip={copied ? 'Copied' : 'Copy form fields'}
            disabled={doc.sourceFields.length === 0}
            onClick={onCopy}
          >
            <Icon name={copied ? 'check' : 'copy'} />
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          aria-expanded={!collapsed}
          aria-controls="sidebar-body"
          aria-label={collapsed ? 'Show form fields' : 'Hide form fields'}
          data-tooltip={collapsed ? 'Show' : 'Hide'}
          data-tooltip-pos={collapsed ? undefined : 'end'}
          onClick={() => dispatch({ type: 'ui', patch: { sidebarCollapsed: !collapsed } })}
        >
          <Icon name="sidebar" />
        </button>
      </div>

      <div
        className="sidebar-body"
        id="sidebar-body"
        ref={bodyRef}
        hidden={collapsed}
        onKeyDown={onListKeyDown}
        onClick={(e) => {
          // A click on empty space below or between the fields clears the selection.
          const t = e.target as Element
          if (t === e.currentTarget || t.classList.contains('field-list')) dispatch({ type: 'ui', patch: { selectedFieldIds: [] } })
        }}
      >
        {doc.sourceFields.length > 0 && (
          <ul className="field-list" aria-label="Form fields">
            {doc.sourceFields.map((f) => (
              <FieldRow
                key={f.id}
                field={f}
                selected={selected.has(f.id)}
                editing={editingId === f.id}
                onClick={(additive) => {
                  if (suppressClick.current) return
                  const multi = additive || stateRef.current.ui.multiSelectFields
                  dispatch({ type: multi ? 'toggleField' : 'selectField', fieldId: f.id })
                }}
                onPress={(e) => startFieldPress(e, f.id)}
                onEdit={() => setEditingId(f.id)}
                onRename={(label) => {
                  setEditingId(null)
                  if (label.trim() !== '' && label !== f.label)
                    dispatch({ type: 'command', command: { type: 'renameSourceField', fieldId: f.id, label } })
                }}
                onCancelEdit={() => setEditingId(null)}
              />
            ))}
          </ul>
        )}

        <form
          className="field-entry"
          onSubmit={(e) => {
            e.preventDefault()
            if (entry.trim() === '') return
            add([entry])
            setEntry('')
          }}
        >
          <input
            aria-label="New field"
            placeholder="Add a field…"
            value={entry}
            maxLength={MAX_TEXT_LENGTH}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setEntry(e.target.value)}
            onPaste={onEntryPaste}
          />
          <button
            type="submit"
            className="icon-button"
            aria-label="Add field"
            data-tooltip="Add field"
            data-tooltip-pos="end"
            disabled={entry.trim() === ''}
          >
            <Icon name="plus" />
          </button>
        </form>

        {showToolbar && (
          <FieldToolbar state={state} dispatch={dispatch} anchorId={anchorId} bodyRef={bodyRef} onRename={setEditingId} onDelete={deleteSelected} />
        )}
      </div>
    </aside>
  )
}

interface RowProps {
  field: SourceField
  selected: boolean
  editing: boolean
  onClick: (additive: boolean) => void
  onPress: (e: ReactPointerEvent) => void
  onEdit: () => void
  onRename: (label: string) => void
  onCancelEdit: () => void
}

function FieldRow({ field, selected, editing, onClick, onPress, onEdit, onRename, onCancelEdit }: RowProps) {
  if (editing) {
    return (
      <li className="field-row editing" data-field-id={field.id}>
        <InlineInput
          className="field-edit"
          initial={field.label}
          label={`Rename field ${field.label}`}
          onCommit={onRename}
          onCancel={onCancelEdit}
        />
      </li>
    )
  }
  return (
    <li className="field-row" data-field-id={field.id} data-selected={selected || undefined}>
      <button
        type="button"
        className="field-toggle"
        aria-pressed={selected}
        onClick={(e) => onClick(e.shiftKey)}
        onPointerDown={onPress}
        onDoubleClick={onEdit}
      >
        <span className="field-label">{field.label}</span>
        {field.ticked && (
          <span className="field-tick">
            <Icon name="check" />
            <span className="visually-hidden"> (ticked)</span>
          </span>
        )}
      </button>
    </li>
  )
}

/** Space between the toolbar and the sidebar (or the row), and between the toolbar and the window edge. */
const GAP = 8
const EDGE = 6

interface ToolbarProps {
  state: AppState
  dispatch: Dispatch<Action>
  /** The most recently clicked selected field: the toolbar floats next to its row. */
  anchorId: string
  bodyRef: RefObject<HTMLDivElement>
  onRename: (fieldId: string) => void
  onDelete: () => void
}

/**
 * The fields' context toolbar. It floats level with the row last clicked, just outside the sidebar's right edge, so
 * it never covers another field (on a narrow screen, where there is no room beside the sidebar, it sits above or
 * below the row instead). It follows the row as the list scrolls, and hides while the row is scrolled out of view.
 */
function FieldToolbar({ state, dispatch, anchorId, bodyRef, onRename, onDelete }: ToolbarProps) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const body = bodyRef.current
    const el = ref.current
    const panel = body?.closest('.sidebar')
    if (!body || !el || !panel) return
    const place = () => {
      const row = body.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(anchorId)}"]`)
      if (!row) return
      const r = row.getBoundingClientRect()
      const view = body.getBoundingClientRect()
      const side = panel.getBoundingClientRect()
      const w = el.offsetWidth
      const h = el.offsetHeight
      const inView = r.bottom > view.top && r.top < view.bottom
      let left: number
      let top: number
      let where: string
      if (side.right + GAP + w <= window.innerWidth - EDGE) {
        where = 'right'
        left = side.right + GAP
        top = Math.max(view.top, Math.min(r.top + r.height / 2 - h / 2, view.bottom - h))
      } else {
        left = Math.max(EDGE, side.right - GAP - w)
        where = r.top - GAP - h >= view.top ? 'above' : 'below'
        top = where === 'above' ? r.top - GAP - h : r.bottom + GAP
      }
      el.style.left = `${Math.round(left)}px`
      el.style.top = `${Math.round(top)}px`
      el.dataset.place = where
      el.style.visibility = inView ? 'visible' : 'hidden'
    }
    place()
    body.addEventListener('scroll', place, { passive: true })
    window.addEventListener('resize', place)
    return () => {
      body.removeEventListener('scroll', place)
      window.removeEventListener('resize', place)
    }
  })

  const ids = state.ui.selectedFieldIds
  const wanted = new Set(ids)
  const fields = state.doc.sourceFields.filter((f) => wanted.has(f.id))
  if (fields.length === 0) return null
  const op = state.ui.operation.kind
  const busy = op !== 'select'
  const ticked = fields.filter((f) => f.ticked).length
  const tick = ticked === fields.length ? true : ticked === 0 ? false : 'mixed'
  const placeButton = (
    <ToolButton
      label="Place in diagram"
      operation
      pressed={op === 'place'}
      disabled={busy && op !== 'place'}
      onClick={() => dispatch(op === 'place' ? { type: 'cancel' } : { type: 'startPlace' })}
    >
      <Icon name="move" />
    </ToolButton>
  )

  // While placing, only the pressed Place button (the way to cancel) is shown, so the toolbar barely reaches over
  // the diagram where the destination is clicked.
  if (op === 'place')
    return (
      <div ref={ref} className="selection-toolbar field-toolbar" role="toolbar" aria-label="Field actions" style={{ visibility: 'hidden' }}>
        {placeButton}
      </div>
    )

  return (
    <div ref={ref} className="selection-toolbar field-toolbar" role="toolbar" aria-label="Field actions" style={{ visibility: 'hidden' }}>
      <ToolButton
        label="Add to selection"
        tooltip="Add to selection: clicks add or remove fields"
        pressed={state.ui.multiSelectFields}
        disabled={busy}
        onClick={() => dispatch({ type: 'ui', patch: { multiSelectFields: !state.ui.multiSelectFields } })}
      >
        <Icon name="selectMore" />
      </ToolButton>
      <Separator />
      {placeButton}
      <ToolButton
        label="Tick"
        pressed={tick}
        disabled={busy}
        onClick={() => dispatch({ type: 'command', command: { type: 'setSourceFieldsTicked', fieldIds: ids, value: tick !== true } })}
      >
        <Icon name="check" />
      </ToolButton>
      <ToolButton label="Rename" disabled={busy || fields.length !== 1} onClick={() => onRename(fields[0]!.id)}>
        <Icon name="pencil" />
      </ToolButton>
      <Separator />
      <ToolButton label="Delete" danger disabled={busy} onClick={onDelete}>
        <Icon name="trash" />
      </ToolButton>
    </div>
  )
}
