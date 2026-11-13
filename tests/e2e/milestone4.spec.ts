/** Milestone 4 in real browsers: Copy image / Copy data, clipboard errors, Clear diagram, recovery, a larger diagram. */
import { expect, test, type Page } from '@playwright/test'

const SESSION_KEY = 'krijt:v1:session'
const canvas = (page: Page) => page.locator('.canvas-svg')
const relations = (page: Page) => page.locator('.relation')
const copyImage = (page: Page) => page.getByRole('button', { name: 'Copy as image' })
const copyData = (page: Page) => page.getByRole('button', { name: 'Copy as text' })
const alert = (page: Page) => page.getByRole('alertdialog')
/** Closes the error dialog with its OK button. */
const dismiss = (page: Page) => alert(page).getByRole('button', { name: 'OK' }).click()

const attr = (id: string, name: string, flags: Partial<Record<'primaryKey' | 'nullable' | 'calculated', boolean>> = {}) => ({
  id,
  name,
  primaryKey: false,
  nullable: false,
  calculated: false,
  ...flags,
})

/** Klant(klantnr PK, naam), Order(ordernr PK, klantnr, /totaal ᵒ) → Klant; Levering(ordernr, regelnr) → Regel(ordernr, regelnr). */
const SAMPLE = {
  format: 'krijt',
  version: 1,
  sourceFields: [{ id: 'f1', label: 'klantnr' }],
  relations: [
    { id: 'k', name: 'Klant', position: { x: 0, y: 0 }, attributes: [attr('k1', 'klantnr', { primaryKey: true }), attr('k2', 'naam')] },
    {
      id: 'o',
      name: null,
      position: { x: 0, y: 160 },
      attributes: [attr('o1', 'ordernr', { primaryKey: true }), attr('o2', 'klantnr'), attr('o3', 'totaal', { calculated: true, nullable: true })],
    },
    { id: 'r', name: 'Regel', position: { x: 360, y: 0 }, attributes: [attr('r1', 'ordernr', { primaryKey: true }), attr('r2', 'regelnr', { primaryKey: true })] },
    { id: 'l', name: null, position: { x: 360, y: 160 }, attributes: [attr('l1', 'ordernr'), attr('l2', 'regelnr'), attr('l3', 'datum')] },
  ],
  references: [
    { id: 'x', from: { relationId: 'o', attributeIds: ['o2'] }, to: { relationId: 'k', attributeIds: ['k1'] } },
    { id: 'y', from: { relationId: 'l', attributeIds: ['l1', 'l2'] }, to: { relationId: 'r', attributeIds: ['r1', 'r2'] } },
  ],
}

/**
 * Opens Krijt with `raw` already in sessionStorage, as if this tab had saved it. The value is written before any
 * app script runs, once per tab (a marker keeps later reloads in the test from writing it again).
 */
async function openWithRaw(page: Page, raw: string) {
  await page.addInitScript(
    ([key, value]) => {
      if (sessionStorage.getItem('krijt-test:seeded')) return
      sessionStorage.setItem('krijt-test:seeded', '1')
      sessionStorage.setItem(key!, value!)
    },
    [SESSION_KEY, raw],
  )
  await page.goto('/')
}
const openWith = (page: Page, doc: unknown) =>
  openWithRaw(page, JSON.stringify({ version: 1, doc, ui: { viewport: { x: 40, y: 60, zoom: 1 }, sidebarWidth: 280 } }))

test.beforeEach(async ({ page }) => {
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (url.hostname !== 'localhost' && !url.protocol.startsWith('data') && !url.protocol.startsWith('blob'))
      throw new Error(`Unexpected request: ${req.url()}`)
  })
})

