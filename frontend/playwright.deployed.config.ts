import { defineConfig, devices } from '@playwright/test';

// Smoke tests against an already-deployed copy of the app (see docs/deployment-free-tier.md).
// No servers are started here. DEMO_URL is the public frontend URL; DEMO_EMPLOYEE_PASSWORD is the
// published demo password of the synthetic employee account.
const baseURL = process.env.DEMO_URL;
if (!baseURL) throw new Error('DEMO_URL must be set to the deployed frontend URL.');
if (!process.env.DEMO_EMPLOYEE_PASSWORD) throw new Error('DEMO_EMPLOYEE_PASSWORD must be set.');

export default defineConfig({
  testDir: './tests/smoke',
  outputDir: './test-results-deployed',
  // The first request may wake a sleeping free-tier service (about a minute), so be patient once.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
