/**
 * Application state: the document (single source of truth), its undo history,
 * and UI state.
 *
 * UI state is an explicit state machine: the normal `select` operation and
 * one-shot operations that return to `select` when they complete or are
 * cancelled. Cancelling changes UI state only, never the document.
 *
 * The reducer is pure. Anything that needs fresh IDs (building commands) is
 * resolved before dispatch, in interaction.ts.
 */
import { applyCommand, isContiguous, REFERENCE_ADJACENT_ERROR, type Command } from '../commands/commands'
import type { Id, KrijtDocument } from '../model/types'
import { emptyDocument } from '../model/types'
import { DEFAULT_VIEWPORT, type Viewport } from '../geometry/viewport'

export type Selection =
  | { kind: 'none' }
  | { kind: 'relation'; relationId: Id }
  /** Attributes in click order, all in one table (reconcileUi enforces this). */
  | { kind: 'attributes'; attributeIds: Id[] }
  | { kind: 'reference'; referenceId: Id }

export type Operation =
  | { kind: 'select' }
  /** Copy the selected source fields into a table or onto empty canvas. */
  | { kind: 'place' }
  /** Click-based table movement: the next click on the canvas is the new position. */
  | { kind: 'moveTable'; relationId: Id }
  /** Copy a table: the next click on the canvas is where the (unnamed) copy goes. */
  | { kind: 'copyTable'; relationId: Id }
  /** Move the selected attributes: the next click on the canvas is the destination. */
  | { kind: 'move' }
  /** Copy the selected attributes: as Move, but the originals stay and copies get new IDs. */
  | { kind: 'copy' }
  /**
   * Create a reference from the selected attributes (the foreign key, side by side in one table): one click
   * on a cell picks that many side-by-side referenced attributes (see referenceBlock in interaction.ts).
   */
  | { kind: 'reference'; source: Id[] }

export type Editing =
  | null
  | { kind: 'relationName'; relationId: Id }
  | { kind: 'newAttribute'; relationId: Id }
  | { kind: 'attributeName'; attributeId: Id }

export type Message = { kind: 'error' | 'info'; text: string }

export type UiState = {
  operation: Operation
  selection: Selection
  /**
   * "Add to selection": clicks on cells of the selected table add or remove them instead of replacing the
   * selection. Only meaningful while attributes are selected; reconcileUi switches it off otherwise.
   */
  multiSelect: boolean
  /** Selected source fields, in click order (placement uses inventory order). */
  selectedFieldIds: Id[]
  /** "Add to selection" in the field toolbar: clicks add or remove fields. Off whenever no field is selected. */
  multiSelectFields: boolean
  editing: Editing
  viewport: Viewport
  sidebarCollapsed: boolean
  message: Message | null
}

export type History = {
  past: KrijtDocument[]
  future: KrijtDocument[]
  /** Consecutive commands with the same key (e.g. arrow-key nudges of one table) form one step. */
  coalesceKey: string | null
}

export type AppState = { doc: KrijtDocument; ui: UiState; history: History }

export const HISTORY_LIMIT = 200

export const NO_SELECTION: Selection = { kind: 'none' }
export const SELECT: Operation = { kind: 'select' }
const EMPTY_HISTORY: History = { past: [], future: [], coalesceKey: null }

export function initialUi(): UiState {
  return {
    operation: SELECT,
    selection: NO_SELECTION,
    multiSelect: false,
    selectedFieldIds: [],
    multiSelectFields: false,
    editing: null,
    viewport: DEFAULT_VIEWPORT,
    sidebarCollapsed: false,
    message: null,
  }
}

export function initialState(doc: KrijtDocument = emptyDocument(), ui: Partial<UiState> = {}): AppState {
  return { doc, ui: { ...initialUi(), ...ui }, history: EMPTY_HISTORY }
}

export type Action =
  /** Apply a document command; on success also apply `after` to the UI state. */
  | { type: 'command'; command: Command; after?: Partial<UiState>; coalesceKey?: string }
  | { type: 'ui'; patch: Partial<UiState> }
  /** Add a field to the selection, or remove it (Shift-click, or a click with Add to selection on). */
  | { type: 'toggleField'; fieldId: Id }
  /** A plain click: select only this field. */
  | { type: 'selectField'; fieldId: Id }
  | { type: 'startPlace' }
  | { type: 'startMoveTable'; relationId: Id }
  | { type: 'startCopyTable'; relationId: Id }
  /** Move/Copy the selected attributes (Move / Copy in the toolbar): choose a destination next. */
  | { type: 'startAttributes'; kind: 'move' | 'copy' }
  /** Reference in the toolbar: the selected attributes become the foreign key; choose the referenced attributes next. */
  | { type: 'startReference' }
  /** Escape / Cancel: close an edit, end the operation, or clear the selection (of diagram items or fields). */
  | { type: 'cancel' }
  | { type: 'undo' }
  | { type: 'redo' }

