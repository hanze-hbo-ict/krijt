/** Milestone 2 workflows in real browsers: attribute editing, notation, Move/Copy, undo/redo, drag shortcuts. */
import { expect, test, type Locator, type Page } from '@playwright/test'

const fieldList = (page: Page) => page.getByRole('list', { name: 'Form fields' })
const field = (page: Page, label: string) => fieldList(page).getByRole('button', { name: label, exact: true })
const canvas = (page: Page) => page.locator('.canvas-svg')
const relations = (page: Page) => page.locator('.relation')
const cellIn = (rel: Locator, name: string) => rel.locator(`.cell[aria-label^="Attribute ${name} in"]`)
const anyCell = (page: Page, name: string) => page.locator(`.cell[aria-label^="Attribute ${name} in"]`)
/** Clicks empty canvas near the top-right corner, away from tables. */
async function clickEmpty(page: Page) {
  const box = (await canvas(page).boundingBox())!
  await canvas(page).click({ position: { x: box.width - 40, y: 30 } })
}
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Selection actions' })
const action = (page: Page, name: string) => toolbar(page).getByRole('button', { name, exact: true })
/** Selects cells of one table by plain clicks: the first, then "Add to selection" and the rest. */
async function selectCells(page: Page, cells: Locator[]) {
  await cells[0]!.click()
  if (cells.length > 1) await action(page, 'Add to selection').click()
  for (const c of cells.slice(1)) await c.click()
}

/** Attribute names per table, in document order. */
async function tables(page: Page): Promise<string[][]> {
  return relations(page).evaluateAll((rels) =>
    rels.map((r) => [...r.querySelectorAll('.cell')].map((c) => (c.getAttribute('aria-label') ?? '').replace(/^Attribute (.*) in .*$/, '$1'))),
  )
}

async function setup(page: Page, names: string[]) {
  await page.goto('/')
  await page.getByLabel('New field').evaluate((el, t) => {
    const data = new DataTransfer()
    data.setData('text/plain', t + '\n')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, names.join('\n'))
  for (const n of names) await field(page, n).click({ modifiers: ['Shift'] })
  await page.getByRole('toolbar', { name: 'Field actions' }).getByRole('button', { name: 'Place in diagram' }).click()
  await canvas(page).click({ position: { x: 60, y: 80 } })
  await clickEmpty(page) // clear the selection
}

const TEN = ['Ordernr', 'Datum', 'Klantnr', 'Naam', 'Adres', 'Plaats', 'Artikelnr', 'Omschrijving', 'Aantal', 'Prijs']

test.beforeEach(async ({ page }) => {
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (url.hostname !== 'localhost' && !url.protocol.startsWith('data') && !url.protocol.startsWith('blob'))
      throw new Error(`Unexpected request: ${req.url()}`)
  })
})

