/** Milestone 4 in real browsers: Copy image / Copy data, clipboard errors, Clear diagram, recovery, a larger diagram. */
import { expect, test, type Page } from '@playwright/test'

const SESSION_KEY = 'krijt:v1:session'
const canvas = (page: Page) => page.locator('.canvas-svg')
const relations = (page: Page) => page.locator('.relation')
const copyImage = (page: Page) => page.getByRole('button', { name: 'Copy as image' })
const copyData = (page: Page) => page.getByRole('button', { name: 'Copy as text' })
const status = (page: Page) => page.locator('.bar-message.info')
const alert = (page: Page) => page.locator('.bar-message.error')

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
    await expect(status(page)).toHaveText(/Image copied/)

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
        if (b - r > 60 || r - b > 60) colored++ // selection blue, amber/teal end marks
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
    await expect(status(page)).toHaveText('Diagram data copied as text.')
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
    await expect(alert(page)).toHaveText(/blocked the clipboard.*Copy as image again/)
    await expect(status(page)).toHaveCount(0)
    await copyData(page).click()
    await expect(alert(page)).toHaveText(/blocked the clipboard.*Copy as text again/)
    await expect(copyImage(page)).toBeEnabled()
  })

  test('a browser without image clipboard support says so', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as { ClipboardItem?: unknown }).ClipboardItem
    })
    await openWith(page, SAMPLE)
    await copyImage(page).click()
    await expect(alert(page)).toHaveText(/cannot put images on the clipboard/)
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

test('corrupt recovery data starts an empty diagram with a notice, without crashing', async ({ page }) => {
  await openWithRaw(page, '{"version":1,"doc":{"format":"krijt","relations":[{')
  await expect(alert(page)).toHaveText(/could not be restored/)
  await expect(relations(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Paste a list of fields' })).toBeVisible()
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

test('names accept letters of any script, dashes and underscores; typing a space gives an underscore', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Paste a list of fields' }).click()
  await page.getByLabel('One field per line').fill('Datum (dd-mm)\nΑριθμός πελάτη')
  await page.getByRole('button', { name: /^Add \d+ fields$/ }).click()
  const list = page.getByRole('list', { name: 'Form fields' })
  await list.getByRole('button', { name: 'Datum (dd-mm)', exact: true }).click()
  await list.getByRole('button', { name: 'Αριθμός πελάτη', exact: true }).click()
  await page.getByRole('button', { name: 'Place in diagram' }).click()
  await canvas(page).click({ position: { x: 60, y: 80 } })
  // Labels with spaces and punctuation become valid names; the form fields keep their text.
  await expect(page.locator('.cell[aria-label^="Attribute Datum_dd-mm in"]')).toHaveCount(1)
  await expect(page.locator('.cell[aria-label^="Attribute Αριθμός_πελάτη in"]')).toHaveCount(1)
  await expect(list.getByRole('button', { name: 'Datum (dd-mm)', exact: true })).toBeVisible()

  // Typing a name: spaces become underscores, characters that are not allowed do not appear; on Enter, repeated
  // underscores become one.
  await page.getByRole('button', { name: 'Name table' }).click()
  const input = page.getByLabel('Table name (leave empty for an unnamed table)')
  await input.pressSequentially('Klant gegevens (€) 2-a')
  await expect(input).toHaveValue('Klant_gegevens__2-a')
  await input.press('Enter')
  await expect(page.locator('.relation-name')).toHaveText('KLANT_GEGEVENS_2-A')
})
