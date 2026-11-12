/**
 * The diagram toolbars. The tool strip (Select, Select several, Move, Copy) is
 * a column at the canvas edge; the context bar above the canvas shows either
 * the instruction for the active operation (with Next / Cancel) or the actions
 * for the current selection. Both keep a fixed size, so selecting something
 * never shifts the diagram under the pointer. Messages are shown by
 * MessageBanner over the canvas, for the same reason.
 */
import type { Dispatch, ReactNode } from 'react'
import type { AttributeFlag } from '../commands/commands'
import { Icon } from '../components/Icon'
import type { Attribute, KrijtDocument } from '../model/types'
import { SELECT, selectedAttributeIds, type Action, type AppState } from '../state/appState'
import { operationInstruction } from '../state/interaction'

interface Props {
  state: AppState
  dispatch: Dispatch<Action>
}

export function ToolStrip({ state, dispatch }: Props) {
  const { operation: op, multiSelect } = state.ui
  const tools: { id: string; label: string; icon: string; active: boolean; onClick: () => void; hint: string }[] = [
    {
      id: 'select',
      label: 'Select',
      icon: 'pointer',
      active: op.kind === 'select' && !multiSelect,
      hint: 'Click one cell or table at a time',
      onClick: () => dispatch({ type: 'ui', patch: { operation: SELECT, multiSelect: false, message: null } }),
    },
    {
      id: 'multi',
      label: 'Select several',
      icon: 'multi',
      active: op.kind === 'select' && multiSelect,
      hint: 'Each click adds or removes a cell',
      onClick: () => dispatch({ type: 'ui', patch: { operation: SELECT, multiSelect: true, message: null } }),
    },
    {
      id: 'move',
      label: 'Move',
      icon: 'move',
      active: op.kind === 'move',
      hint: 'Move attributes to another place or table',
      onClick: () => dispatch(op.kind === 'move' ? { type: 'cancel' } : { type: 'startAttributes', kind: 'move' }),
    },
    {
      id: 'copy',
      label: 'Copy',
      icon: 'copy',
      active: op.kind === 'copy',
      hint: 'Copy attributes; the originals stay',
      onClick: () => dispatch(op.kind === 'copy' ? { type: 'cancel' } : { type: 'startAttributes', kind: 'copy' }),
    },
  ]
  return (
    <div className="tool-strip" role="group" aria-label="Tools">
      {tools.map((t) => (
        <button key={t.id} type="button" className="tool" aria-pressed={t.active} title={t.hint} onClick={t.onClick}>
          <Icon name={t.icon} />
          <span className="tool-label">{t.label}</span>
        </button>
      ))}
    </div>
  )
}

const FLAGS: { flag: AttributeFlag; label: ReactNode; name: string }[] = [
  {
    flag: 'primaryKey',
    name: 'Primary key',
    label: <span className="notation-pk">Primary key</span>,
  },
  {
    flag: 'nullable',
    name: 'Nullable',
    label: (
      <>
        Nullable <span className="notation-sample">a<sup>o</sup></span>
      </>
    ),
  },
  {
    flag: 'calculated',
    name: 'Calculated',
    label: (
      <>
        Calculated <span className="notation-sample">a/</span>
      </>
    ),
  },
]

function findAttributes(doc: KrijtDocument, ids: string[]): { attribute: Attribute; relationName: string | null }[] {
  const out: { attribute: Attribute; relationName: string | null }[] = []
  const wanted = new Set(ids)
  for (const r of doc.relations) for (const a of r.attributes) if (wanted.has(a.id)) out.push({ attribute: a, relationName: r.name })
  return out
}

function AttributeActions({ state, dispatch }: Props) {
  const ids = selectedAttributeIds(state.ui)
  const found = findAttributes(state.doc, ids)
  if (found.length === 0) return null
  const single = found.length === 1 ? found[0]! : null
  return (
    <>
      <span className="selection-label">
        {single ? (
          <>
            <strong>{single.attribute.name}</strong> in {single.relationName ? <strong>{single.relationName}</strong> : 'unnamed table'}
          </>
        ) : (
          <strong>{found.length} attributes</strong>
        )}
      </span>
      {single && (
        <button
          type="button"
          onClick={() => dispatch({ type: 'ui', patch: { editing: { kind: 'attributeName', attributeId: single.attribute.id } } })}
        >
          <Icon name="pencil" />
          Rename
        </button>
      )}
      <span className="bar-group" role="group" aria-label="Notation">
        {FLAGS.map(({ flag, label, name }) => {
          const on = found.filter((f) => f.attribute[flag]).length
          const pressed = on === found.length ? true : on === 0 ? false : 'mixed'
          return (
            <button
              key={flag}
              type="button"
              className="flag-button"
              aria-pressed={pressed}
              aria-label={name}
              onClick={() => dispatch({ type: 'command', command: { type: 'setAttributeFlag', attributeIds: ids, flag, value: pressed !== true } })}
            >
              <span className="flag-check" aria-hidden="true">
                {pressed === true ? <Icon name="check" /> : pressed === 'mixed' ? <Icon name="minus" /> : null}
              </span>
              {label}
            </button>
          )
        })}
      </span>
      <span className="bar-group" role="group" aria-label="Order">
        <button
          type="button"
          className="icon-text"
          aria-label="Move left"
          title="Move left (←)"
          onClick={() => dispatch({ type: 'command', command: { type: 'shiftAttributes', attributeIds: ids, delta: -1 } })}
        >
          <Icon name="left" />
        </button>
        <button
          type="button"
          className="icon-text"
          aria-label="Move right"
          title="Move right (→)"
          onClick={() => dispatch({ type: 'command', command: { type: 'shiftAttributes', attributeIds: ids, delta: 1 } })}
        >
          <Icon name="right" />
        </button>
      </span>
      <button type="button" onClick={() => dispatch({ type: 'startAttributes', kind: 'move', fromSelection: true })}>
        <Icon name="move" />
        Move to…
      </button>
      <button type="button" onClick={() => dispatch({ type: 'startAttributes', kind: 'copy', fromSelection: true })}>
        <Icon name="copy" />
        Copy to…
      </button>
      <button
        type="button"
        className="danger-quiet"
        title="Delete (Del)"
        onClick={() => dispatch({ type: 'command', command: { type: 'deleteAttributes', attributeIds: ids } })}
      >
        <Icon name="trash" />
        Delete
      </button>
    </>
  )
}

