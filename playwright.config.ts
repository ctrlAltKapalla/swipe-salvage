import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config for Swipe Salvage smoke tests.
 *
 * Run against Vite preview server (`npm run preview`).
 * Set BASE_URL env var to test against a deployed URL instead.
 *
 * CI: runs on ubuntu-latest with `npx playwright install --with-deps chromium`
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',

  // Suite must complete in < 30s (acceptance criteria)
  timeout: 30_000,
  globalTimeout: 60_000,

  // Fail fast — smoke tests should all pass
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Sequential — single Phaser instance

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'e2e-report' }],
  ],

  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:4173',
    // All test navigations append ?debug=1 to expose window.__game
    extraHTTPHeaders: {},
    // Headless in CI, headed locally for debugging
    headless: true,
    viewport: { width: 375, height: 667 }, // mobile-first baseline
    // Capture on failure
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start Vite preview server automatically when not using an external BASE_URL
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm run preview',
        url: 'http://localhost:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 15_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
