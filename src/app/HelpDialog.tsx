/** Compact help: controls and notation only. No normalization theory, hints or solutions. */
import { useEffect, useRef } from 'react'
import { Icon } from '../components/Icon'
import { MOD_KEY } from './platform'

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
        <h3>Notation</h3>
        <table className="notation-table">
          <tbody>
            <tr>
              <td>
                <span className="notation-pk">naam</span>
              </td>
              <td>Primary key (several in one table form a composite key)</td>
            </tr>
            <tr>
              <td>
                naam<sup>o</sup>
              </td>
              <td>Nullable</td>
            </tr>
            <tr>
              <td>naam/</td>
              <td>Calculated</td>
            </tr>
            <tr>
              <td>
                naam/<sup>o</sup>
              </td>
              <td>Calculated and nullable</td>
            </tr>
          </tbody>
        </table>

        <h3>Form fields</h3>
        <ul>
          <li>Type a field and press <kbd>Enter</kbd>, or paste a list with one field per line.</li>
          <li>Click fields to select them (click again to deselect). No modifier keys are needed.</li>
          <li>
            <strong>Place in diagram</strong>, then click a table, a cell edge, or empty canvas for a new table. You can also drag fields onto
            the canvas. The form-field list itself never changes.
          </li>
        </ul>
        <h3>Attributes</h3>
        <ul>
          <li>
            <strong>Select</strong> selects one cell per click; <strong>Select several</strong> adds or removes a cell with every click.
          </li>
          <li>
            The bar above the diagram marks the selection as <strong>Primary key</strong>, <strong>Nullable</strong> or{' '}
            <strong>Calculated</strong>, renames (or double-click, or <kbd>Enter</kbd>), reorders (or <kbd>←</kbd> <kbd>→</kbd>) and deletes (or{' '}
            <kbd>Del</kbd>).
          </li>
          <li>
            <strong>Move</strong> / <strong>Copy</strong>: click the attributes, <strong>Next</strong> (<kbd>Enter</kbd>), then click a table,
            the left or right half of a cell, or empty canvas. <strong>Move to…</strong> / <strong>Copy to…</strong> do the same for the
            current selection. Dragging a cell moves it.
          </li>
          <li>A table that loses its last attribute is removed.</li>
        </ul>
        <h3>Tables</h3>
        <ul>
          <li>Click a table’s header band to select it. Tables need no name; use <strong>Name table</strong> to add or clear one.</li>
          <li>
            Move a table with <strong>Move table</strong> and a click, by dragging its header band, or with the arrow keys.
          </li>
          <li>Click <strong>+</strong> after the last attribute to type new attributes.</li>
        </ul>
        <h3>Undo and canvas</h3>
        <ul>
          <li>
            Undo <kbd>{MOD_KEY}+Z</kbd>, redo <kbd>{MOD_KEY}+Shift+Z</kbd>, also with the buttons at the top. <kbd>Esc</kbd> cancels the
            current step.
          </li>
          <li>Scroll to pan, pinch to zoom, or use the zoom buttons. The fit button shows the whole diagram.</li>
        </ul>
        <h3>Your work</h3>
        <p>
          Krijt keeps a copy of your work in this browser tab only, so a reload restores it. Closing the tab, a browser crash, another
          device or the exam environment can lose it. It is not a saved file. Undo history does not survive a reload.
        </p>
      </div>
    </dialog>
  )
}
