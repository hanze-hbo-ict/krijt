/**
 * The JSON text a student can copy ("Copy data"): the complete, versioned
 * document with a fixed key order, so the same diagram always gives the same
 * text. Export only; Krijt never imports it.
 */
import type { KrijtDocument } from './types'

export function documentForExport(doc: KrijtDocument): KrijtDocument {
  return {
    format: 'krijt',
    version: 1,
    sourceFields: doc.sourceFields.map((f) => ({ id: f.id, label: f.label })),
    relations: doc.relations.map((r) => ({
      id: r.id,
      name: r.name,
      position: { x: r.position.x, y: r.position.y },
      attributes: r.attributes.map((a) => ({ id: a.id, name: a.name, primaryKey: a.primaryKey, nullable: a.nullable, calculated: a.calculated })),
    })),
    references: doc.references.map((ref) => ({
      id: ref.id,
      from: { relationId: ref.from.relationId, attributeIds: [...ref.from.attributeIds] },
      to: { relationId: ref.to.relationId, attributeIds: [...ref.to.attributeIds] },
    })),
  }
}

export function serializeDocument(doc: KrijtDocument): string {
  return JSON.stringify(documentForExport(doc), null, 2) + '\n'
}
