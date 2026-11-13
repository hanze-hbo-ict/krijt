/**
 * The Krijt document: the single source of truth for a diagram.
 *
 * It is semantic data (relations with ordered attributes, references between
 * attribute IDs), not a set of positioned shapes. Positions of relations are
 * part of the document because the student arranges them deliberately.
 * Viewport, selection and the active operation are UI state (see state/).
 */
export type Id = string
export type Point = { x: number; y: number }

/** A field of the original form. `ticked` is the student's own marker; absent means not ticked. */
export type SourceField = { id: Id; label: string; ticked?: true }

export type Attribute = {
  id: Id
  /** The name as typed. Notation (underline, `/`, superscript o) is never stored in it. */
  name: string
  primaryKey: boolean
  optional: boolean
  calculated: boolean
}

export type Relation = {
  id: Id
  /** null means truly unnamed; no placeholder is ever shown in the diagram. */
  name: string | null
  /** Top-left corner of the attribute strip, in diagram coordinates. */
  position: Point
  attributes: Attribute[]
}

export type ReferenceEnd = { relationId: Id; attributeIds: Id[] }

export type Reference = {
  id: Id
  /** The foreign-key (referencing) attributes. */
  from: ReferenceEnd
  /** The referenced attributes. */
  to: ReferenceEnd
}

export type KrijtDocument = {
  format: 'krijt'
  version: 1
  sourceFields: SourceField[]
  relations: Relation[]
  references: Reference[]
}

export function emptyDocument(): KrijtDocument {
  return { format: 'krijt', version: 1, sourceFields: [], relations: [], references: [] }
}

export function newAttribute(id: Id, name: string): Attribute {
  return { id, name, primaryKey: false, optional: false, calculated: false }
}
