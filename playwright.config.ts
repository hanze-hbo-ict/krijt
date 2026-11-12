import { defineConfig, devices } from '@playwright/test'

/**
 * E2E tests run against the production build (`vite preview`) by default, so
 * the CSP and bundled assets are exercised as deployed.
 * Set KRIJT_E2E_DEV=1 to run against the dev server instead.
 */
const dev = !!process.env.KRIJT_E2E_DEV
const port = dev ? 5189 : 4189

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: dev ? `npx vite --port ${port} --strictPort` : `npx vite build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
