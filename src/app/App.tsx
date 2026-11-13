import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Canvas, type CanvasHandle, type DragGhost } from '../canvas/Canvas'
import { Icon } from '../components/Icon'
import { isTypingTarget } from '../components/InlineInput'
import { Splitter } from '../components/Splitter'
import { createCanvasMeasurer } from '../geometry/measure'
import { DEFAULT_VIEWPORT } from '../geometry/viewport'
import { Sidebar } from '../inventory/Sidebar'
import { browserEnv, COPY_MESSAGES, copyImage, copyText, failureMessage } from '../clipboard/clipboard'
import { renderPng } from '../clipboard/paint'
import { exportScale, exportScene } from '../clipboard/scene'
import { serializeDocument } from '../model/serialize'
import { readSession, safeSessionStorage, SAVE_DEBOUNCE_MS, saveSession, UNREADABLE_SESSION_MESSAGE } from '../persistence/session'
import { initialState, reducer, selectedAttributeIds, SIDEBAR_MAX, SIDEBAR_MIN, type AppState } from '../state/appState'
import { DiagramHeader } from './DiagramHeader'
import { MessageBanner } from './MessageBanner'
import { ClearDialog } from './ClearDialog'
import { HelpDialog } from './HelpDialog'

const NUDGE = 10

function init(): AppState {
  const { data, status } = readSession(safeSessionStorage())
  if (data) return initialState(data.doc, data.ui)
  return status === 'unreadable' ? initialState(undefined, { message: { kind: 'error', text: UNREADABLE_SESSION_MESSAGE } }) : initialState()
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
  const [clearOpen, setClearOpen] = useState(false)
  const [copying, setCopying] = useState<'image' | 'data' | null>(null)
  // After a confirmed copy, that button shows a checkmark for a moment (as Krash's copy buttons do).
  const [copied, setCopied] = useState<'image' | 'data' | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (copiedTimer.current && clearTimeout(copiedTimer.current)), [])
  const confirmCopied = (kind: 'image' | 'data') => {
    setCopied(kind)
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(null), 1500)
  }
  const [ghost, setGhost] = useState<DragGhost>(null)
  const canvasHandle = useRef<CanvasHandle | null>(null)
  const storage = useMemo(() => safeSessionStorage(), [])
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(storage ? 'ok' : 'unavailable')
  const stateRef = useRef(state)
  stateRef.current = state

  // Debounced same-tab recovery after document or layout changes.
  const { doc } = state
  const { viewport, sidebarWidth } = state.ui
  useEffect(() => {
    if (!storage) return
    const t = setTimeout(() => setSaveStatus(saveSession(storage, { doc, ui: { viewport, sidebarWidth } }) ? 'ok' : 'failed'), SAVE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [storage, doc, viewport, sidebarWidth])

  // Do not lose the last debounce window: save at once when the tab is hidden or the page goes away.
  useEffect(() => {
    if (!storage) return
    const flush = () => {
      const s = stateRef.current
      saveSession(storage, { doc: s.doc, ui: { viewport: s.ui.viewport, sidebarWidth: s.ui.sidebarWidth } })
    }
    const onVisibility = () => document.visibilityState === 'hidden' && flush()
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [storage])

  const say = (kind: 'error' | 'info', text: string) => dispatch({ type: 'ui', patch: { message: { kind, text } } })

  // Both copies start synchronously inside the click, so the browser sees a user gesture.
  const onCopyImage = () => {
    const scene = exportScene(stateRef.current.doc, measurer)
    if (!scene) return say('error', COPY_MESSAGES.empty)
    const scale = exportScale(scene.bounds)
    if (!scale) return say('error', COPY_MESSAGES.tooLarge)
    setCopying('image')
    void copyImage(browserEnv(), () => renderPng(scene, scale)).then((result) => {
      setCopying(null)
      if (result.ok) {
        confirmCopied('image')
        say('info', COPY_MESSAGES.imageCopied)
      }
      else say('error', failureMessage('image', result.reason, result.detail))
    })
  }
  const onCopyData = () => {
    setCopying('data')
    void copyText(browserEnv(), serializeDocument(stateRef.current.doc)).then((result) => {
      setCopying(null)
      if (result.ok) {
        confirmCopied('data')
        say('info', COPY_MESSAGES.dataCopied)
      }
      else say('error', failureMessage('data', result.reason, result.detail))
    })
  }

  // Global shortcuts, never while typing in a text field (native undo there stays native).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A modal dialog owns the keyboard. Checked in the DOM, not React state, which lags behind the close event.
      if (e.defaultPrevented || isTypingTarget(e.target) || document.querySelector('dialog[open]')) return
      const s = stateRef.current
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && !e.altKey && !e.shiftKey && key === '0') {
        e.preventDefault()
        canvasHandle.current?.resetZoom()
        return
      }
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
        if (op.kind === 'select' && attrs.length === 1) {
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
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.ui.selection.kind === 'reference') {
        e.preventDefault()
        dispatch({ type: 'command', command: { type: 'deleteReference', referenceId: s.ui.selection.referenceId } })
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
        <Sidebar state={state} dispatch={dispatch} canvasHandle={canvasHandle} onGhost={setGhost} />
        <Splitter
          width={state.ui.sidebarWidth}
          min={SIDEBAR_MIN}
          max={SIDEBAR_MAX}
          label="Resize form fields sidebar"
          onChange={(w) => dispatch({ type: 'ui', patch: { sidebarWidth: w } })}
        />
        <section className="panel diagram-panel" aria-labelledby="diagram-title">
          <DiagramHeader
            state={state}
            dispatch={dispatch}
            copying={copying}
            copied={copied}
            onCopyImage={onCopyImage}
            onCopyData={onCopyData}
            onClear={() => setClearOpen(true)}
            onZoomOut={() => canvasHandle.current?.zoomOut()}
            onZoomIn={() => canvasHandle.current?.zoomIn()}
            onFit={() => canvasHandle.current?.fit()}
          />
          <div className="canvas-area">
            <Canvas state={state} dispatch={dispatch} measurer={measurer} handleRef={canvasHandle} onGhost={setGhost} />
            <MessageBanner state={state} dispatch={dispatch} />
          </div>
        </section>
      </main>

      {ghost && (
        <div className="drag-ghost" style={{ left: ghost.x + 14, top: ghost.y + 10 }} aria-hidden="true">
          {ghost.text}
        </div>
      )}

      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      {clearOpen && (
        <ClearDialog
          hasFields={doc.sourceFields.length > 0}
          onClose={() => setClearOpen(false)}
          onClear={(keepFields) =>
            dispatch({
              type: 'command',
              command: { type: 'clearDocument', keepFields },
              after: {
                operation: { kind: 'select' },
                selection: { kind: 'none' },
                selectedFieldIds: [],
                editing: null,
                viewport: DEFAULT_VIEWPORT,
                message: { kind: 'info', text: 'Diagram cleared. Undo brings it back.' },
              },
            })
          }
        />
      )}
    </div>
  )
}
