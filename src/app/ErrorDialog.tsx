/**
 * Errors are rare (a copy the browser refused, a session that could not be restored), so each one is a small modal
 * dialog in the style of the Clear dialog, not a bar over the diagram. A styled <dialog>, not window.alert: exam
 * browsers may suppress JavaScript dialogs, and alert() ignores the theme.
 */
import { useEffect, useRef } from 'react'
import { Icon } from '../components/Icon'
import type { Message } from '../state/appState'

interface Props {
  message: Message
  onClose: () => void
}

export function ErrorDialog({ message, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d || d.open) return
    d.showModal()
    // showModal focuses the first button (the header's ×); the safe default action should have focus instead.
    d.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [])
  const close = () => ref.current?.close()
  return (
    <dialog
      ref={ref}
      className="help-dialog confirm-dialog"
      role="alertdialog"
      aria-labelledby="error-title"
      aria-describedby="error-text"
      onClose={onClose}
      onCancel={onClose}
    >
      <div className="dialog-header">
        <h2 id="error-title">{message.title}</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={close}>
          <Icon name="close" />
        </button>
      </div>
      <div className="dialog-body">
        <p id="error-text">{message.text}</p>
        <div className="dialog-actions">
          <button type="button" className="primary" data-autofocus onClick={close}>
            OK
          </button>
        </div>
      </div>
    </dialog>
  )
}