function TableActions({ state, dispatch }: Props) {
  const sel = state.ui.selection
  if (sel.kind !== 'relation') return null
  const relation = state.doc.relations.find((r) => r.id === sel.relationId)
  if (!relation) return null
  return (
    <>
      <span className="selection-label">{relation.name ? <strong>{relation.name}</strong> : 'Unnamed table'}</span>
      <button type="button" onClick={() => dispatch({ type: 'ui', patch: { editing: { kind: 'relationName', relationId: relation.id } } })}>
        <Icon name="tag" />
        {relation.name ? 'Rename table' : 'Name table'}
      </button>
      <button type="button" onClick={() => dispatch({ type: 'ui', patch: { editing: { kind: 'newAttribute', relationId: relation.id } } })}>
        <Icon name="plus" />
        Add attribute
      </button>
      <button type="button" onClick={() => dispatch({ type: 'startMoveTable', relationId: relation.id })}>
        <Icon name="place" />
        Move table
      </button>
      <button
        type="button"
        onClick={() => dispatch({ type: 'ui', patch: { selection: { kind: 'attributes', attributeIds: relation.attributes.map((a) => a.id) } } })}
      >
        <Icon name="multi" />
        Select all attributes
      </button>
      {/* Undo restores a deleted table, so no confirmation is needed. */}
      <button type="button" className="danger-quiet" onClick={() => dispatch({ type: 'command', command: { type: 'deleteRelation', relationId: relation.id } })}>
        <Icon name="trash" />
        Delete table
      </button>
    </>
  )
}

const OP_BADGE: Record<string, string> = { place: 'Place', moveTable: 'Move table', move: 'Move', copy: 'Copy' }

export function ContextBar({ state, dispatch }: Props) {
  const { doc, ui } = state
  const op = ui.operation
  const instruction = operationInstruction(state)

  return (
    <div className="context-bar" data-operation={op.kind}>
      {instruction ? (
        <div className="bar-content operation" role="region" aria-label="Current operation">
          <span className="op-badge">
            {OP_BADGE[op.kind]}
            {(op.kind === 'move' || op.kind === 'copy') && <span className="op-step"> · {op.phase === 'selecting' ? 'step 1 of 2' : 'step 2 of 2'}</span>}
          </span>
          <span className="instruction" aria-live="polite">
            {instruction}
          </span>
          {(op.kind === 'move' || op.kind === 'copy') && op.phase === 'selecting' && (
            <button type="button" className="primary" onClick={() => dispatch({ type: 'next' })} disabled={selectedAttributeIds(ui).length === 0}>
              Next: choose destination <kbd>Enter</kbd>
            </button>
          )}
          <button type="button" className="cancel-button" onClick={() => dispatch({ type: 'cancel' })}>
            Cancel <kbd>Esc</kbd>
          </button>
        </div>
      ) : (
        <div className="bar-content" role="toolbar" aria-label="Selection actions">
          {ui.selection.kind === 'attributes' ? (
            <AttributeActions state={state} dispatch={dispatch} />
          ) : ui.selection.kind === 'relation' ? (
            <TableActions state={state} dispatch={dispatch} />
          ) : (
            <span className="hint">
              {doc.relations.length === 0
                ? 'No tables yet.'
                : ui.multiSelect
                  ? 'Click cells to add them to the selection.'
                  : 'Click a table’s header or an attribute to select it.'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/** Errors and notices, over the top of the canvas so they never move the diagram. */
export function MessageBanner({ state, dispatch }: Props) {
  const message = state.ui.message
  return (
    <div className="message-slot" aria-live="polite">
      {message && (
        <div className={`bar-message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
          <span>{message.text}</span>
          <button type="button" className="icon-button" aria-label="Dismiss message" onClick={() => dispatch({ type: 'ui', patch: { message: null } })}>
            <Icon name="close" />
          </button>
        </div>
      )}
    </div>
  )
}
