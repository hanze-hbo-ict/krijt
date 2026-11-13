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
            <tr>
              <td>a → b</td>
              <td>Reference: the arrow points from the foreign key to the attribute it refers to</td>
            </tr>
            <tr>
              <td>{'{ } → { }'}</td>
              <td>Composite reference: a brace groups each end; the attributes pair up left to right</td>
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
            Click a cell to select it. The toolbar next to the selection marks it as <strong>Primary key</strong>, <strong>Nullable</strong>{' '}
            or <strong>Calculated</strong>, renames (or double-click, or <kbd>Enter</kbd>), reorders (or <kbd>←</kbd> <kbd>→</kbd>) and deletes
            (or <kbd>Del</kbd>). Hover a button to see what it does.
          </li>
          <li>
            <strong>Add to selection</strong>: every click adds or removes a cell of the same table (<kbd>Shift</kbd>-click does this too).{' '}
          </li>
          <li>
            <strong>Move</strong> / <strong>Copy</strong>, then click a table, the left or right half of a cell, or empty canvas; the
            canvas shows where they will go. Click the pressed button again (or <kbd>Esc</kbd>) to cancel. Dragging a cell moves it.
          </li>
          <li>A table that loses its last attribute is removed.</li>
        </ul>
        <h3>References</h3>
        <ul>
          <li>
            Select the foreign-key attribute (or several, side by side), then <strong>Reference</strong> and click the attribute it
            refers to. For several, hovering a cell shows the block of side-by-side attributes it would pick, starting there; one click creates
            the reference.
          </li>
          <li>
            The attributes pair up left to right, as the numbers on the cells show; put them in the right order first with{' '}
            <kbd>←</kbd> <kbd>→</kbd>. Click the pressed button again (or <kbd>Esc</kbd>) to cancel.
          </li>
          <li>
            Click a connector to select it, then <strong>Delete reference</strong> (or <kbd>Del</kbd>). Deleting an attribute or table also
            deletes the references that use it; undo brings both back.
          </li>
          <li>
            Each end of a reference is one unit. <kbd>←</kbd> <kbd>→</kbd> on part of an end reorder it (and so the pairing); on the whole end,
            or at its edge, they move the block. Moving one of its attributes brings the others along, and nothing is inserted between
            them. Connectors follow their cells.
          </li>
        </ul>
        <h3>Tables</h3>
        <ul>
          <li>Click a table’s header band to select it. Tables need no name; use <strong>Name table</strong> to add or clear one.</li>
          <li>
            Copy a table with <strong>Copy table</strong> and a click (the copy has no name). Move a table with <strong>Move table</strong> and a click (an outline shows where), by dragging its header band, or with the
            arrow keys.
          </li>
          <li>Click <strong>+</strong> after the last attribute to type new attributes.</li>
          <li>
            Names may contain letters (any language), digits, dashes and underscores. A space becomes an underscore; form fields are converted
            when placed (“Datum (dd-mm)” becomes “Datum_dd-mm”).
          </li>
        </ul>
        <h3>Undo and canvas</h3>
        <ul>
          <li>
            Undo <kbd>{MOD_KEY}+Z</kbd>, redo <kbd>{MOD_KEY}+Shift+Z</kbd>, also with the buttons above the diagram. <kbd>Esc</kbd> cancels
            the current step.
          </li>
          <li>
            Scroll to pan, pinch to zoom, or use the zoom buttons. The fit button shows the whole diagram; <kbd>{MOD_KEY}+0</kbd> resets the
            zoom.
          </li>
        </ul>
        <h3>Handing in</h3>
        <ul>
          <li>
            <strong>Copy as image</strong> puts the diagram on the clipboard as a picture: only the tables, notation and references, on white.
            Paste it into your answer and check that it arrived; Krijt only reports success when the browser confirms the copy.
          </li>
          <li>
            <strong>Copy as text</strong> copies the diagram as plain text: each table's name (unnamed ones as #1, #2, …) with its columns indented below,
            with *keys* in asterisks, / for calculated, ° for nullable, and references written as “klantnr → Klant.klantnr”.
            Use it when text answers are allowed. Krijt cannot load it back.
          </li>
          <li>Krijt never downloads or uploads files.</li>
        </ul>
        <h3>Your work</h3>
        <p>
          Krijt keeps a copy of your work in this browser tab only, so a reload restores it. Closing the tab, a browser crash, another
          device or the exam environment can lose it. It is not a saved file. Undo history does not survive a reload.{' '}
          <strong>Clear diagram</strong> starts an empty diagram (undo brings the old one back until you reload).
        </p>
      </div>
    </dialog>
  )
}
