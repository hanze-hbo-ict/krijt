/** Compact help: controls only. No normalization theory, hints or solutions. */
import { useEffect, useRef } from 'react'
import { Icon } from '../components/Icon'

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  return (
    <dialog ref={ref} className="help-dialog" aria-labelledby="help-title" onClose={onClose} onCancel={onClose}>
      <div className="dialog-header">
        <h2 id="help-title">Using Krijt</h2>
        <button type="button" className="icon-button" aria-label="Close help" onClick={() => ref.current?.close()}>
          <Icon name="close" />
        </button>
      </div>
      <div className="dialog-body">
        <h3>Form fields</h3>
        <ul>
          <li>Type a field and press <kbd>Enter</kbd>, or paste a list with one field per line.</li>
          <li>Click fields to select them (click again to deselect). No modifier keys are needed.</li>
          <li>
            <strong>Place in diagram</strong>, then click a table to add the fields, or empty canvas for a new table. The form-field list
            itself never changes.
          </li>
        </ul>
        <h3>Tables</h3>
        <ul>
          <li>Click a table’s header band to select it. Tables need no name; use <strong>Name table</strong> to add or clear one.</li>
          <li>
            Move a table with <strong>Move table</strong> and a click, by dragging its header band, or with the arrow keys.
          </li>
          <li>Click <strong>+</strong> after the last attribute to type new attributes; <kbd>Enter</kbd> adds one and keeps typing.</li>
          <li>
            <kbd>Esc</kbd> cancels the current operation or clears the selection.
          </li>
        </ul>
        <h3>Canvas</h3>
        <ul>
          <li>Scroll to pan, pinch to zoom, or use the zoom buttons. <strong>Fit</strong> shows the whole diagram.</li>
        </ul>
        <h3>Your work</h3>
        <p>
          Krijt keeps a copy of your work in this browser tab only, so a reload restores it. Closing the tab, a browser crash, another
          device or the exam environment can lose it. It is not a saved file.
        </p>
      </div>
    </dialog>
  )
}
