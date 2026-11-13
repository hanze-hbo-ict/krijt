import { defineConfig, devices } from '@playwright/test'

/**
 * E2E tests run against the production build (`vite preview`) by default, so
 * the CSP and bundled assets are exercised as deployed.
 * Set KRIJT_E2E_DEV=1 to run against the dev server instead.
 */
const dev = !!process.env.KRIJT_E2E_DEV
const port = dev ? 5189 : 4189
const VIEWPORT = { width: 1280, height: 1000 }

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  projects: [
    // A taller window than the 720px default: the page chrome (as in Krash) leaves the diagram the window height
    // minus 265px, and the tests click diagram positions down to y≈560.
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: VIEWPORT } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: VIEWPORT } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: VIEWPORT } },
  ],
  webServer: {
    command: dev ? `npx vite --port ${port} --strictPort` : `npx vite build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
