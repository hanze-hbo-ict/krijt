import { useEffect, useMemo, useReducer, useRef, useState, type Dispatch } from 'react'
import { Canvas } from '../canvas/Canvas'
import { Icon } from '../components/Icon'
import { isTypingTarget } from '../components/InlineInput'
import { Splitter } from '../components/Splitter'
import { createCanvasMeasurer } from '../geometry/measure'
import { Sidebar } from '../inventory/Sidebar'
import { loadSession, safeSessionStorage, SAVE_DEBOUNCE_MS, saveSession } from '../persistence/session'
import { initialState, reducer, SIDEBAR_MAX, SIDEBAR_MIN, type Action, type AppState } from '../state/appState'
import { operationInstruction } from '../state/interaction'
import { HelpDialog } from './HelpDialog'

const NUDGE = 10

function init(): AppState {
  const session = loadSession(safeSessionStorage())
  return session ? initialState(session.doc, session.ui) : initialState()
}

type SaveStatus = 'ok' | 'failed' | 'unavailable'

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, init)
  const measurer = useMemo(() => createCanvasMeasurer(), [])
  const [helpOpen, setHelpOpen] = useState(false)
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

  // Global shortcuts, never while typing in a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target) || helpOpenRef.current) return
      const s = stateRef.current
      if (e.key === 'Escape') {
        dispatch({ type: 'cancel' })
        return
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
      const dir = arrows[e.key]
      if (dir && s.ui.selection.kind === 'relation' && s.ui.operation.kind === 'select' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const id = s.ui.selection.relationId
        const r = s.doc.relations.find((x) => x.id === id)
        if (!r) return
        e.preventDefault()
        dispatch({ type: 'command', command: { type: 'moveRelation', relationId: id, position: { x: r.position.x + dir[0] * NUDGE, y: r.position.y + dir[1] * NUDGE } } })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
          <button type="button" onClick={() => setHelpOpen(true)}>
            <Icon name="help" />
            Help
          </button>
        </div>
      </header>

      <main className="workspace" style={{ gridTemplateColumns: `${state.ui.sidebarWidth}px 12px minmax(0, 1fr)` }}>
        <Sidebar state={state} dispatch={dispatch} />
        <Splitter
          width={state.ui.sidebarWidth}
          min={SIDEBAR_MIN}
          max={SIDEBAR_MAX}
          label="Resize form fields sidebar"
          onChange={(w) => dispatch({ type: 'ui', patch: { sidebarWidth: w } })}
        />
        <section className="panel diagram-panel" aria-label="Diagram">
          <ContextBar state={state} dispatch={dispatch} />
          <Canvas state={state} dispatch={dispatch} measurer={measurer} />
        </section>
      </main>

      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
    </div>
  )
}

/** Operation instructions with Cancel, or actions for the current selection. */
function ContextBar({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const { doc, ui } = state
  const instruction = operationInstruction(state)
  const message = ui.message

  if (instruction) {
    return (
      <div className="context-bar operation" role="region" aria-label="Current operation">
        <span className="op-badge">{ui.operation.kind === 'place' ? 'Place' : 'Move table'}</span>
        <span className="instruction" aria-live="polite">
          {instruction}
        </span>
        {message && (
          <span className="bar-message" role="alert">
            {message.text}
          </span>
        )}
        <button type="button" className="cancel-button" onClick={() => dispatch({ type: 'cancel' })}>
          Cancel <kbd>Esc</kbd>
        </button>
      </div>
    )
  }

  const sel = ui.selection
  const relationId = sel.kind === 'none' ? null : sel.relationId
  const relation = relationId ? doc.relations.find((r) => r.id === relationId) : undefined
  const attribute = sel.kind === 'attribute' ? relation?.attributes.find((a) => a.id === sel.attributeId) : undefined

  return (
    <div className="context-bar" role="toolbar" aria-label="Selection actions">
      {relation ? (
        <>
          <span className="selection-label">
            {attribute ? (
              <>
                <strong>{attribute.name || '(no name)'}</strong> in {relation.name ? <strong>{relation.name}</strong> : 'unnamed table'}
              </>
            ) : relation.name ? (
              <strong>{relation.name}</strong>
            ) : (
              'Unnamed table'
            )}
          </span>
          <button type="button" onClick={() => dispatch({ type: 'ui', patch: { selection: { kind: 'relation', relationId: relation.id }, editing: { kind: 'relationName', relationId: relation.id } } })}>
            <Icon name="tag" />
            {relation.name ? 'Rename table' : 'Name table'}
          </button>
          <button type="button" onClick={() => dispatch({ type: 'ui', patch: { selection: { kind: 'relation', relationId: relation.id }, editing: { kind: 'newAttribute', relationId: relation.id } } })}>
            <Icon name="plus" />
            Add attribute
          </button>
          <button type="button" onClick={() => dispatch({ type: 'startMoveTable', relationId: relation.id })}>
            <Icon name="move" />
            Move table
          </button>
          <button
            type="button"
            className="danger-quiet"
            onClick={() => {
              const n = relation.attributes.length
              if (window.confirm(`Delete ${relation.name ? `table ${relation.name}` : 'this unnamed table'} and its ${n} attribute${n === 1 ? '' : 's'}?`))
                dispatch({ type: 'command', command: { type: 'deleteRelation', relationId: relation.id } })
            }}
          >
            <Icon name="trash" />
            Delete table
          </button>
        </>
      ) : (
        <span className="hint">
          {doc.relations.length === 0 ? 'No tables yet.' : 'Click a table’s header or an attribute to select it.'}
        </span>
      )}
      {message && (
        <span className="bar-message" role="alert">
          {message.text}
        </span>
      )}
    </div>
  )
}