export function selectedAttributeIds(ui: UiState): Id[] {
  return ui.selection.kind === 'attributes' ? ui.selection.attributeIds : []
}

export const NO_ATTRIBUTES_MESSAGE = 'Select one or more attributes first.'

/** The table that owns each attribute. */
export function attributeOwners(doc: KrijtDocument): Map<Id, Id> {
  const owner = new Map<Id, Id>()
  for (const r of doc.relations) for (const a of r.attributes) owner.set(a.id, r.id)
  return owner
}

/** The single table holding all of `ids`, or null if they span several (or none). */
export function commonRelation(doc: KrijtDocument, ids: Id[]): Id | null {
  const owner = attributeOwners(doc)
  const tables = new Set(ids.map((id) => owner.get(id)))
  if (tables.size !== 1) return null
  return [...tables][0] ?? null
}

/** Drops UI references to things the document no longer has. */
export function reconcileUi(doc: KrijtDocument, ui: UiState): UiState {
  const relationIds = new Set(doc.relations.map((r) => r.id))
  const attributeIds = new Set(doc.relations.flatMap((r) => r.attributes.map((a) => a.id)))
  const fieldIds = new Set(doc.sourceFields.map((f) => f.id))
  let { selection, operation, editing } = ui
  if (selection.kind === 'relation' && !relationIds.has(selection.relationId)) selection = NO_SELECTION
  if (selection.kind === 'attributes') {
    // Existing attributes only, and only those in the table of the first one.
    const owner = attributeOwners(doc)
    const table = owner.get(selection.attributeIds.find((id) => owner.has(id)) ?? '')
    const kept = table === undefined ? [] : selection.attributeIds.filter((id) => owner.get(id) === table)
    if (kept.length !== selection.attributeIds.length) selection = kept.length ? { kind: 'attributes', attributeIds: kept } : NO_SELECTION
  }
  if (selection.kind === 'reference') {
    const id = selection.referenceId
    if (!doc.references.some((r) => r.id === id)) selection = NO_SELECTION
  }
  if ((operation.kind === 'moveTable' || operation.kind === 'copyTable') && !relationIds.has(operation.relationId)) operation = SELECT
  if (operation.kind === 'reference') {
    const source = operation.source.filter((id) => attributeIds.has(id))
    if (source.length !== operation.source.length) operation = source.length ? { ...operation, source } : SELECT
  }
  if ((operation.kind === 'move' || operation.kind === 'copy') && selection.kind !== 'attributes') operation = SELECT
  // Add-to-selection mode never outlives the attribute selection it adds to.
  const multiSelect = ui.multiSelect && selection.kind === 'attributes'
  if (editing) {
    const gone = editing.kind === 'attributeName' ? !attributeIds.has(editing.attributeId) : !relationIds.has(editing.relationId)
    if (gone) editing = null
  }
  const selectedFieldIds = ui.selectedFieldIds.filter((id) => fieldIds.has(id))
  const multiSelectFields = ui.multiSelectFields && selectedFieldIds.length > 0
  const same =
    selection === ui.selection &&
    operation === ui.operation &&
    editing === ui.editing &&
    multiSelect === ui.multiSelect &&
    selectedFieldIds.length === ui.selectedFieldIds.length &&
    multiSelectFields === ui.multiSelectFields
  return same ? ui : { ...ui, selection, operation, editing, multiSelect, selectedFieldIds, multiSelectFields }
}

function pushHistory(h: History, doc: KrijtDocument, key: string | null): History {
  if (key !== null && key === h.coalesceKey) return { ...h, future: [] }
  const past = h.past.length >= HISTORY_LIMIT ? [...h.past.slice(h.past.length - HISTORY_LIMIT + 1), doc] : [...h.past, doc]
  return { past, future: [], coalesceKey: key }
}

/** After undo/redo, operations and edits that refer to the old document end. */
function afterTimeTravel(doc: KrijtDocument, ui: UiState): UiState {
  return reconcileUi(doc, { ...ui, operation: SELECT, editing: null, message: null })
}

/**
 * Fields and diagram items are never selected at the same time: the newer selection wins (and Add to selection ends
 * with the selection it belonged to). While placing, the fields stay selected: a click on the diagram then picks a
 * destination, it does not select.
 */
