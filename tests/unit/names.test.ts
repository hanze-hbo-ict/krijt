/** Table and column names: letters and digits of any script, dashes and underscores. */
import { describe, expect, it } from 'vitest'
import { addSourceFields } from '../../src/commands/builders'
import { applyCommand } from '../../src/commands/commands'
import { isValidName, NAME_RULE, toValidName, typedName } from '../../src/model/names'
import { emptyDocument, newAttribute } from '../../src/model/types'
import { initialState, reducer } from '../../src/state/appState'
import { NO_NAME_IN_FIELDS_MESSAGE, resolveCanvasClick } from '../../src/state/interaction'

describe('valid names', () => {
  it('accepts letters and digits of any script, with diacritics, dashes and underscores', () => {
    for (const n of ['klantnr', 'Klant-nr', 'prijs_incl_btw', 'adres2', 'café', 'Straße', 'naïef', 'øre', 'αριθμός', 'Ωμέγα-2', 'имя', '名前', 'é', 'van–tot', 'a—b', 'x‿y'])
      expect(isValidName(n), n).toBe(true)
  })

  it('refuses spaces, punctuation, symbols and the export notation', () => {
    for (const n of ['', 'klant nr', 'a*', 'b/', 'c°', '#1', 'x→y', 'a,b', '(a)', 'a.b', 'prijs€', 'a:b', 'tab\there', "it's"])
      expect(isValidName(n), n).toBe(false)
  })
})

describe('turning labels into names', () => {
  it('replaces each run of other characters with one underscore, keeping typed dashes', () => {
    expect(toValidName('Datum (dd-mm)')).toBe('Datum_dd-mm')
    expect(toValidName('  Klant nr. ')).toBe('Klant_nr')
    expect(toValidName('Prijs (€) incl. btw')).toBe('Prijs_incl_btw')
    expect(toValidName('a _ b')).toBe('a_b')
    expect(toValidName('Αριθμός παραγγελίας')).toBe('Αριθμός_παραγγελίας')
    expect(toValidName('état')).toBe('état') // composed
    expect(toValidName('***')).toBe('')
  })

  it('while typing turns spaces into underscores and leaves other characters out', () => {
    expect(typedName('klant nr')).toBe('klant_nr')
    expect(typedName('prijs (€)')).toBe('prijs_')
    expect(typedName('van-tot')).toBe('van-tot')
    expect(typedName('ψ_1')).toBe('ψ_1')
  })
})

describe('names in the document', () => {
  const table = (name: string | null, attr: string) =>
    applyCommand(emptyDocument(), { type: 'createRelation', relation: { id: 'r', name, position: { x: 0, y: 0 }, attributes: [newAttribute('a', attr)] } })

  it('commands refuse invalid table and column names', () => {
    expect(table('Klant gegevens', 'x')).toEqual({ ok: false, error: NAME_RULE })
    expect(table('Klant', 'klant nr')).toEqual({ ok: false, error: NAME_RULE })
    expect(table('Πελάτης', 'όνομα').ok).toBe(true)
    const doc = (table('Klant', 'x') as { doc: ReturnType<typeof emptyDocument> }).doc
    expect(applyCommand(doc, { type: 'renameRelation', relationId: 'r', name: 'a b' })).toEqual({ ok: false, error: NAME_RULE })
    expect(applyCommand(doc, { type: 'renameRelation', relationId: 'r', name: '  ' }).ok).toBe(true) // unnamed
    expect(applyCommand(doc, { type: 'addAttributes', relationId: 'r', attributes: [newAttribute('b', 'a/b')] })).toEqual({ ok: false, error: NAME_RULE })
  })

  it('form fields follow the name rules: added labels are converted, unusable ones dropped', () => {
    const s = reducer(initialState(), { type: 'command', command: addSourceFields(['Datum (dd-mm)', 'Αριθμός πελάτη', '***'])! })
    expect(s.doc.sourceFields.map((f) => f.label)).toEqual(['Datum_dd-mm', 'Αριθμός_πελάτη'])
    expect(addSourceFields(['***', '(…)'])).toBeNull()
  })

  it('fields from an older session (free text) are converted when placed', () => {
    const doc = { ...emptyDocument(), sourceFields: [{ id: 'f1', label: 'Datum (dd-mm)' }, { id: 'f2', label: '***' }] }
    let s = initialState(doc)
    for (const f of s.doc.sourceFields) s = reducer(s, { type: 'toggleField', fieldId: f.id })
    s = reducer(s, { type: 'startPlace' })
    s = reducer(s, resolveCanvasClick(s, { kind: 'empty' }, { x: 0, y: 0 })!)
    expect(s.doc.relations[0]!.attributes.map((a) => a.name)).toEqual(['Datum_dd-mm'])
    expect(s.doc.sourceFields.map((f) => f.label)).toEqual(['Datum (dd-mm)', '***'])
  })

  it('an older field with nothing usable explains why nothing is placed', () => {
    let s = initialState({ ...emptyDocument(), sourceFields: [{ id: 'f1', label: '***' }] })
    s = reducer(s, { type: 'toggleField', fieldId: 'f1' })
    s = reducer(s, { type: 'startPlace' })
    s = reducer(s, resolveCanvasClick(s, { kind: 'empty' }, { x: 0, y: 0 })!)
    expect(s.doc.relations).toEqual([])
    expect(s.ui.message?.text).toBe(NO_NAME_IN_FIELDS_MESSAGE)
  })
})
