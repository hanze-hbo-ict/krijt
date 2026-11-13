/**
 * The context toolbar: icon-only actions for the current selection, floating
 * just above the selected table or cells, or beside a selected reference's
 * line (flipped when there is no room). Every button keeps its accessible name
 * and a tooltip.
 *
 * The operations it starts (Move, Copy, Reference, Move table, Copy table)
 * keep it in place with their button pressed; pressing it again cancels, as
 * Escape does. Its other buttons are unavailable meanwhile.
 */
import { useLayoutEffect, useRef, type Dispatch, type ReactNode } from 'react'
import { isContiguous, type AttributeFlag } from '../commands/commands'
import { Icon } from '../components/Icon'
import type { Attribute, KrijtDocument } from '../model/types'
import { selectedAttributeIds, type Action, type AppState } from '../state/appState'

/** A screen rectangle, relative to the canvas. */
export type ScreenRect = { left: number; top: number; width: number; height: number }

/** What the toolbar attaches to, and on which side it prefers to sit (flipping to the opposite side if needed). */
export type ToolbarAnchor = { rect: ScreenRect; side: 'above' | 'right' }

interface Props {
  state: AppState
  dispatch: Dispatch<Action>
  anchor: ToolbarAnchor
  /** The canvas size, to keep the toolbar inside it. */
  bounds: { width: number; height: number }
}

/** Space between the toolbar and the item, and between the toolbar and the canvas edge. */
const GAP = 8
const EDGE = 6

export function SelectionToolbar({ state, dispatch, anchor, bounds }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // Position after render, once the toolbar's own size is known.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const { rect } = anchor
    const clamp = (v: number, size: number, room: number) => Math.max(EDGE, Math.min(v, room - size - EDGE))
    let left: number
    let top: number
    let place: string
    if (anchor.side === 'above') {
      // Start at the selection's left edge, not its centre: marking a key widens the cell (bold), and the bar must
      // not move under the pointer when that happens.
      left = clamp(rect.left, w, bounds.width)
      const above = rect.top - GAP - h
      const below = rect.top + rect.height + GAP
      place = above >= EDGE || below + h > bounds.height - EDGE ? 'above' : 'below'
      top = place === 'above' ? Math.max(EDGE, above) : below
    } else {
      top = clamp(rect.top + rect.height / 2 - h / 2, h, bounds.height)
      const right = rect.left + rect.width + GAP
      const leftSide = rect.left - GAP - w
      place = right + w <= bounds.width - EDGE || leftSide < EDGE ? 'right' : 'left'
      left = place === 'right' ? clamp(right, w, bounds.width) : leftSide
    }
    el.style.left = `${Math.round(left)}px`
    el.style.top = `${Math.round(top)}px`
    el.dataset.place = place
    el.style.visibility = 'visible'
  })

  const kind = state.ui.selection.kind
  const content =
    kind === 'attributes' ? (
      <AttributeActions state={state} dispatch={dispatch} />
    ) : kind === 'relation' ? (
      <TableActions state={state} dispatch={dispatch} />
    ) : kind === 'reference' ? (
      <ReferenceActions state={state} dispatch={dispatch} />
    ) : null
  if (!content) return null

  return (
    <div
      ref={ref}
      className="selection-toolbar"
      role="toolbar"
      aria-label="Selection actions"
      style={{ visibility: 'hidden' }}
    >
      {content}
    </div>
  )
}

type ActionProps = Omit<Props, 'anchor' | 'bounds'>

