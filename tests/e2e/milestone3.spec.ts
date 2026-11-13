/** Milestone 3 workflows in real browsers: creating, selecting and deleting references; connectors follow their cells. */
import { expect, test, type Locator, type Page } from '@playwright/test'

const fieldList = (page: Page) => page.getByRole('list', { name: 'Form fields' })
const field = (page: Page, label: string) => fieldList(page).getByRole('button', { name: label, exact: true })
const canvas = (page: Page) => page.locator('.canvas-svg')
const relations = (page: Page) => page.locator('.relation')
const table = (page: Page, i: number) => relations(page).nth(i)
const cellIn = (rel: Locator, name: string) => rel.locator(`.cell[aria-label^="Attribute ${name} in"]`)
const action = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: 'Selection actions' }).getByRole('button', { name, exact: true })
/** Selects the foreign-key cells (one table) by clicks, then "Reference". */
async function referenceFrom(page: Page, cells: Locator[]) {
  await cells[0]!.click()
  if (cells.length > 1) await action(page, 'Add to selection').click()
  for (const c of cells.slice(1)) await c.click()
  await action(page, 'Reference').click()
}
const references = (page: Page) => page.locator('.reference')

async function clickEmpty(page: Page) {
  const box = (await canvas(page).boundingBox())!
  await canvas(page).click({ position: { x: box.width - 40, y: 30 } })
}

async function place(page: Page, names: string[], x: number, y: number) {
  for (const n of names) await field(page, n).click({ modifiers: ['Shift'] })
  await page.getByRole('toolbar', { name: 'Field actions' }).getByRole('button', { name: 'Place in diagram' }).click()
  await canvas(page).click({ position: { x, y } })
  await clickEmpty(page)
}

/** Order(ordernr, klantnr), Klant(klantnr, naam), Regel(ordernr, regelnr, aantal), Levering(ordernr, regelnr, levnr). */
async function setup(page: Page) {
  await page.goto('/')
  await page.getByLabel('New field').evaluate((el, t) => {
    const data = new DataTransfer()
    data.setData('text/plain', t + '\n')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, ['ordernr', 'klantnr', 'naam', 'regelnr', 'aantal', 'levnr'].join('\n'))
  await place(page, ['ordernr', 'klantnr'], 60, 80)
  await place(page, ['klantnr', 'naam'], 420, 80)
  await place(page, ['ordernr', 'regelnr', 'aantal'], 60, 230)
  await place(page, ['ordernr', 'regelnr', 'levnr'], 60, 380)
  await expect(relations(page)).toHaveCount(4)
}

/**
 * For every connector: the cells its two ends touch (the cell whose top or bottom edge holds the end point, the cells
 * under a brace, or only those under its member dots). Purely geometric, from the rendered SVG.
 */
async function attachments(page: Page): Promise<{ from: string[]; to: string[]; braces: number }[]> {
  return page.locator('.reference').evaluateAll((refs) => {
    const cells = [...document.querySelectorAll('.cell')].map((c) => {
      const box = c.querySelector('.cell-box')!
      return {
        label: (c.getAttribute('aria-label') ?? '').replace(/^Attribute (.*) in .*$/, '$1') + '@' + c.closest('.relation')!.getAttribute('data-relation-id'),
        x: +box.getAttribute('x')!,
        y: +box.getAttribute('y')!,
        w: +box.getAttribute('width')!,
        h: +box.getAttribute('height')!,
      }
    })
    const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
    // Cells under an end: a single end touches one cell's edge; a brace end spans the cells under the brace.
    const under = (x1: number, x2: number, y: number) =>
      cells
        .filter((c) => c.x + c.w > x1 && c.x < x2 && (Math.abs(y - c.y) <= 14 || Math.abs(y - (c.y + c.h)) <= 14))
        .map((c) => c.label)
    return refs.map((g) => {
      const pts = numbers(g.querySelector('.reference-line')!.getAttribute('d')!)
      const start = { x: pts[0]!, y: pts[1]! }
      const end = { x: pts[pts.length - 2]!, y: pts[pts.length - 1]! }
      const braces = [...g.querySelectorAll('.reference-brace')].map((b) => {
        const n = numbers(b.getAttribute('d')!)
        return { x1: n[0]!, x2: n[n.length - 2]!, y: n[1]! }
      })
      // A brace that also spans non-members marks its members with dots.
      const dots = [...g.querySelectorAll('.reference-dot')].map((d) => ({ x: +d.getAttribute('cx')!, y: +d.getAttribute('cy')! }))
      const endCells = (p: { x: number; y: number }) => {
        const brace = braces.find((b) => Math.abs((b.x1 + b.x2) / 2 - p.x) < 0.6 && Math.abs(b.y - p.y) <= 11)
        if (!brace) return under(p.x - 0.5, p.x + 0.5, p.y)
        const members = dots.filter((d) => d.x >= brace.x1 && d.x <= brace.x2 && Math.abs(d.y - brace.y) <= 6)
        return members.length ? members.flatMap((d) => under(d.x - 0.5, d.x + 0.5, brace.y)) : under(brace.x1, brace.x2, brace.y)
      }
      return { from: endCells(start), to: endCells(end), braces: braces.length }
    })
  })
}

/** Clicks the middle of a connector's longest segment, in screen coordinates. */
async function clickConnector(page: Page, index: number) {
  const point = await references(page)
    .nth(index)
    .evaluate((g) => {
      const path = g.querySelector('.reference-line') as SVGPathElement
      const n = (path.getAttribute('d')!.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
      let best = { len: -1, x: 0, y: 0 }
      for (let i = 2; i + 1 < n.length; i += 2) {
        const len = Math.hypot(n[i]! - n[i - 2]!, n[i + 1]! - n[i - 1]!)
        if (len > best.len) best = { len, x: (n[i]! + n[i - 2]!) / 2, y: (n[i + 1]! + n[i - 1]!) / 2 }
      }
      const m = path.getScreenCTM()!
      return { x: best.x * m.a + best.y * m.c + m.e, y: best.x * m.b + best.y * m.d + m.f }
    })
  await page.mouse.click(point.x, point.y)
}

test.beforeEach(async ({ page }) => {
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (url.hostname !== 'localhost' && !url.protocol.startsWith('data') && !url.protocol.startsWith('blob'))
      throw new Error(`Unexpected request: ${req.url()}`)
  })
})

