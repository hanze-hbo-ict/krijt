/** Confirmation for "Clear diagram". Clearing is one undo step, but undo history does not survive a reload. */
import { useEffect, useRef } from 'react'
import { Icon } from '../components/Icon'

interface Props {
  hasFields: boolean
  onClear: (keepFields: boolean) => void
  onClose: () => void
}

export function ClearDialog({ hasFields, onClear, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  const clear = (keepFields: boolean) => {
    onClear(keepFields)
    ref.current?.close()
  }
  return (
    <dialog ref={ref} className="help-dialog confirm-dialog" aria-labelledby="clear-title" aria-describedby="clear-text" onClose={onClose} onCancel={onClose}>
      <div className="dialog-header">
        <h2 id="clear-title">Clear the diagram?</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={() => ref.current?.close()}>
          <Icon name="close" />
        </button>
      </div>
      <div className="dialog-body">
        <p id="clear-text">
          This removes all tables and references. Undo brings them back until you reload the page; after that they are gone.
        </p>
        <div className="dialog-actions">
          <button type="button" autoFocus onClick={() => ref.current?.close()}>
            Cancel
          </button>
          {hasFields && (
            <button type="button" className="danger-quiet" onClick={() => clear(true)}>
              Clear diagram, keep form fields
            </button>
          )}
          <button type="button" className="danger" onClick={() => clear(false)}>
            {hasFields ? 'Clear everything' : 'Clear diagram'}
          </button>
        </div>
      </div>
    </dialog>
  )
}
