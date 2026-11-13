/**
 * Table and column names: letters, marks and digits of any script (accents
 * included), dashes (Unicode Pd: - – — …) and connectors (Unicode Pc: _ ‿ …),
 * nothing else. This keeps names unambiguous in the text export, where `*`,
 * `/`, `°`, `#`, `→`, commas, parentheses and spaces all have a meaning.
 *
 * Form fields follow the same rules: typed text is filtered as it is typed, pasted lines are converted with
 * toValidName, so a field's label is used as the attribute name when it is placed.
 */

const ALLOWED = '\\p{L}\\p{M}\\p{N}\\p{Pd}\\p{Pc}'
const VALID = new RegExp(`^[${ALLOWED}]+$`, 'u')
const INVALID_RUN = new RegExp(`[^${ALLOWED}]+`, 'gu')
const INVALID_CHAR = new RegExp(`[^${ALLOWED}]`, 'gu')

export const NAME_RULE = 'Names may contain only letters, digits, dashes and underscores.'

export function isValidName(name: string): boolean {
  return VALID.test(name)
}

/**
 * A label as a valid name: each run of other characters becomes one underscore, repeated underscores become one,
 * and underscores at either end go ("Datum (dd-mm)" → "Datum_dd-mm", "Klant nr." → "Klant_nr").
 */
export function toValidName(label: string): string {
  return label
    .normalize('NFC')
    .replace(INVALID_RUN, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
}

/** While typing: whitespace becomes an underscore, other characters that are not allowed are left out. */
export function typedName(text: string): string {
  return text.replace(/\s/gu, '_').replace(INVALID_CHAR, '')
}

/** Table names are shown in capitals, in the diagram and in both exports; the stored name keeps its case. */
export function tableNameText(name: string): string {
  return name.toUpperCase()
}