export function ToolButton({
  label,
  tooltip,
  onClick,
  children,
  pressed,
  danger,
  disabled,
  operation,
}: {
  label: string
  tooltip?: string
  onClick: () => void
  children: ReactNode
  pressed?: boolean | 'mixed'
  danger?: boolean
  disabled?: boolean
  /** Starts an operation: while it runs, the button is pressed and cancels it. */
  operation?: boolean
}) {
  return (
    <button
      type="button"
      className={`toolbar-button${danger ? ' danger-quiet' : ''}${operation ? ' operation' : ''}`}
      aria-label={label}
      aria-pressed={pressed}
      data-tooltip={tooltip ?? label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export const Separator = () => <span className="toolbar-separator" aria-hidden="true" />

/**
 * The flags are shown in the diagram's own notation, so the button looks like what it does. The "a" is centred in
 * every button; the slash and the superscript o hang off its sides, so the three a's line up.
 */
const FLAGS: { flag: AttributeFlag; name: string; glyph: ReactNode }[] = [
  { flag: 'primaryKey', name: 'Primary key', glyph: <span className="glyph notation-pk">a</span> },
  {
    flag: 'optional',
    name: 'Optional',
    glyph: (
      <span className="glyph">
        a<sup className="glyph-after">o</sup>
      </span>
    ),
  },
  { flag: 'calculated', name: 'Calculated', glyph: (
      <span className="glyph">
        <span className="glyph-before">/</span>a
      </span>
    ),
  },
]

function findAttributes(doc: KrijtDocument, ids: string[]): Attribute[] {
  const wanted = new Set(ids)
  return doc.relations.flatMap((r) => r.attributes.filter((a) => wanted.has(a.id)))
}

function AttributeActions({ state, dispatch }: ActionProps) {
  const ids = selectedAttributeIds(state.ui)
  const found = findAttributes(state.doc, ids)
  if (found.length === 0) return null
  const single = found.length === 1 ? found[0]! : null
  const adjacent = isContiguous(state.doc, ids)
  const op = state.ui.operation.kind
  const busy = op !== 'select'
  // An operation button toggles: pressed while its operation runs, and pressing it again cancels.
  const operation = (kind: 'move' | 'copy' | 'reference', start: Action) => ({
    operation: true,
    pressed: op === kind,
    disabled: busy && op !== kind,
    onClick: () => dispatch(op === kind ? { type: 'cancel' } : start),
  })
  return (
    <>
      <ToolButton
        label="Add to selection"
        tooltip="Add to selection: clicks add or remove cells"
        pressed={state.ui.multiSelect}
        disabled={busy}
        onClick={() => dispatch({ type: 'ui', patch: { multiSelect: !state.ui.multiSelect } })}
      >
        <Icon name="selectMore" />
      </ToolButton>
      <Separator />
      {single && (
        <ToolButton
          disabled={busy}
          label="Rename"
          onClick={() => dispatch({ type: 'ui', patch: { editing: { kind: 'attributeName', attributeId: single.id } } })}
        >
          <Icon name="pencil" />
        </ToolButton>
      )}
      <span className="toolbar-group" role="group" aria-label="Notation">
        {FLAGS.map(({ flag, name, glyph }) => {
          const on = found.filter((a) => a[flag]).length
          const pressed = on === found.length ? true : on === 0 ? false : 'mixed'
          return (
            <ToolButton
              key={flag}
              label={name}
              pressed={pressed}
              disabled={busy}
              onClick={() => dispatch({ type: 'command', command: { type: 'setAttributeFlag', attributeIds: ids, flag, value: pressed !== true } })}
            >
              {glyph}
            </ToolButton>
          )
        })}
      </span>
      <Separator />
      <span className="toolbar-group" role="group" aria-label="Order">
        <ToolButton
          disabled={busy}
          label="Move left"
          onClick={() => dispatch({ type: 'command', command: { type: 'shiftAttributes', attributeIds: ids, delta: -1 } })}
        >
          <Icon name="left" />
        </ToolButton>
        <ToolButton
          disabled={busy}
          label="Move right"
          onClick={() => dispatch({ type: 'command', command: { type: 'shiftAttributes', attributeIds: ids, delta: 1 } })}
        >
          <Icon name="right" />
        </ToolButton>
      </span>
      <Separator />
      <ToolButton label="Move" {...operation('move', { type: 'startAttributes', kind: 'move' })}>
        <Icon name="move" />
      </ToolButton>
      <ToolButton label="Copy" {...operation('copy', { type: 'startAttributes', kind: 'copy' })}>
        <Icon name="copy" />
      </ToolButton>
      <ToolButton
        label="Reference"
        {...operation('reference', { type: 'startReference' })}
        // A reference end is side by side in its table: offer it only for such a selection.
        disabled={(busy && op !== 'reference') || !adjacent}
      >
        <Icon name="reference" />
      </ToolButton>
      <Separator />
      <ToolButton
        label="Delete"
        danger
        disabled={busy}
        onClick={() => dispatch({ type: 'command', command: { type: 'deleteAttributes', attributeIds: ids } })}
      >
        <Icon name="trash" />
      </ToolButton>
    </>
  )
}

function TableActions({ state, dispatch }: ActionProps) {
  const sel = state.ui.selection
  if (sel.kind !== 'relation') return null
  const relation = state.doc.relations.find((r) => r.id === sel.relationId)
  if (!relation) return null
  const op = state.ui.operation.kind
  const busy = op !== 'select'
  const tableOperation = (kind: 'moveTable' | 'copyTable') => ({
    operation: true,
    pressed: op === kind,
    disabled: busy && op !== kind,
    onClick: () =>
      dispatch(op === kind ? { type: 'cancel' } : { type: kind === 'moveTable' ? 'startMoveTable' : 'startCopyTable', relationId: relation.id }),
  })
  return (
    <>
      <ToolButton
        disabled={busy}
        label={relation.name ? 'Rename table' : 'Name table'}
        onClick={() => dispatch({ type: 'ui', patch: { editing: { kind: 'relationName', relationId: relation.id } } })}
      >
        <Icon name="tag" />
      </ToolButton>
      <ToolButton label="Add attribute" disabled={busy} onClick={() => dispatch({ type: 'ui', patch: { editing: { kind: 'newAttribute', relationId: relation.id } } })}>
        <Icon name="plus" />
      </ToolButton>
      <ToolButton label="Move table" {...tableOperation('moveTable')}>
        <Icon name="move" />
      </ToolButton>
      <ToolButton label="Copy table" {...tableOperation('copyTable')}>
        <Icon name="copy" />
      </ToolButton>
      <Separator />
      {/* Undo restores a deleted table, so no confirmation is needed. */}
      <ToolButton label="Delete table" danger disabled={busy} onClick={() => dispatch({ type: 'command', command: { type: 'deleteRelation', relationId: relation.id } })}>
        <Icon name="trash" />
      </ToolButton>
    </>
  )
}

function ReferenceActions({ state, dispatch }: ActionProps) {
  const sel = state.ui.selection
  if (sel.kind !== 'reference') return null
  const ref = state.doc.references.find((r) => r.id === sel.referenceId)
  if (!ref) return null
  return (
    <ToolButton
      label="Delete reference"
      danger
      onClick={() => dispatch({ type: 'command', command: { type: 'deleteReference', referenceId: ref.id } })}
    >
      <Icon name="trash" />
    </ToolButton>
  )
}
