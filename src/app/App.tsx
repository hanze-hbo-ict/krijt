import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Canvas, type CanvasHandle, type DragGhost } from '../canvas/Canvas'
import { Icon } from '../components/Icon'
import { isTypingTarget } from '../components/InlineInput'
import { Splitter } from '../components/Splitter'
import { createCanvasMeasurer } from '../geometry/measure'
import { Sidebar } from '../inventory/Sidebar'
import { loadSession, safeSessionStorage, SAVE_DEBOUNCE_MS, saveSession } from '../persistence/session'
import { initialState, reducer, selectedAttributeIds, SIDEBAR_MAX, SIDEBAR_MIN, type AppState } from '../state/appState'
import { ContextBar, MessageBanner, ToolStrip } from './ContextBar'
import { HelpDialog } from './HelpDialog'
import { IS_MAC, MOD_KEY } from './platform'

const NUDGE = 10

function init(): AppState {
  const session = loadSession(safeSessionStorage())
  return session ? initialState(session.doc, session.ui) : initialState()
}

type SaveStatus = 'ok' | 'failed' | 'unavailable'


/**
 * Enter, Delete and arrows act on the diagram only when focus is not on a control that handles them itself.
 * Focused diagram cells and table headers (SVG) are not such controls.
 */
function isControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || target instanceof SVGElement) return false
  return !!target.closest('button, a, [role="button"], [role="separator"], dialog')
}

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, init)
  const measurer = useMemo(() => createCanvasMeasurer(), [])
  const [helpOpen, setHelpOpen] = useState(false)
  const [ghost, setGhost] = useState<DragGhost>(null)
  const canvasHandle = useRef<CanvasHandle | null>(null)
  const storage = useMemo(() => safeSessionStorage(), [])
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(storage ? 'ok' : 'unavailable')
  const stateRef = useRef(state)
  stateRef.current = state
  const helpOpenRef = useRef(helpOpen)
  helpOpenRef.current = helpOpen

  // Debounced same-tab recovery after document or layout changes.
  const { doc } = state
  const { viewport, sidebarWidth } = state.ui
  useEffect(() => {
    if (!storage) return
    const t = setTimeout(() => setSaveStatus(saveSession(storage, { doc, ui: { viewport, sidebarWidth } }) ? 'ok' : 'failed'), SAVE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [storage, doc, viewport, sidebarWidth])

  // Global shortcuts, never while typing in a text field (native undo there stays native).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target) || helpOpenRef.current) return
      const s = stateRef.current
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && !e.altKey && (key === 'z' || key === 'y')) {
        e.preventDefault()
        dispatch({ type: key === 'y' || e.shiftKey ? 'redo' : 'undo' })
        return
      }
      if (e.key === 'Escape') {
        dispatch({ type: 'cancel' })
        return
      }
      if (mod || e.altKey || isControl(e.target)) return
      const op = s.ui.operation
      const attrs = selectedAttributeIds(s.ui)
      if (e.key === 'Enter') {
        if ((op.kind === 'move' || op.kind === 'copy') && op.phase === 'selecting') {
          e.preventDefault()
          dispatch({ type: 'next' })
        } else if (op.kind === 'select' && attrs.length === 1) {
          e.preventDefault()
          dispatch({ type: 'ui', patch: { editing: { kind: 'attributeName', attributeId: attrs[0]! } } })
        }
        return
      }
      if (op.kind !== 'select') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && attrs.length > 0) {
        e.preventDefault()
        dispatch({ type: 'command', command: { type: 'deleteAttributes', attributeIds: attrs } })
        return
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
      const dir = arrows[e.key]
      if (!dir) return
      if (attrs.length > 0 && dir[0] !== 0) {
        e.preventDefault()
        dispatch({ type: 'command', command: { type: 'shiftAttributes', attributeIds: attrs, delta: dir[0] as -1 | 1 } })
      } else if (s.ui.selection.kind === 'relation') {
        const id = s.ui.selection.relationId
        const r = s.doc.relations.find((x) => x.id === id)
        if (!r) return
        e.preventDefault()
        dispatch({
          type: 'command',
          command: { type: 'moveRelation', relationId: id, position: { x: r.position.x + dir[0] * NUDGE, y: r.position.y + dir[1] * NUDGE } },
          coalesceKey: `nudge:${id}`,
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const { past, future } = state.history

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            K
          </span>
          <div>
            <h1>Krijt</h1>
            <p lang="nl">Strokendiagrammen</p>
          </div>
        </div>
        <div className="header-actions">
          {saveStatus !== 'ok' && (
            <span className="save-warning" role="status">
              {saveStatus === 'failed' ? 'Could not keep a copy for reload' : 'Reload recovery unavailable in this browser'}
            </span>
          )}
          <div className="history-actions" role="group" aria-label="History">
            <button
              type="button"
              className="icon-button header-icon"
              aria-label="Undo"
              aria-keyshortcuts={IS_MAC ? 'Meta+Z' : 'Control+Z'}
              data-tooltip={`Undo (${MOD_KEY}+Z)`}
              disabled={past.length === 0}
              onClick={() => dispatch({ type: 'undo' })}
            >
              <Icon name="undo" />
            </button>
            <button
              type="button"
              className="icon-button header-icon"
              aria-label="Redo"
              aria-keyshortcuts={IS_MAC ? 'Meta+Shift+Z' : 'Control+Shift+Z'}
              data-tooltip={`Redo (${MOD_KEY}+Shift+Z)`}
              disabled={future.length === 0}
              onClick={() => dispatch({ type: 'redo' })}
            >
              <Icon name="redo" />
            </button>
          </div>
          <button type="button" onClick={() => setHelpOpen(true)}>
            <Icon name="help" />
            Help
          </button>
        </div>
      </header>

      <main className="workspace" style={{ gridTemplateColumns: `${state.ui.sidebarWidth}px 12px minmax(0, 1fr)` }}>
        <Sidebar state={state} dispatch={dispatch} canvasHandle={canvasHandle} onGhost={setGhost} />
        <Splitter
          width={state.ui.sidebarWidth}
          min={SIDEBAR_MIN}
          max={SIDEBAR_MAX}
          label="Resize form fields sidebar"
          onChange={(w) => dispatch({ type: 'ui', patch: { sidebarWidth: w } })}
        />
        <section className="panel diagram-panel" aria-label="Diagram">
          <ContextBar state={state} dispatch={dispatch} />
          <div className="diagram-body">
            <ToolStrip state={state} dispatch={dispatch} />
            <div className="canvas-area">
              <Canvas state={state} dispatch={dispatch} measurer={measurer} handleRef={canvasHandle} onGhost={setGhost} />
              <MessageBanner state={state} dispatch={dispatch} />
            </div>
          </div>
        </section>
      </main>

      {ghost && (
        <div className="drag-ghost" style={{ left: ghost.x + 14, top: ghost.y + 10 }} aria-hidden="true">
          {ghost.text}
        </div>
      )}

      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
    </div>
  )
}
