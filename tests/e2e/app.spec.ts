import { expect, test, type Page } from '@playwright/test'

const TWELVE = [
  'Ordernummer',
  'Orderdatum',
  'Klantnummer',
  'Klantnaam',
  'Adres',
  'Postcode',
  'Plaats',
  'Artikelnummer',
  'Omschrijving',
  'Aantal',
  'Prijs',
  'Subtotaal',
]

async function pasteList(page: Page, text: string) {
  await page.getByRole('button', { name: 'Paste a list of fields' }).click()
  await page.getByLabel('One field per line').fill(text)
  await page.getByRole('button', { name: /^Add \d+ fields$/ }).click()
}

const fieldList = (page: Page) => page.getByRole('list', { name: 'Form fields' })
const field = (page: Page, label: string) => fieldList(page).getByRole('button', { name: label, exact: true })
const canvas = (page: Page) => page.locator('.canvas-svg')
const cell = (page: Page, name: string, table = 'unnamed table') => page.getByRole('button', { name: `Attribute ${name} in ${table}`, exact: true })

async function placeOnCanvas(page: Page, labels: string[], position = { x: 160, y: 140 }) {
  for (const l of labels) await field(page, l).click()
  await page.getByRole('button', { name: 'Place in diagram' }).click()
  await canvas(page).click({ position })
}

test.beforeEach(async ({ page }) => {
  // Exam constraint: nothing may be fetched from anywhere but the app's own origin.
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (url.hostname !== 'localhost' && !url.protocol.startsWith('data') && !url.protocol.startsWith('blob'))
      throw new Error(`Unexpected request: ${req.url()}`)
  })
  await page.goto('/')
})

