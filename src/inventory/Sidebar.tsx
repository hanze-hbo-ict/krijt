/**
 * Form-field inventory. Just a list: no used/unused tracking, no checklist.
 * Fields are selected with plain clicks (no modifier keys) and placed into the
 * diagram as independent copies; placing never removes a field.
 */
import { useState, type ClipboardEvent, type Dispatch } from 'react'
import { addSourceFields, parseFieldList } from '../commands/builders'
import { Icon } from '../components/Icon'
import { InlineInput } from '../components/InlineInput'
import type { SourceField } from '../model/types'
import { MAX_TEXT_LENGTH } from '../model/validate'
import type { Action, AppState } from '../state/appState'

interface Props {
  state: AppState
  dispatch: Dispatch<Action>
}

export function Sidebar({ state, dispatch }: Props) {
  const { doc, ui } = state
  const [entry, setEntry] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [listText, setListText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const selected = new Set(ui.selectedFieldIds)
  const placing = ui.operation.kind === 'place'
  const count = ui.selectedFieldIds.length

  const add = (labels: string[]) => {
    const command = addSourceFields(labels)
    if (command) dispatch({ type: 'command', command })
  }

  const onEntryPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text/plain')
    if (!/[\r\n]/.test(text)) return
    // A multi-line paste adds one field per line.
    e.preventDefault()
    add(parseFieldList(text))
  }

  return (
    <aside className="panel sidebar" aria-labelledby="fields-title">
      <div className="panel-header">
        <div>
          <h2 id="fields-title">Form fields</h2>
          <p className="panel-subtitle" lang="nl">
            Formuliervelden
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-expanded={listOpen}
          aria-controls="paste-list"
          data-tooltip="Paste a list"
          data-tooltip-pos="end"
          aria-label="Paste a list of fields"
          onClick={() => setListOpen((o) => !o)}
        >
          <Icon name="list" />
        </button>
      </div>

      <form
        className="field-entry"
        onSubmit={(e) => {
          e.preventDefault()
          if (entry.trim() === '') return
          add([entry])
          setEntry('')
        }}
      >
        <input
          aria-label="New field"
          placeholder="Add a field…"
          value={entry}
          maxLength={MAX_TEXT_LENGTH}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setEntry(e.target.value)}
          onPaste={onEntryPaste}
        />
        <button type="submit" disabled={entry.trim() === ''}>
          Add
        </button>
      </form>

      {listOpen && (
        <div className="paste-list" id="paste-list">
          <label htmlFor="paste-list-text">One field per line</label>
          <textarea
            id="paste-list-text"
            rows={6}
            value={listText}
            spellCheck={false}
            onChange={(e) => setListText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setListOpen(false)
              }
            }}
          />
          <div className="paste-list-actions">
            <button type="button" className="link-button" onClick={() => setListOpen(false)}>
              Close
            </button>
            <button
              type="button"
              className="primary"
              disabled={parseFieldList(listText).length === 0}
              onClick={() => {
                add(parseFieldList(listText))
                setListText('')
                setListOpen(false)
              }}
            >
              Add {parseFieldList(listText).length || ''} fields
            </button>
          </div>
        </div>
      )}

      <div className="sidebar-body">
        {doc.sourceFields.length === 0 ? (
          <p className="empty-note">Type the fields of the original form, or paste a list with one field per line.</p>
        ) : (
          <ul className="field-list" aria-label="Form fields">
            {doc.sourceFields.map((f) => (
              <FieldRow
                key={f.id}
                field={f}
                selected={selected.has(f.id)}
                editing={editingId === f.id}
                onToggle={() => dispatch({ type: 'toggleField', fieldId: f.id })}
                onEdit={() => setEditingId(f.id)}
                onRename={(label) => {
                  setEditingId(null)
                  if (label.trim() !== '' && label !== f.label)
                    dispatch({ type: 'command', command: { type: 'renameSourceField', fieldId: f.id, label } })
                }}
                onCancelEdit={() => setEditingId(null)}
                onDelete={() => dispatch({ type: 'command', command: { type: 'deleteSourceField', fieldId: f.id } })}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="sidebar-footer">
        <span className="selection-count" aria-live="polite">
          {count === 0 ? 'No fields selected' : `${count} selected`}
        </span>
        {count > 0 && (
          <button type="button" className="link-button" onClick={() => dispatch({ type: 'ui', patch: { selectedFieldIds: [] } })}>
            Clear
          </button>
        )}
        <button
          type="button"
          className="primary place-button"
          aria-pressed={placing}
          disabled={doc.sourceFields.length === 0}
          onClick={() => dispatch(placing ? { type: 'cancel' } : { type: 'startPlace' })}
        >
          <Icon name="place" />
          {placing ? 'Placing…' : 'Place in diagram'}
        </button>
      </div>
    </aside>
  )
}

interface RowProps {
  field: SourceField
  selected: boolean
  editing: boolean
  onToggle: () => void
  onEdit: () => void
  onRename: (label: string) => void
  onCancelEdit: () => void
  onDelete: () => void
}

function FieldRow({ field, selected, editing, onToggle, onEdit, onRename, onCancelEdit, onDelete }: RowProps) {
  if (editing) {
    return (
      <li className="field-row editing">
        <InlineInput
          className="field-edit"
          initial={field.label}
          label={`Rename field ${field.label}`}
          onCommit={onRename}
          onCancel={onCancelEdit}
        />
      </li>
    )
  }
  return (
    <li className="field-row" data-selected={selected || undefined}>
      <button type="button" className="field-toggle" aria-pressed={selected} onClick={onToggle} onDoubleClick={onEdit}>
        <span className="checkmark" aria-hidden="true">
          {selected && <Icon name="check" />}
        </span>
        <span className="field-label">{field.label}</span>
      </button>
      <button type="button" className="icon-button row-action" aria-label={`Rename ${field.label}`} onClick={onEdit}>
        <Icon name="pencil" />
      </button>
      <button type="button" className="icon-button row-action" aria-label={`Remove ${field.label}`} onClick={onDelete}>
        <Icon name="trash" />
      </button>
    </li>
  )
}