function oneSelection(prev: UiState, next: UiState): UiState {
  if (next.selectedFieldIds.length === 0 || next.selection.kind === 'none') return next
  const fieldsChanged = next.selectedFieldIds !== prev.selectedFieldIds
  const diagramChanged = next.selection !== prev.selection
  if (diagramChanged && !fieldsChanged && next.operation.kind !== 'place')
    return { ...next, selectedFieldIds: [], multiSelectFields: false }
  if (fieldsChanged) return { ...next, selection: NO_SELECTION, multiSelect: false }
  return next
}

export function reducer(state: AppState, action: Action): AppState {
  const next = step(state, action)
  if (next.ui === state.ui) return next
  const ui = oneSelection(state.ui, next.ui)
  return ui === next.ui ? next : { ...next, ui }
}

function step(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'command': {
      const result = applyCommand(state.doc, action.command)
      if (!result.ok) return { ...state, ui: { ...state.ui, message: { kind: 'error', text: result.error } } }
      const message: Message | null = result.notice ? { kind: 'info', text: result.notice } : null
      const ui = reconcileUi(result.doc, { ...state.ui, message, ...action.after })
      if (result.doc === state.doc) return { ...state, ui }
      return { doc: result.doc, ui, history: pushHistory(state.history, state.doc, action.coalesceKey ?? null) }
    }
    case 'ui':
      return { ...state, ui: reconcileUi(state.doc, { ...state.ui, ...action.patch }) }
    case 'toggleField':
    case 'selectField': {
      if (!state.doc.sourceFields.some((f) => f.id === action.fieldId)) return state
      const ids = state.ui.selectedFieldIds
      const selectedFieldIds =
        action.type === 'selectField'
          ? [action.fieldId]
          : ids.includes(action.fieldId)
            ? ids.filter((id) => id !== action.fieldId)
            : [...ids, action.fieldId]
      return { ...state, ui: reconcileUi(state.doc, { ...state.ui, selectedFieldIds, message: null }) }
    }
    case 'startPlace':
      return { ...state, ui: { ...state.ui, operation: { kind: 'place' }, editing: null, message: null } }
    case 'startMoveTable':
    case 'startCopyTable':
      if (!state.doc.relations.some((r) => r.id === action.relationId)) return state
      return {
        ...state,
        ui: {
          ...state.ui,
          operation: { kind: action.type === 'startMoveTable' ? 'moveTable' : 'copyTable', relationId: action.relationId },
          selection: { kind: 'relation', relationId: action.relationId },
          editing: null,
          message: null,
        },
      }
    case 'startAttributes': {
      if (state.ui.selection.kind !== 'attributes')
        return { ...state, ui: { ...state.ui, message: { kind: 'error', text: NO_ATTRIBUTES_MESSAGE } } }
      return { ...state, ui: { ...state.ui, operation: { kind: action.kind }, editing: null, message: null } }
    }
    case 'startReference': {
      const source = selectedAttributeIds(state.ui)
      const error = (text: string): AppState => ({ ...state, ui: { ...state.ui, message: { kind: 'error', text } } })
      if (source.length === 0) return error(NO_ATTRIBUTES_MESSAGE)
      if (!isContiguous(state.doc, source)) return error(REFERENCE_ADJACENT_ERROR)
      return { ...state, ui: { ...state.ui, operation: { kind: 'reference', source }, editing: null, message: null } }
    }
    case 'cancel': {
      const ui = state.ui
      if (ui.editing) return { ...state, ui: { ...ui, editing: null } }
      if (ui.operation.kind !== 'select') return { ...state, ui: { ...ui, operation: SELECT, message: null } }
      if (ui.message) return { ...state, ui: { ...ui, message: null } }
      if (ui.selection.kind !== 'none') return { ...state, ui: { ...ui, selection: NO_SELECTION, multiSelect: false } }
      if (ui.selectedFieldIds.length > 0) return { ...state, ui: { ...ui, selectedFieldIds: [], multiSelectFields: false } }
      return state
    }
    case 'undo': {
      const { past, future } = state.history
      const prev = past[past.length - 1]
      if (!prev) return state
      return {
        doc: prev,
        ui: afterTimeTravel(prev, state.ui),
        history: { past: past.slice(0, -1), future: [state.doc, ...future], coalesceKey: null },
      }
    }
    case 'redo': {
      const { past, future } = state.history
      const next = future[0]
      if (!next) return state
      return {
        doc: next,
        ui: afterTimeTravel(next, state.ui),
        history: { past: [...past, state.doc], future: future.slice(1), coalesceKey: null },
      }
    }
  }
}