test('acceptance: paste 12 fields and build an unnamed table from a subset with clicks only', async ({ page }) => {
  // Blank lines in the paste are dropped.
  await pasteList(page, TWELVE.slice(0, 7).join('\n') + '\n\n' + TWELVE.slice(7).join('\n') + '\n')
  await expect(fieldList(page).getByRole('listitem')).toHaveCount(12)

  // Click order differs from inventory order; the table follows inventory order.
  await field(page, 'Klantnaam').click()
  await field(page, 'Klantnummer').click()
  await field(page, 'Plaats').click()
  await expect(page.getByText('3 selected')).toBeVisible()
  await expect(field(page, 'Klantnaam')).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Place in diagram' }).click()
  await expect(page.getByRole('button', { name: 'Placing…' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.diagram-header [aria-live]')).toHaveText('Place 3 fields: choose a table, or empty canvas for a new table.')
  await canvas(page).click({ position: { x: 200, y: 160 } })

  const cells = page.locator('.cell')
  await expect(cells).toHaveCount(3)
  await expect(cells.nth(0)).toHaveAccessibleName('Attribute Klantnummer in unnamed table')
  await expect(cells.nth(1)).toHaveAccessibleName('Attribute Klantnaam in unnamed table')
  await expect(cells.nth(2)).toHaveAccessibleName('Attribute Plaats in unnamed table')
  // Unnamed: no generated "Table 1" label anywhere in the diagram.
  await expect(canvas(page)).not.toContainText(/Table\s*\d/)
  // The inventory is unchanged and the operation has ended.
  await expect(fieldList(page).getByRole('listitem')).toHaveCount(12)
  await expect(page.getByText('No fields selected')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Move table' })).toBeVisible()
})

test('single entry with Enter, multi-line paste into the entry, rename and remove a field', async ({ page }) => {
  const entry = page.getByLabel('New field')
  await entry.fill('Naam')
  await entry.press('Enter')
  await expect(entry).toBeFocused()
  await expect(entry).toHaveValue('')
  await entry.fill('Naam')
  await entry.press('Enter') // deliberate duplicate is kept
  await expect(fieldList(page).getByRole('listitem')).toHaveCount(2)

  await entry.evaluate((el) => {
    const data = new DataTransfer()
    data.setData('text/plain', 'Café\r\n\r\n<b>Één</b>\n')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await expect(field(page, 'Café')).toBeVisible()
  await expect(field(page, '<b>Één</b>')).toBeVisible() // shown as text, not HTML

  await page.getByRole('button', { name: 'Rename Café' }).click()
  const edit = page.getByLabel('Rename field Café')
  await edit.fill('Cafénaam')
  await edit.press('Enter')
  await expect(field(page, 'Cafénaam')).toBeVisible()

  await page.getByRole('button', { name: 'Remove Cafénaam' }).click()
  await expect(fieldList(page).getByRole('listitem')).toHaveCount(3)
})

test('add fields to an existing table, type attributes directly, and name the table', async ({ page }) => {
  await pasteList(page, 'A\nB\nC')
  await placeOnCanvas(page, ['A'])

  // Command first, then selection, then destination: an existing table's cell.
  await page.getByRole('button', { name: 'Place in diagram' }).click()
  await field(page, 'C').click()
  await field(page, 'B').click()
  await cell(page, 'A').click()
  await expect(page.locator('.cell')).toHaveCount(3)
  await expect(page.locator('.cell').nth(1)).toHaveAccessibleName('Attribute B in unnamed table')
  await expect(page.locator('.relation')).toHaveCount(1)

  // Typed attributes: Enter adds one and keeps the input open; Escape closes it.
  await page.getByRole('button', { name: 'Add attribute', exact: true }).click()
  const input = page.getByLabel('New attribute name (Enter adds it, Escape closes)')
  await input.fill('Datum')
  await input.press('Enter')
  await input.fill('Bedrag')
  await input.press('Enter')
  await input.press('Escape')
  await expect(input).toHaveCount(0)
  await expect(page.locator('.cell')).toHaveCount(5)
  await expect(page.locator('.cell').nth(4)).toHaveAccessibleName('Attribute Bedrag in unnamed table')
  // The inventory did not change.
  await expect(fieldList(page).getByRole('listitem')).toHaveCount(3)

  // Name the table, then clear the name again.
  await page.getByRole('button', { name: 'Name table' }).click()
  const name = page.getByLabel('Table name (leave empty for an unnamed table)')
  await name.fill('Bestelling')
  await name.press('Enter')
  await expect(page.locator('.relation-name')).toHaveText('BESTELLING')
  await expect(cell(page, 'A', 'table Bestelling')).toBeVisible()
  await page.getByRole('button', { name: 'Rename table' }).click()
  await name.fill('')
  await name.press('Enter')
  await expect(cell(page, 'A')).toBeVisible()
  // Selected and unnamed: only the "Add name" affordance, no name text.
  await expect(page.locator('.relation-name')).toHaveText('Add name')
})

test('the + cell adds attributes without the sidebar', async ({ page }) => {
  await pasteList(page, 'X')
  await placeOnCanvas(page, ['X'])
  await canvas(page).click({ position: { x: 600, y: 400 } }) // clears selection, creates nothing
  await expect(page.locator('.relation')).toHaveCount(1)
  await page.getByRole('button', { name: 'Add attribute to unnamed table' }).click()
  const input = page.getByLabel('New attribute name (Enter adds it, Escape closes)')
  await input.fill('Y')
  await input.press('Enter')
  await expect(cell(page, 'Y')).toBeVisible()
})

test('select and deselect an attribute with plain clicks', async ({ page }) => {
  await pasteList(page, 'P\nQ')
  await placeOnCanvas(page, ['P', 'Q'])
  await cell(page, 'Q').click()
  await expect(cell(page, 'Q')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('toolbar', { name: 'Selection actions' })).toBeVisible()
  await cell(page, 'Q').click()
  await expect(cell(page, 'Q')).toHaveAttribute('aria-pressed', 'false')
})

test('move a table by clicks, by keyboard, and by dragging its header', async ({ page }) => {
  await pasteList(page, 'M')
  await placeOnCanvas(page, ['M'], { x: 100, y: 100 })
  const box = async () => (await cell(page, 'M').boundingBox())!

  await page.getByRole('button', { name: 'Move table' }).click()
  await expect(page.getByRole('button', { name: 'Move table' })).toHaveAttribute('aria-pressed', 'true')
  await canvas(page).click({ position: { x: 400, y: 300 } })
  const svgBox = (await canvas(page).boundingBox())!
  let b = await box()
  expect(Math.abs(b.x - (svgBox.x + 400))).toBeLessThan(2)
  expect(Math.abs(b.y + b.height / 2 - (svgBox.y + 300))).toBeLessThan(2)

  // Arrow keys nudge the selected table.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  const afterKeys = await box()
  expect(Math.round(afterKeys.x - b.x)).toBe(20)

  // Dragging the header band is an optional shortcut.
  const header = page.locator('.relation-header')
  const h = (await header.boundingBox())!
  await page.mouse.move(h.x + 8, h.y + h.height / 2)
  await page.mouse.down()
  await page.mouse.move(h.x + 60, h.y + h.height / 2 + 40, { steps: 5 })
  await page.mouse.up()
  b = await box()
  expect(Math.round(b.x - afterKeys.x)).toBe(52)
  expect(Math.round(b.y - afterKeys.y)).toBe(40)
})

test('Escape, or the pressed button, ends an operation without changing the document', async ({ page }) => {
  await pasteList(page, 'E')
  await field(page, 'E').click()
  await page.getByRole('button', { name: 'Place in diagram' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Place in diagram' })).toHaveAttribute('aria-pressed', 'false')
  await canvas(page).click({ position: { x: 200, y: 200 } })
  await expect(page.locator('.relation')).toHaveCount(0)

  await page.getByRole('button', { name: 'Place in diagram' }).click()
  await page.getByRole('button', { name: 'Placing…' }).click() // pressing it again cancels
  await canvas(page).click({ position: { x: 200, y: 200 } })
  await expect(page.locator('.relation')).toHaveCount(0)
  await expect(field(page, 'E')).toHaveAttribute('aria-pressed', 'true')
})

test('typing in a name field does not trigger shortcuts', async ({ page }) => {
  await pasteList(page, 'K')
  await placeOnCanvas(page, ['K'])
  const before = (await cell(page, 'K').boundingBox())!
  await page.getByRole('button', { name: 'Name table' }).click()
  const name = page.getByLabel('Table name (leave empty for an unnamed table)')
  await name.fill('Klant')
  await name.press('ArrowLeft')
  await name.press('ArrowLeft')
  await name.press('Escape') // cancels the edit only
  await expect(name).toHaveCount(0)
  // No name was saved (the "Add name" placeholder does not fit over a one-cell table; the toolbar offers it instead).
  await expect(page.locator('.relation-name')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Name table' })).toBeVisible()
  const after = (await cell(page, 'K').boundingBox())!
  expect(after.x).toBe(before.x)
  // The table is still selected; a second Escape clears that.
  await expect(page.getByRole('button', { name: 'Move table' })).toBeVisible()
})

test('delete a table and restore it with undo', async ({ page }) => {
  await pasteList(page, 'D')
  await placeOnCanvas(page, ['D'])
  const before = (await cell(page, 'D').boundingBox())!
  await page.getByRole('button', { name: 'Delete table' }).click()
  await expect(page.locator('.relation')).toHaveCount(0)
  await expect(fieldList(page).getByRole('listitem')).toHaveCount(1)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.relation')).toHaveCount(1)
  expect((await cell(page, 'D').boundingBox())!.x).toBe(before.x)
})

test('a reload of the same tab restores the session', async ({ page }) => {
  await pasteList(page, 'R1\nR2\nR3')
  await placeOnCanvas(page, ['R1', 'R3'])
  await page.getByRole('button', { name: 'Name table' }).click()
  await page.getByLabel('Table name (leave empty for an unnamed table)').fill('Herstel')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500) // debounced save
  await page.reload()
  await expect(fieldList(page).getByRole('listitem')).toHaveCount(3)
  await expect(cell(page, 'R1', 'table Herstel')).toBeVisible()
  await expect(cell(page, 'R3', 'table Herstel')).toBeVisible()
  // Stored in sessionStorage only.
  const stores = await page.evaluate(() => ({ session: sessionStorage.length, local: localStorage.length }))
  expect(stores.session).toBe(1)
  expect(stores.local).toBe(0)
})

test('corrupt session data starts an empty diagram instead of crashing', async ({ page }) => {
  await page.evaluate(() => sessionStorage.setItem('krijt:v1:session', '{"version":1,"doc":{"format":"krijt","version":1,"relations":"x"}}'))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Krijt' })).toBeVisible()
  await expect(page.getByText('Type the fields of the original form')).toBeVisible()
})

test('help opens and closes', async ({ page }) => {
  await page.getByRole('button', { name: 'Help' }).click()
  const dialog = page.getByRole('dialog', { name: 'Using Krijt' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('not a saved file')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})