test('acceptance: split a 10-attribute table into three, copy one back, undo and redo each step — clicks only', async ({ page }) => {
  await setup(page, TEN)
  expect(await tables(page)).toEqual([TEN])
  const states: string[][][] = [await tables(page)]

  // Move 1: select the attributes, "Move", click empty canvas.
  await selectCells(page, ['Klantnr', 'Naam', 'Adres', 'Plaats'].map((n) => anyCell(page, n)))
  await action(page, 'Move').click()
  await expect(action(page, 'Move')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.diagram-header [aria-live]')).toHaveText('Move 4 attributes: choose a destination.')
  await canvas(page).click({ position: { x: 60, y: 200 } })
  states.push(await tables(page))
  expect(states[1]).toEqual([
    ['Ordernr', 'Datum', 'Artikelnr', 'Omschrijving', 'Aantal', 'Prijs'],
    ['Klantnr', 'Naam', 'Adres', 'Plaats'],
  ])
  await expect(action(page, 'Move')).toHaveAttribute('aria-pressed', 'false') // one-shot: back to selecting

  // Move 2.
  await clickEmpty(page)
  await selectCells(page, ['Artikelnr', 'Omschrijving', 'Prijs'].map((n) => anyCell(page, n)))
  await action(page, 'Move').click()
  await canvas(page).click({ position: { x: 60, y: 320 } })
  states.push(await tables(page))
  expect(states[2]).toEqual([
    ['Ordernr', 'Datum', 'Aantal'],
    ['Klantnr', 'Naam', 'Adres', 'Plaats'],
    ['Artikelnr', 'Omschrijving', 'Prijs'],
  ])

  // Copy Klantnr back into the first table, by clicking that table's header.
  await anyCell(page, 'Klantnr').click()
  await action(page, 'Copy').click()
  await relations(page).nth(0).locator('.relation-header').click()
  states.push(await tables(page))
  expect(states[3]![0]).toEqual(['Ordernr', 'Datum', 'Aantal', 'Klantnr'])
  expect(states[3]![1]).toEqual(['Klantnr', 'Naam', 'Adres', 'Plaats'])

  // Undo each step with the button, redo each with the keyboard shortcut.
  for (let i = states.length - 2; i >= 0; i--) {
    await page.getByRole('button', { name: 'Undo' }).click()
    expect(await tables(page)).toEqual(states[i])
  }
  await clickEmpty(page) // keyboard focus on the page, not a button
  for (let i = 1; i < states.length; i++) {
    await page.keyboard.press('ControlOrMeta+Shift+z')
    expect(await tables(page)).toEqual(states[i])
  }
  await page.keyboard.press('ControlOrMeta+z')
  expect(await tables(page)).toEqual(states[2])
})

test('notation: primary key bold and underlined, nullable superscript o, calculated slash', async ({ page }) => {
  await setup(page, ['Ordernr', 'Regelnr', 'Korting', 'Subtotaal'])
  const rel = relations(page).nth(0)

  // Composite key: two primary-key attributes.
  await selectCells(page, [cellIn(rel, 'Ordernr'), cellIn(rel, 'Regelnr')])
  await page.getByRole('button', { name: 'Primary key' }).click()
  await expect(page.getByRole('button', { name: 'Primary key' })).toHaveAttribute('aria-pressed', 'true')

  await clickEmpty(page)
  await cellIn(rel, 'Korting').click()
  await page.getByRole('button', { name: 'Nullable' }).click()
  await cellIn(rel, 'Subtotaal').click()
  await page.getByRole('button', { name: 'Calculated' }).click()
  await page.getByRole('button', { name: 'Nullable' }).click()

  for (const n of ['Ordernr', 'Regelnr']) {
    await expect(cellIn(rel, n).locator('text')).toHaveAttribute('font-weight', '700')
    await expect(cellIn(rel, n).locator('.attr-underline')).toHaveCount(1)
  }
  await expect(cellIn(rel, 'Korting').locator('.attr-underline')).toHaveCount(0)
  // The stored name stays clean; notation is rendered separately.
  await expect(cellIn(rel, 'Korting').locator('tspan').first()).toHaveText('Korting')
  const korting = cellIn(rel, 'Korting').locator('tspan')
  await expect(korting).toHaveText(['Korting', 'o'])
  await expect(korting.nth(1)).toHaveAttribute('dy', '-6')
  // Calculated + nullable: /, then the name, then superscript o.
  await expect(cellIn(rel, 'Subtotaal').locator('tspan')).toHaveText(['/', 'Subtotaal', 'o'])

  // Mixed selection shows a mixed state; the toggle then sets the flag on all. Shift-click adds too.
  await cellIn(rel, 'Ordernr').click({ modifiers: ['Shift'] })
  await expect(page.getByRole('button', { name: 'Primary key' })).toHaveAttribute('aria-pressed', 'mixed')
})

test('rename, reorder and delete attributes, with dependent deletions explained', async ({ page }) => {
  await setup(page, ['a', 'b', 'c'])
  const rel = relations(page).nth(0)

  // Double-click renames; Enter commits.
  await cellIn(rel, 'b').dblclick()
  const input = page.getByLabel('Rename attribute b')
  await input.fill('Bedrag')
  await input.press('Enter')
  expect(await tables(page)).toEqual([['a', 'Bedrag', 'c']])

  // Enter on a selected attribute renames too; Escape cancels without change.
  await cellIn(rel, 'a').click() // the clicked cell has keyboard focus
  await page.keyboard.press('Enter')
  await page.getByLabel('Rename attribute a').fill('zzz')
  await page.keyboard.press('Escape')
  expect(await tables(page)).toEqual([['a', 'Bedrag', 'c']])

  // Reorder with buttons and arrow keys.
  await page.getByRole('button', { name: 'Move right' }).click()
  expect(await tables(page)).toEqual([['Bedrag', 'a', 'c']])
  await cellIn(rel, 'a').focus() // arrows on a toolbar button stay with the button
  await page.keyboard.press('ArrowRight')
  expect(await tables(page)).toEqual([['Bedrag', 'c', 'a']])

  // Delete the last two; then the last one removes the table. Nothing is reported.
  await page.getByRole('button', { name: 'Delete' }).click()
  expect(await tables(page)).toEqual([['Bedrag', 'c']])
  await selectCells(page, [cellIn(rel, 'Bedrag'), cellIn(rel, 'c')])
  await cellIn(rel, 'c').focus()
  await page.keyboard.press('Delete')
  await expect(relations(page)).toHaveCount(0)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+z')
  expect(await tables(page)).toEqual([['Bedrag', 'c']])
})

test('a cell edge chooses where moved attributes are inserted, with a preview', async ({ page }) => {
  await setup(page, ['a', 'b', 'c', 'd'])
  const rel = relations(page).nth(0)
  await cellIn(rel, 'd').click()
  await action(page, 'Move').click()
  const b = (await cellIn(rel, 'b').boundingBox())!
  await page.mouse.move(b.x + 4, b.y + b.height / 2)
  await expect(page.locator('.preview-bar')).toHaveCount(1)
  await page.mouse.click(b.x + 4, b.y + b.height / 2)
  expect(await tables(page)).toEqual([['a', 'd', 'b', 'c']])
  await expect(page.locator('.preview-bar')).toHaveCount(0)
})

test('Escape, or the pressed button, cancels Move and Copy without changing the diagram', async ({ page }) => {
  await setup(page, ['a', 'b'])
  for (const t of ['Move', 'Copy']) {
    await anyCell(page, 'a').click()
    await action(page, t).click()
    await expect(action(page, 'Delete')).toBeDisabled() // other actions wait
    await page.keyboard.press('Escape')
    await expect(action(page, t)).toHaveAttribute('aria-pressed', 'false')
    await action(page, t).click()
    await action(page, t).click() // pressing it again cancels too
    await expect(action(page, t)).toHaveAttribute('aria-pressed', 'false')
    await clickEmpty(page)
    expect(await tables(page)).toEqual([['a', 'b']])
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled() // only the earlier placement
  }
})

test('Ctrl/Cmd+Z inside a text field stays native and does not undo the diagram', async ({ page }) => {
  await setup(page, ['a'])
  const entry = page.getByLabel('New field')
  await entry.fill('hello')
  await entry.press('ControlOrMeta+z')
  await expect(relations(page)).toHaveCount(1)
  expect(await tables(page)).toEqual([['a']])
})

test('drag shortcuts: a form field onto a table copies it; an attribute onto empty canvas moves it', async ({ page }) => {
  await setup(page, ['a', 'b', 'c'])
  await expect(page.getByRole('toolbar', { name: 'Field actions' })).toHaveCount(0)

  // Field → table (onto the right half of "a": inserted after it).
  const src = (await field(page, 'c').boundingBox())!
  const a = (await anyCell(page, 'a').boundingBox())!
  await page.mouse.move(src.x + 20, src.y + src.height / 2)
  await page.mouse.down()
  await page.mouse.move(src.x + 60, src.y + 20, { steps: 4 })
  await page.mouse.move(a.x + a.width - 5, a.y + a.height / 2, { steps: 8 })
  await expect(page.locator('.drag-ghost')).toHaveText('Place 1 field')
  await expect(page.locator('.preview-bar')).toHaveCount(1)
  await page.mouse.up()
  expect(await tables(page)).toEqual([['a', 'c', 'b', 'c']])
  await expect(fieldList(page).getByRole('listitem')).toHaveCount(3) // never consumed
  await expect(field(page, 'c')).toHaveAttribute('aria-pressed', 'false') // the drag was not a click

  // Attribute → empty canvas moves it into a new table.
  const b = (await anyCell(page, 'b').boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + 40, b.y + 80, { steps: 4 })
  await page.mouse.move(b.x + 40, b.y + 220, { steps: 6 })
  await expect(page.locator('.preview-table')).toHaveCount(1)
  await page.mouse.up()
  expect(await tables(page)).toEqual([['a', 'c', 'c'], ['b']])

  // Each drag is one undo step, as with clicks.
  await page.getByRole('button', { name: 'Undo' }).click()
  expect(await tables(page)).toEqual([['a', 'c', 'b', 'c']])
})

test('selecting things or starting an operation never moves the canvas', async ({ page }) => {
  await setup(page, ['Een_lange_attribuutnaam', 'b', 'c'])
  const box = async () => (await canvas(page).boundingBox())!
  const start = await box()
  const steps = [
    () => anyCell(page, 'b').click(),
    () => relations(page).nth(0).locator('.relation-header').click(),
    () => anyCell(page, 'b').click(),
    () => action(page, 'Move').click(),
    () => page.keyboard.press('Escape'),
    () => action(page, 'Add to selection').click(),
    () => anyCell(page, 'c').click(),
    () => page.getByRole('button', { name: 'Delete' }).click(),
  ]
  for (const step of steps) {
    await step()
    expect(await box()).toEqual(start)
  }
})
