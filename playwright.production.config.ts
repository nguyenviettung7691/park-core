import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4174';

export default defineConfig({
  testDir: 'tests/production',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run preview -- --port 4174 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
  },
});
