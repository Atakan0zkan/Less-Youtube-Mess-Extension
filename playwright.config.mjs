import { defineConfig } from '@playwright/test';

// AI-less fixture E2E. No live YouTube, no tokens.
// Runs in CI blocking job with: npx playwright install chromium && npm run test:e2e
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.mjs',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
});
