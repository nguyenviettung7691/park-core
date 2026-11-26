import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';
import process from 'node:process';

const baseURL = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  updateSnapshots: 'none',
  snapshotPathTemplate: process.env.PARK_CORE_ASSET_BASELINES
    ? join(process.env.PARK_CORE_ASSET_BASELINES, '{arg}{ext}') : undefined,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev -- --port 4173',
    url: baseURL,
    reuseExistingServer: false,
  },
});
