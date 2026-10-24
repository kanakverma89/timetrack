import { defineConfig, devices } from '@playwright/test';

// Pick up the repo-root .env for local runs (CI provides real environment variables).
try {
  process.loadEnvFile('../.env');
} catch {
  // no .env file: rely on the process environment
}

const API_PORT = 8100;
const WEB_PORT = 5174;
const E2E_DB = 'timetrack_e2e';

function e2eDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL must be set (see .env.example) to run E2E tests.');
  const url = new URL(base.replace(/^postgresql\+psycopg:/, 'postgresql:'));
  url.pathname = `/${E2E_DB}`;
  return url.toString().replace(/^postgresql:/, 'postgresql+psycopg:');
}

if (!process.env.SEED_PASSWORD) {
  throw new Error('SEED_PASSWORD must be set (see .env.example) to run E2E tests.');
}

const python = process.env.BACKEND_PYTHON ?? '.venv/bin/python';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    {
      // Recreates the disposable E2E database, migrates and seeds it, then serves the API.
      command: `${python} scripts/prepare_db.py ${E2E_DB} --seed && ${python} -m uvicorn app.main:app --host 127.0.0.1 --port ${API_PORT}`,
      cwd: '../backend',
      url: `http://127.0.0.1:${API_PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: e2eDatabaseUrl(),
        CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
        APP_ENV: 'test',
        LOG_LEVEL: 'WARNING',
        LOGIN_MAX_ATTEMPTS: '1000', // parallel browsers sign in repeatedly from one address
        // Weekly policy so submission-time rules can be exercised end to end.
        MAX_HOURS_PER_DAY: '16',
        MAX_HOURS_PER_WEEK: '60',
        SEED_PASSWORD: process.env.SEED_PASSWORD,
      },
    },
    {
      command: 'npm run dev',
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: String(WEB_PORT), VITE_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
