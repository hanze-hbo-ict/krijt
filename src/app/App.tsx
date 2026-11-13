import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Canvas, type CanvasHandle, type DragGhost } from '../canvas/Canvas'
import { ThemeIcon } from '../components/Icon'
import { isTypingTarget } from '../components/InlineInput'
import { createCanvasMeasurer } from '../geometry/measure'
import { DEFAULT_VIEWPORT } from '../geometry/viewport'
import { Sidebar } from '../inventory/Sidebar'
import { browserEnv, COPY_MESSAGES, copyImage, copyText, failureMessage } from '../clipboard/clipboard'
import { renderPng } from '../clipboard/paint'
import { exportScale, exportScene } from '../clipboard/scene'
import { serializeDocument } from '../model/serialize'
import { readSession, safeSessionStorage, SAVE_DEBOUNCE_MS, saveSession, UNREADABLE_SESSION_MESSAGE } from '../persistence/session'
import { initialState, reducer, selectedAttributeIds, type AppState } from '../state/appState'
import { DiagramHeader } from './DiagramHeader'
import { ErrorDialog } from './ErrorDialog'
import { ClearDialog } from './ClearDialog'

const NUDGE = 10

function init(): AppState {
  const { data, status } = readSession(safeSessionStorage())
  if (data) return initialState(data.doc, data.ui)
  return status === 'unreadable' ? initialState(undefined, { message: { title: 'Could not restore your work', text: UNREADABLE_SESSION_MESSAGE } }) : initialState()
}

type SaveStatus = 'ok' | 'failed' | 'unavailable'


/**
 * Enter, Delete and arrows act on the diagram only when focus is not on a control that handles them itself.
 * Focused diagram cells and table headers (SVG) are not such controls.
 */
function isControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || target instanceof SVGElement) return false
  return !!target.closest('button, a, [role="button"], dialog')
}

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, init)
  const measurer = useMemo(() => createCanvasMeasurer(), [])
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
  const { viewport, sidebarCollapsed, theme } = state.ui
  useEffect(() => {
    if (!storage) return
    const t = setTimeout(
      () => setSaveStatus(saveSession(storage, { doc, ui: { viewport, sidebarCollapsed, theme } }) ? 'ok' : 'failed'),
      SAVE_DEBOUNCE_MS,
    )
    return () => clearTimeout(t)
  }, [storage, doc, viewport, sidebarCollapsed, theme])

  // Appearance, as in Krash: no attribute follows the system; data-theme forces light or dark.
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])
  const nextTheme = ({ system: 'light', light: 'dark', dark: 'system' } as const)[theme]
  const themeLabel = { system: 'System appearance', light: 'Light appearance', dark: 'Dark appearance' }[theme]

  // Do not lose the last debounce window: save at once when the tab is hidden or the page goes away.
  useEffect(() => {
    if (!storage) return
    const flush = () => {
      const s = stateRef.current
      saveSession(storage, { doc: s.doc, ui: { viewport: s.ui.viewport, sidebarCollapsed: s.ui.sidebarCollapsed, theme: s.ui.theme } })
    }
    const onVisibility = () => document.visibilityState === 'hidden' && flush()
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [storage])

  const sayError = (text: string) => dispatch({ type: 'ui', patch: { message: { title: 'Could not copy', text } } })

  // Both copies start synchronously inside the click, so the browser sees a user gesture.
  const onCopyImage = () => {
    const scene = exportScene(stateRef.current.doc, measurer)
    if (!scene) return sayError(COPY_MESSAGES.empty)
    const scale = exportScale(scene.bounds)
    if (!scale) return sayError(COPY_MESSAGES.tooLarge)
    setCopying('image')
    void copyImage(browserEnv(), () => renderPng(scene, scale)).then((result) => {
      setCopying(null)
      if (result.ok) confirmCopied('image')
      else sayError(failureMessage('image', result.reason, result.detail))
    })
  }
  const onCopyData = () => {
    setCopying('data')
    void copyText(browserEnv(), serializeDocument(stateRef.current.doc)).then((result) => {
      setCopying(null)
      if (result.ok) confirmCopied('data')
      else sayError(failureMessage('data', result.reason, result.detail))
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
      // Selected form fields. (A focused field handles this itself; Safari and Firefox on macOS do not focus a clicked
      // button, so the key arrives here.)
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.ui.selectedFieldIds.length > 0) {
        e.preventDefault()
        dispatch({ type: 'command', command: { type: 'deleteSourceFields', fieldIds: s.ui.selectedFieldIds } })
        return
      }
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
    <>
      <a className="skip-link" href="#diagram-panel">
        Skip to diagram
      </a>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            k.
          </span>
          <div>
            <h1>Krijt</h1>
            <p>A little board for diagrams.</p>
          </div>
        </div>
        <button
          type="button"
          className="theme-control"
          onClick={() => dispatch({ type: 'ui', patch: { theme: nextTheme } })}
          aria-label={`${themeLabel}. Switch to ${nextTheme} appearance`}
          title={`${themeLabel}. Switch to ${nextTheme} appearance`}
        >
          <ThemeIcon choice={theme} />
        </button>
      </header>

      <main>
        <div className="workspace-heading">
          <p className="eyebrow">DIAGRAM WORKSPACE</p>
          {/* Saving is silent; only a failure is shown (unavailable storage is reported in the footer). */}
          {saveStatus === 'failed' && (
            <p className="save-state save-failed" role="alert">
              Your diagram could not be kept for reload
            </p>
          )}
        </div>

        <div className={`workspace${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
          <Sidebar state={state} dispatch={dispatch} canvasHandle={canvasHandle} onGhost={setGhost} />
          <section className="panel diagram-panel" id="diagram-panel" aria-labelledby="diagram-title">
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
            </div>
          </section>
        </div>
        <p className="workspace-motto">One form. One table at a time.</p>
      </main>

      <footer className="app-footer">
        <a href="https://github.com/hanze-hbo-ict/krijt">Krijt on GitHub</a>
        <span>Everything runs in your browser, and your diagram is kept only in this tab.</span>
        <span className="storage-warning" hidden={saveStatus !== 'unavailable'}>
          Session storage is unavailable: your diagram will be lost on reload.
        </span>
      </footer>

      {ghost && (
        <div className="drag-ghost" style={{ left: ghost.x + 14, top: ghost.y + 10 }} aria-hidden="true">
          {ghost.text}
        </div>
      )}

      {state.ui.message && (
        <ErrorDialog
          key={`${state.ui.message.title}\n${state.ui.message.text}`}
          message={state.ui.message}
          onClose={() => dispatch({ type: 'ui', patch: { message: null } })}
        />
      )}
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
              },
            })
          }
        />
      )}
    </>
  )
}