test('acceptance: a simple and a composite foreign key stay attached after moving and reordering — clicks only', async ({ page }) => {
  await setup(page)
  const [order, klant, regel, levering] = [0, 1, 2, 3].map((i) => table(page, i)) as [Locator, Locator, Locator, Locator]

  // Simple reference: select the foreign key, "Reference", click the referenced attribute.
  await referenceFrom(page, [cellIn(order, 'klantnr')])
  await expect(action(page, 'Reference')).toHaveAttribute('aria-pressed', 'true')
  await cellIn(klant, 'klantnr').click()
  await expect(references(page)).toHaveCount(1)
  await expect(references(page).first()).toHaveAttribute('aria-label', 'Reference from unnamed table (klantnr) to unnamed table (klantnr)')
  await expect(page.getByRole('button', { name: 'Delete reference' })).toBeVisible() // the new reference is selected

  // Composite reference: hovering a cell previews the block of two it would pick, with numbers and a connector.
  await clickEmpty(page)
  await referenceFrom(page, [cellIn(levering, 'ordernr'), cellIn(levering, 'regelnr')])
  await cellIn(regel, 'ordernr').hover()
  await expect(cellIn(regel, 'regelnr')).toHaveAttribute('aria-description', 'referenced 2')
  await expect(page.locator('.preview-reference')).toHaveCount(1)
  await cellIn(regel, 'ordernr').click()
  await expect(references(page)).toHaveCount(2)
  await expect(page.locator('.preview-reference')).toHaveCount(0)

  const ids = await relations(page).evaluateAll((rs) => rs.map((r) => r.getAttribute('data-relation-id')!))
  const expected = [
    { from: [`klantnr@${ids[0]}`], to: [`klantnr@${ids[1]}`], braces: 0 },
    { from: [`ordernr@${ids[3]}`, `regelnr@${ids[3]}`], to: [`ordernr@${ids[2]}`, `regelnr@${ids[2]}`], braces: 2 },
  ]
  expect(await attachments(page)).toEqual(expected)

  // Move Klant and Regel with "Move table" and a click; an outline shows where.
  await clickEmpty(page)
  // Click the grip at the header's left end: a connector may cross the middle of a header, and wins there.
  await klant.locator('.relation-header').click({ position: { x: 8, y: 12 } })
  await page.getByRole('button', { name: 'Move table' }).click()
  await canvas(page).hover({ position: { x: 480, y: 330 } })
  await expect(page.locator('.preview-table')).toHaveCount(2) // header band and strip
  await canvas(page).click({ position: { x: 480, y: 330 } })
  await regel.locator('.relation-header').click({ position: { x: 8, y: 12 } })
  await page.getByRole('button', { name: 'Move table' }).click()
  await canvas(page).click({ position: { x: 380, y: 520 } })
  // Reorder: klantnr to the front of Order, levnr to the front of Levering.
  await cellIn(order, 'klantnr').click()
  await page.keyboard.press('ArrowLeft')
  await cellIn(levering, 'levnr').click()
  await page.keyboard.press('ArrowLeft') // one press: it jumps over the (ordernr, regelnr) block
  expect(await attachments(page)).toEqual(expected)

  // Undo the reorders and moves: still attached at every step.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('ControlOrMeta+z')
    expect(await attachments(page)).toEqual(expected)
  }

  // Reload restores both references.
  await page.waitForTimeout(600)
  await page.reload()
  await expect(references(page)).toHaveCount(2)
  expect(await attachments(page)).toEqual(expected)
})

