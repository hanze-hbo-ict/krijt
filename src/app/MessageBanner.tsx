/**
 * Errors, over the top of the canvas so they never move the diagram. (Successful actions show in the diagram itself.)
 */
import type { Dispatch } from 'react'
import { Icon } from '../components/Icon'
import type { Action, AppState } from '../state/appState'

export function MessageBanner({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const message = state.ui.message
  return (
    <div className="message-slot" aria-live="polite">
      {message && (
        <div className="bar-message error" role="alert">
          <span>{message.text}</span>
          <button type="button" className="icon-button" aria-label="Dismiss message" onClick={() => dispatch({ type: 'ui', patch: { message: null } })}>
            <Icon name="close" />
          </button>
        </div>
      )}
    </div>
  )
}
