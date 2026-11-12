/**
 * Application state: the document (single source of truth) plus UI state.
 *
 * UI state is an explicit state machine: one normal `select` operation and
 * one-shot operations that return to `select` when they complete or are
 * cancelled. Cancelling changes UI state only, never the document.
 *
 * The reducer is pure. Anything that needs fresh IDs (building commands) is
 * resolved before dispatch, in interaction.ts.
 */
import { applyCommand, type Command } from '../commands/commands'
import type { Id, KrijtDocument } from '../model/types'
import { emptyDocument } from '../model/types'
import { DEFAULT_VIEWPORT, type Viewport } from '../geometry/viewport'

export type Selection =
  | { kind: 'none' }
  | { kind: 'relation'; relationId: Id }
  | { kind: 'attribute'; relationId: Id; attributeId: Id }

export type Operation =
  | { kind: 'select' }
  /** Copy the selected source fields into a table or onto empty canvas. */
  | { kind: 'place' }
  /** Click-based table movement: the next click on the canvas is the new position. */
  | { kind: 'moveTable'; relationId: Id }

export type Editing = null | { kind: 'relationName'; relationId: Id } | { kind: 'newAttribute'; relationId: Id }

export type Message = { kind: 'error' | 'info'; text: string }

export type UiState = {
  operation: Operation
  selection: Selection
  /** Selected source fields, in click order (placement uses inventory order). */
  selectedFieldIds: Id[]
  editing: Editing
  viewport: Viewport
  sidebarWidth: number
  message: Message | null
}

export type AppState = { doc: KrijtDocument; ui: UiState }

export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 480
export const SIDEBAR_DEFAULT = 280

export const NO_SELECTION: Selection = { kind: 'none' }
export const SELECT: Operation = { kind: 'select' }

export function initialUi(): UiState {
  return {
    operation: SELECT,
    selection: NO_SELECTION,
    selectedFieldIds: [],
    editing: null,
    viewport: DEFAULT_VIEWPORT,
    sidebarWidth: SIDEBAR_DEFAULT,
    message: null,
  }
}

export function initialState(doc: KrijtDocument = emptyDocument(), ui: Partial<UiState> = {}): AppState {
  return { doc, ui: { ...initialUi(), ...ui } }
}

export type Action =
  /** Apply a document command; on success also apply `after` to the UI state. */
  | { type: 'command'; command: Command; after?: Partial<UiState> }
  | { type: 'ui'; patch: Partial<UiState> }
  | { type: 'toggleField'; fieldId: Id }
  | { type: 'startPlace' }
  | { type: 'startMoveTable'; relationId: Id }
  /** Escape / Cancel: end the operation; in plain select mode, clear selection. */
  | { type: 'cancel' }

export const clampSidebar = (w: number) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)))

/** Drops UI references to things the document no longer has. */
export function reconcileUi(doc: KrijtDocument, ui: UiState): UiState {
  const relationIds = new Set(doc.relations.map((r) => r.id))
  const fieldIds = new Set(doc.sourceFields.map((f) => f.id))
  let { selection, operation, editing } = ui
  if (selection.kind === 'relation' && !relationIds.has(selection.relationId)) selection = NO_SELECTION
  if (selection.kind === 'attribute') {
    const { relationId, attributeId } = selection
    const r = doc.relations.find((x) => x.id === relationId)
    if (!r || !r.attributes.some((a) => a.id === attributeId)) selection = NO_SELECTION
  }
  if (operation.kind === 'moveTable' && !relationIds.has(operation.relationId)) operation = SELECT
  if (editing && !relationIds.has(editing.relationId)) editing = null
  const selectedFieldIds = ui.selectedFieldIds.filter((id) => fieldIds.has(id))
  const same =
    selection === ui.selection &&
    operation === ui.operation &&
    editing === ui.editing &&
    selectedFieldIds.length === ui.selectedFieldIds.length
  return same ? ui : { ...ui, selection, operation, editing, selectedFieldIds }
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'command': {
      const result = applyCommand(state.doc, action.command)
      if (!result.ok) return { ...state, ui: { ...state.ui, message: { kind: 'error', text: result.error } } }
      const ui = reconcileUi(result.doc, { ...state.ui, message: null, ...action.after })
      return { doc: result.doc, ui }
    }
    case 'ui': {
      const patch = { ...action.patch }
      if (patch.sidebarWidth !== undefined) patch.sidebarWidth = clampSidebar(patch.sidebarWidth)
      return { ...state, ui: reconcileUi(state.doc, { ...state.ui, ...patch }) }
    }
    case 'toggleField': {
      if (!state.doc.sourceFields.some((f) => f.id === action.fieldId)) return state
      const ids = state.ui.selectedFieldIds
      const selectedFieldIds = ids.includes(action.fieldId) ? ids.filter((id) => id !== action.fieldId) : [...ids, action.fieldId]
      return { ...state, ui: { ...state.ui, selectedFieldIds, message: null } }
    }
    case 'startPlace':
      return { ...state, ui: { ...state.ui, operation: { kind: 'place' }, editing: null, message: null } }
    case 'startMoveTable':
      if (!state.doc.relations.some((r) => r.id === action.relationId)) return state
      return {
        ...state,
        ui: {
          ...state.ui,
          operation: { kind: 'moveTable', relationId: action.relationId },
          selection: { kind: 'relation', relationId: action.relationId },
          editing: null,
          message: null,
        },
      }
    case 'cancel': {
      const ui = state.ui
      if (ui.editing) return { ...state, ui: { ...ui, editing: null } }
      if (ui.operation.kind !== 'select') return { ...state, ui: { ...ui, operation: SELECT, message: null } }
      if (ui.message) return { ...state, ui: { ...ui, message: null } }
      return { ...state, ui: { ...ui, selection: NO_SELECTION } }
    }
  }
}