test('a connector is selected by clicking it, and deleted with the button or Delete, undoably', async ({ page }) => {
  await setup(page)
  await referenceFrom(page, [cellIn(table(page, 0), 'klantnr')])
  await cellIn(table(page, 1), 'klantnr').click()
  await clickEmpty(page)
  await expect(page.getByRole('button', { name: 'Delete reference' })).toHaveCount(0)

  await clickConnector(page, 0)
  await expect(references(page).first()).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Delete reference' })).toBeVisible()
  // Both ends are marked on their cells.
  await expect(cellIn(table(page, 0), 'klantnr')).toHaveAttribute('data-ref-role', 'source')
  await expect(cellIn(table(page, 1), 'klantnr')).toHaveAttribute('data-ref-role', 'target')
  await page.getByRole('button', { name: 'Delete reference' }).click()
  await expect(references(page)).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(references(page)).toHaveCount(1)

  await clickConnector(page, 0)
  await page.keyboard.press('Delete')
  await expect(references(page)).toHaveCount(0)
})

test('impossible references are explained, Escape cancels, and deleting an attribute removes its reference', async ({ page }) => {
  await setup(page)
  await referenceFrom(page, [cellIn(table(page, 0), 'klantnr')])
  await cellIn(table(page, 0), 'klantnr').click()
  await expect(page.getByRole('alert')).toContainText('cannot refer to itself')
  await page.keyboard.press('Escape') // ends the operation (and its message); the selection stays
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(action(page, 'Reference')).toHaveAttribute('aria-pressed', 'false')
  await expect(references(page)).toHaveCount(0)

  // Make one, then delete the referenced attribute: the reference goes with it, and one undo restores both.
  await action(page, 'Reference').click()
  await cellIn(table(page, 1), 'klantnr').click()
  await clickEmpty(page)
  await cellIn(table(page, 1), 'klantnr').click()
  await page.keyboard.press('Delete')
  await expect(page.getByRole('status').filter({ hasText: 'Deleted 1 attribute and 1 reference that used it.' })).toBeVisible()
  await expect(references(page)).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(references(page)).toHaveCount(1)
  await expect(cellIn(table(page, 1), 'klantnr')).toHaveCount(1)
})

test('a composite end moves as a unit, and can be reordered inside with ← →', async ({ page }) => {
  await setup(page)
  await referenceFrom(page, [cellIn(table(page, 3), 'regelnr'), cellIn(table(page, 3), 'ordernr')]) // click order does not matter
  await cellIn(table(page, 2), 'ordernr').click()
  await clickEmpty(page)

  // ← on levnr jumps over the whole (ordernr, regelnr) block in one press.
  await cellIn(table(page, 3), 'levnr').click()
  await page.keyboard.press('ArrowLeft')
  const names = (i: number) =>
    table(page, i)
      .locator('.cell')
      .evaluateAll((cs) => cs.map((c) => (c.getAttribute('aria-label') ?? '').replace(/^Attribute (.*) in .*$/, '$1')))
  expect(await names(3)).toEqual(['levnr', 'ordernr', 'regelnr'])

  // → on one member reorders inside the end; the numbers show the new left-to-right pairing.
  await cellIn(table(page, 3), 'ordernr').click()
  await page.keyboard.press('ArrowRight')
  expect(await names(3)).toEqual(['levnr', 'regelnr', 'ordernr'])
  await page.keyboard.press('Escape') // the selection's toolbar floats over the connector
  await clickEmpty(page)
  await clickConnector(page, 0)
  await expect(cellIn(table(page, 3), 'regelnr')).toHaveAttribute('aria-description', 'foreign key 1')
  await expect(cellIn(table(page, 2), 'ordernr')).toHaveAttribute('aria-description', 'referenced 1')
  await clickEmpty(page)

  // Moving just regelnr brings ordernr along.
  await cellIn(table(page, 3), 'regelnr').click()
  await action(page, 'Move').click()
  await canvas(page).click({ position: { x: 600, y: 560 } })
  await expect(page.getByRole('status').filter({ hasText: 'Moved ordernr along, to keep the reference together.' })).toBeVisible()
  await expect(relations(page)).toHaveCount(5)
  expect(await names(3)).toEqual(['levnr'])
  expect(await names(4)).toEqual(['regelnr', 'ordernr'])
  expect((await attachments(page))[0]!.braces).toBe(2)
})