test.describe('real clipboard (Chromium)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'only Chromium lets tests grant and read the clipboard')
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  })

  test('Copy image puts a cropped, opaque PNG on the clipboard without any selection UI', async ({ page }) => {
    await openWith(page, SAMPLE)
    await expect(relations(page)).toHaveCount(4)
    // Leave something selected: the export must not show it.
    await page.locator('.cell[aria-label^="Attribute naam in"]').click()
    await copyImage(page).click()
    await expect(copyImage(page)).toHaveAttribute('data-tooltip', 'Copied') // a checkmark, no message

    const png = await page.evaluate(async () => {
      const items = await navigator.clipboard.read()
      const item = items.find((i) => i.types.includes('image/png'))
      if (!item) return null
      const blob = await item.getType('image/png')
      const bitmap = await createImageBitmap(blob)
      const c = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx = c.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      let dark = 0
      let colored = 0
      let transparent = 0
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b, a] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!]
        if (a < 255) transparent++
        if (r + g + b < 200) dark++
        if (b - r > 60 || r - b > 60) colored++ // selection and end-mark blue
      }
      const px = (x: number, y: number) => [...data.slice((y * bitmap.width + x) * 4, (y * bitmap.width + x) * 4 + 4)]
      return { type: blob.type, width: bitmap.width, height: bitmap.height, corner: px(0, 0), dark, colored, transparent }
    })
    expect(png).not.toBeNull()
    expect(png!.type).toBe('image/png')
    // 2× of content (≈ 700 × 270 units with margins and connectors).
    expect(png!.width).toBeGreaterThan(1200)
    expect(png!.width).toBeLessThan(2000)
    expect(png!.height).toBeGreaterThan(450)
    expect(png!.corner).toEqual([255, 255, 255, 255])
    expect(png!.transparent).toBe(0)
    expect(png!.dark).toBeGreaterThan(2000)
    expect(png!.colored).toBeLessThan(50) // anti-aliasing only; no selection colours
  })

  test('Copy data puts the diagram on the clipboard as plain text', async ({ page }) => {
    await openWith(page, SAMPLE)
    await copyData(page).click()
    await expect(copyData(page)).toHaveAttribute('data-tooltip', 'Copied')
    const text = await page.evaluate(() => navigator.clipboard.readText())
    expect(text).toBe(
      [
        'KLANT',
        '  *klantnr*',
        '  naam',
        '',
        '#1',
        '  *ordernr*',
        '  klantnr → KLANT.klantnr',
        '  /totaal°',
        '',
        'REGEL',
        '  *ordernr*',
        '  *regelnr*',
        '',
        '#2',
        '  ordernr',
        '  regelnr',
        '  datum',
        '  (ordernr, regelnr) → REGEL(ordernr, regelnr)',
        '',
      ].join('\n'),
    )
  })
})

test.describe('clipboard errors (all browsers)', () => {
  test('a blocked clipboard shows an error and never claims success', async ({ page }) => {
    await page.addInitScript(() => {
      const reject = () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'))
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: reject, writeText: reject } })
      ;(window as unknown as { ClipboardItem: unknown }).ClipboardItem ??= class {
        items: unknown
        constructor(items: unknown) {
          this.items = items
        }
      }
    })
    await openWith(page, SAMPLE)
    await copyImage(page).click()
    await expect(alert(page)).toContainText(/blocked the clipboard.*Copy as image again/)
    await expect(alert(page).getByRole('heading')).toHaveText('Could not copy')
    await expect(alert(page).getByRole('button', { name: 'OK' })).toBeFocused()
    await dismiss(page)
    await expect(alert(page)).toHaveCount(0)
    await copyData(page).click()
    await expect(alert(page)).toContainText(/blocked the clipboard.*Copy as text again/)
    await page.keyboard.press('Escape') // closes it too
    await expect(alert(page)).toHaveCount(0)
    await expect(copyImage(page)).toBeEnabled()
  })

  test('a browser without image clipboard support says so', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as { ClipboardItem?: unknown }).ClipboardItem
    })
    await openWith(page, SAMPLE)
    await copyImage(page).click()
    await expect(alert(page)).toContainText(/cannot put images on the clipboard/)
  })

  test('Copy image and Copy data are unavailable for an empty diagram', async ({ page }) => {
    await page.goto('/')
    await expect(copyImage(page)).toBeDisabled()
    await expect(copyData(page)).toBeDisabled()
  })
})

