/**
 * The diagram panel's header, in the style of the sidebar's: the title, then
 * the document and view actions as icon buttons (undo/redo, zoom, copy, clear).
 * Operations show no instructions here: the pressed button next to the
 * selection and the canvas previews show what a click will do; a hidden live
 * region announces them for screen readers.
 */
import type { Dispatch } from 'react'
import { Icon } from '../components/Icon'
import type { Action, AppState } from '../state/appState'
import { operationAnnouncement } from '../state/interaction'
import { IS_MAC } from './platform'

interface Props {
  state: AppState
  dispatch: Dispatch<Action>
  copying: 'image' | 'data' | null
  /** The copy that just succeeded: its button shows a checkmark for a moment. */
  copied: 'image' | 'data' | null
  onCopyImage: () => void
  onCopyData: () => void
  onClear: () => void
  onZoomOut: () => void
  onZoomIn: () => void
  onFit: () => void
}

export function DiagramHeader({ state, dispatch, copying, copied, onCopyImage, onCopyData, onClear, onZoomOut, onZoomIn, onFit }: Props) {
  const { doc, history } = state
  const empty = doc.relations.length === 0
  return (
    <div className="panel-header diagram-header">
      <h2 id="diagram-title">Diagram</h2>
      {/* For screen readers only: the active operation, or a copy that just succeeded (shown as a checkmark). */}
      <span className="visually-hidden" aria-live="polite">
        {copied === 'image' ? 'Image copied' : copied === 'data' ? 'Diagram copied as text' : operationAnnouncement(state)}
      </span>
      <div className="diagram-actions">
        <div className="header-group" role="group" aria-label="History">
          <button
            type="button"
            className="icon-button"
            aria-label="Undo"
            aria-keyshortcuts={IS_MAC ? 'Meta+Z' : 'Control+Z'}
            data-tooltip="Undo"
            disabled={history.past.length === 0}
            onClick={() => dispatch({ type: 'undo' })}
          >
            <Icon name="undo" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Redo"
            aria-keyshortcuts={IS_MAC ? 'Meta+Shift+Z' : 'Control+Shift+Z'}
            data-tooltip="Redo"
            disabled={history.future.length === 0}
            onClick={() => dispatch({ type: 'redo' })}
          >
            <Icon name="redo" />
          </button>
        </div>
        <span className="header-separator" aria-hidden="true" />
        <div className="header-group" role="group" aria-label="Zoom">
          <button type="button" className="icon-button" aria-label="Zoom out" data-tooltip="Zoom out" onClick={onZoomOut}>
            <Icon name="minus" />
          </button>
          <button type="button" className="icon-button" aria-label="Zoom in" data-tooltip="Zoom in" onClick={onZoomIn}>
            <Icon name="plus" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Fit diagram"
            data-tooltip="Fit diagram"
            onClick={onFit}
          >
            <Icon name="fit" />
          </button>
        </div>
        <span className="header-separator" aria-hidden="true" />
        <div className="header-group" role="group" aria-label="Copy for your answer">
          <button
            type="button"
            className="icon-button"
            aria-label="Copy as text"
            aria-busy={copying === 'data'}
            onClick={onCopyData}
            disabled={copying !== null || empty}
            data-tooltip={copied === 'data' ? 'Copied' : 'Copy as text'}
            data-tooltip-pos="end"
          >
            <Icon name={copied === 'data' ? 'check' : 'copy'} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Copy as image"
            aria-busy={copying === 'image'}
            onClick={onCopyImage}
            disabled={copying !== null || empty}
            data-tooltip={copied === 'image' ? 'Copied' : 'Copy as image'}
            data-tooltip-pos="end"
          >
            <Icon name={copied === 'image' ? 'check' : 'image'} />
          </button>
        </div>
        <span className="header-separator" aria-hidden="true" />
        <button
          type="button"
          className="icon-button"
          aria-label="Clear diagram"
          data-tooltip="Clear diagram"
          data-tooltip-pos="end"
          onClick={onClear}
          disabled={empty && doc.sourceFields.length === 0}
        >
          <Icon name="clear" />
        </button>
      </div>
    </div>
  )
}