test('Clear diagram asks first, can keep the form fields, is undoable, and the recovery copy follows', async ({ page }) => {
  await openWith(page, SAMPLE)
  await page.getByRole('button', { name: 'Clear diagram', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Clear the diagram?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(relations(page)).toHaveCount(4)

  await page.getByRole('button', { name: 'Clear diagram', exact: true }).click()
  await dialog.getByRole('button', { name: 'Clear diagram, keep form fields' }).click()
  await expect(relations(page)).toHaveCount(0)
  await expect(page.locator('.reference')).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Form fields' }).getByRole('button', { name: 'klantnr', exact: true })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(relations(page)).toHaveCount(4)

  await page.getByRole('button', { name: 'Clear diagram', exact: true }).click()
  await dialog.getByRole('button', { name: 'Clear everything' }).click()
  await expect(relations(page)).toHaveCount(0)
  await page.reload()
  await expect(relations(page)).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Form fields' }).getByRole('button')).toHaveCount(0)
})

test('corrupt recovery data starts an empty diagram and says so, without crashing', async ({ page }) => {
  await openWithRaw(page, '{"version":1,"doc":{"format":"krijt","relations":[{')
  await expect(alert(page)).toContainText(/could not be restored/)
  await dismiss(page)
  await expect(relations(page)).toHaveCount(0)
  await expect(page.getByLabel('New field')).toBeVisible()
})

test('a change right before a reload is not lost', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('New field').fill('klantnummer')
  await page.getByLabel('New field').press('Enter')
  await page.reload() // no wait for the debounce: the page saves when it goes away
  await expect(page.getByRole('list', { name: 'Form fields' }).getByRole('button', { name: 'klantnummer', exact: true })).toBeVisible()
})

test('a realistic exam diagram (25 fields, 10 tables, 12 references) stays responsive', async ({ page }) => {
  const fields = Array.from({ length: 25 }, (_, i) => ({ id: `f${i}`, label: `veld${i}` }))
  const rels = Array.from({ length: 10 }, (_, t) => ({
    id: `t${t}`,
    name: t % 2 ? `Tabel${t}` : null,
    position: { x: (t % 4) * 300, y: Math.floor(t / 4) * 170 },
    attributes: Array.from({ length: 5 }, (_, a) => attr(`t${t}a${a}`, `attr${t}_${a}`, { primaryKey: a === 0 })),
  }))
  const refs = Array.from({ length: 12 }, (_, i) => {
    const from = i % 10
    const to = (i + 3) % 10
    return i < 9
      ? { id: `k${i}`, from: { relationId: `t${from}`, attributeIds: [`t${from}a${1 + (i % 3)}`] }, to: { relationId: `t${to}`, attributeIds: [`t${to}a0`] } }
      : { id: `k${i}`, from: { relationId: `t${from}`, attributeIds: [`t${from}a3`, `t${from}a4`] }, to: { relationId: `t${to}`, attributeIds: [`t${to}a0`, `t${to}a1`] } }
  })
  await openWith(page, { format: 'krijt', version: 1, sourceFields: fields, relations: rels, references: refs })
  await expect(relations(page)).toHaveCount(10)
  await expect(page.locator('.reference')).toHaveCount(12)

  // Time a few interactions from input to rendered result.
  const timed = async (action: () => Promise<void>) => {
    const start = Date.now()
    await action()
    return Date.now() - start
  }
  const cell = page.locator('.cell[aria-label^="Attribute attr5_2 in"]')
  const times = [
    await timed(async () => {
      await cell.click()
      await expect(cell).toHaveAttribute('aria-pressed', 'true')
    }),
    await timed(async () => {
      await page.keyboard.press('ArrowRight')
      await expect(page.locator('.cell[aria-label^="Attribute attr5_2 in"]')).toHaveAttribute('aria-pressed', 'true')
    }),
    await timed(async () => {
      const start = page.getByRole('toolbar', { name: 'Selection actions' }).getByRole('button', { name: 'Reference', exact: true })
      await start.click()
      await expect(start).toHaveAttribute('aria-pressed', 'true')
      await page.keyboard.press('Escape')
    }),
  ]
  for (const t of times) expect(t).toBeLessThan(1000)
  await expect(canvas(page)).toBeVisible()
})

test('names (and form fields) accept letters of any script, dashes and underscores; typing a space gives an underscore', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('New field').evaluate((el, t) => {
    const data = new DataTransfer()
    data.setData('text/plain', t + '\n')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, 'Datum (dd-mm)\nΑριθμός πελάτη')
  // Pasted lines with spaces and punctuation become valid names in the list already.
  const list = page.getByRole('list', { name: 'Form fields' })
  await list.getByRole('button', { name: 'Datum_dd-mm', exact: true }).click()
  await list.getByRole('button', { name: 'Αριθμός_πελάτη', exact: true }).click({ modifiers: ['Shift'] })
  await page.getByRole('button', { name: 'Place in diagram' }).click()
  await canvas(page).click({ position: { x: 60, y: 80 } })
  await expect(page.locator('.cell[aria-label^="Attribute Datum_dd-mm in"]')).toHaveCount(1)
  await expect(page.locator('.cell[aria-label^="Attribute Αριθμός_πελάτη in"]')).toHaveCount(1)

  // Typing a field filters as it goes, as a name does.
  await page.getByLabel('New field').pressSequentially('Klant nr. (€)')
  await expect(page.getByLabel('New field')).toHaveValue('Klant_nr_') // the trailing underscore goes when it is added
  await page.getByLabel('New field').press('Enter')
  await expect(list.getByRole('button', { name: 'Klant_nr', exact: true })).toBeVisible()

  // Typing a name: spaces become underscores, characters that are not allowed do not appear; on Enter, repeated
  // underscores become one.
  await page.getByRole('button', { name: 'Name table' }).click()
  const input = page.getByLabel('Table name (leave empty for an unnamed table)')
  await input.pressSequentially('Klant gegevens (€) 2-a')
  await expect(input).toHaveValue('Klant_gegevens__2-a')
  await input.press('Enter')
  await expect(page.locator('.relation-name')).toHaveText('KLANT_GEGEVENS_2-A')
})

test('a dragged table snaps into alignment with other tables, unless Shift is held', async ({ page }) => {
  await openWith(page, SAMPLE)
  const klant = page.locator('.relation[data-relation-id="k"]')
  const strip = () => klant.locator('.cell-box').first().boundingBox().then((b) => b!)
  const drag = async (dx: number, dy: number, shift: boolean) => {
    const h = (await klant.locator('.relation-header').boundingBox())!
    await page.mouse.move(h.x + 8, h.y + h.height / 2)
    if (shift) await page.keyboard.down('Shift')
    await page.mouse.down()
    await page.mouse.move(h.x + 8 + dx, h.y + h.height / 2 + dy, { steps: 6 })
    if (!shift) await expect(page.locator('.snap-guide')).not.toHaveCount(0) // a guide line has no area, so not 'visible'
    await page.mouse.up()
    if (shift) await page.keyboard.up('Shift')
  }
  const start = await strip()
  // 3px off the left edge shared with Order: snaps back into line, 80px down stays as dragged.
  await drag(3, 80, false)
  let b = await strip()
  expect(Math.round(b.x - start.x)).toBe(0)
  expect(Math.round(b.y - start.y)).toBe(80)
  await expect(page.locator('.snap-guide')).toHaveCount(0)
  // With Shift the same nudge is kept.
  await drag(3, 40, true)
  b = await strip()
  expect(Math.round(b.x - start.x)).toBe(3)
  expect(Math.round(b.y - start.y)).toBe(120)
})

test('Move table also snaps the clicked place into alignment', async ({ page }) => {
  await openWith(page, SAMPLE)
  const regel = page.locator('.relation[data-relation-id="r"]')
  const order = page.locator('.relation[data-relation-id="o"] .cell-box').first()
  const o = (await order.boundingBox())!
  await regel.locator('.relation-header').click({ position: { x: 8, y: 12 } })
  await page.getByRole('button', { name: 'Move table' }).click()
  // Aim 4px right of Order's left edge, well below it: the strip lands exactly under Order.
  await page.mouse.move(o.x + 4, o.y + 200 + o.height / 2, { steps: 4 })
  await expect(page.locator('.snap-guide')).not.toHaveCount(0) // a guide line has no area, so not 'visible'
  await page.mouse.click(o.x + 4, o.y + 200 + o.height / 2)
  const b = (await regel.locator('.cell-box').first().boundingBox())!
  expect(Math.round(b.x - o.x)).toBe(0)
  expect(Math.round(b.y - o.y)).toBe(200)
})

test('attributes dragged to empty canvas make a new table that snaps into alignment', async ({ page }) => {
  await openWith(page, SAMPLE)
  const o = (await page.locator('.relation[data-relation-id="o"] .cell-box').first().boundingBox())!
  const naam = (await page.locator('.cell[aria-label^="Attribute naam in"]').boundingBox())!
  await page.mouse.move(naam.x + naam.width / 2, naam.y + naam.height / 2)
  await page.mouse.down()
  // 2px right of Order's left edge (and nearer it than any other line): the new table lines up with Order.
  await page.mouse.move(o.x + 2, o.y + 200 + o.height / 2, { steps: 8 })
  await expect(page.locator('.snap-guide')).not.toHaveCount(0) // a guide line has no area, so not 'visible'
  await page.mouse.up()
  const moved = (await page.locator('.cell[aria-label^="Attribute naam in"] .cell-box').boundingBox())!
  expect(Math.round(moved.x - o.x)).toBe(0)
  expect(Math.round(moved.y - o.y)).toBe(200)
})

test('a dragged table snaps so a reference to a table above it runs straight', async ({ page }) => {
  await openWith(page, SAMPLE)
  const fk = page.locator('.relation[data-relation-id="o"] .cell[aria-label^="Attribute klantnr in"] .cell-box')
  const pk = page.locator('.relation[data-relation-id="k"] .cell[aria-label^="Attribute klantnr in"] .cell-box')
  const centre = async (l: typeof fk) => {
    const b = (await l.boundingBox())!
    return b.x + b.width / 2
  }
  const offBy = (await centre(fk)) - (await centre(pk))
  // Drag Order left until its klantnr is 3px right of Klant's: it snaps the rest of the way.
  const h = (await page.locator('.relation[data-relation-id="o"] .relation-header').boundingBox())!
  await page.mouse.move(h.x + 8, h.y + h.height / 2)
  await page.mouse.down()
  await page.mouse.move(h.x + 8 - offBy + 3, h.y + h.height / 2, { steps: 8 })
  await expect(page.locator('.snap-guide')).not.toHaveCount(0)
  await page.mouse.up()
  // Table positions are whole numbers and a cell's middle may lie half-way: within half a pixel.
  expect(Math.abs((await centre(fk)) - (await centre(pk)))).toBeLessThanOrEqual(0.5)
  // One straight segment from foreign key to referenced end.
  const d = await page.locator('.reference[data-reference="x"] .reference-line').getAttribute('d')
  expect(d!.match(/L/g)).toHaveLength(1)
})
