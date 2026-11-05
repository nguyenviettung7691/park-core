import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });

async function fillCiMetadata(page: Page, browserVersion: string) {
  const values: Record<string, string> = {
    cpu: 'CI runner CPU (explicit test metadata)',
    gpu: 'CI runner GPU (explicit test metadata)',
    ram: 'CI runner RAM (explicit test metadata)',
    os: 'CI runner OS (explicit test metadata)',
    driver: 'CI runner driver (explicit test metadata)',
    browser: browserVersion,
    refresh: '60',
  };
  for (const [key, value] of Object.entries(values)) await page.locator(`#meta-${key}`).fill(value);
  await page.locator('#meta-confirm-zoom').check();
}

async function beginCase(page: Page) {
  await page.locator('#benchmark-start').click();
  await expect(page.locator('#benchmark-lock')).toBeVisible({ timeout: 60000 });
  await page.locator('#benchmark-lock').click();
  await expect(page.locator('#benchmark-canvas')).toBeVisible();
}

test('built benchmark page serves its assets and blocks start without metadata', async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const built: { path: string; status: number }[] = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === new URL(baseURL!).origin && /^\/assets\/.+\.(js|css)$/.test(url.pathname)) {
      built.push({ path: url.pathname, status: response.status() });
    }
  });
  await page.goto('/benchmark.html');
  await expect(page.getByRole('heading', { name: 'Park-Core — Kiểm tra hiệu năng' })).toBeVisible();
  expect(built.some((a) => a.path.endsWith('.js'))).toBe(true);
  expect(built.some((a) => a.path.endsWith('.css'))).toBe(true);
  expect(built.every((a) => a.status === 200)).toBe(true);
  await page.locator('#benchmark-start').click();
  await expect(page.getByRole('alert')).toContainText('Thiếu thông tin');
  await expect(page.locator('#benchmark-canvas')).toHaveCount(0);
  await expect(page.locator('#benchmark-export')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('resizing during warm-up interrupts the case instead of measuring', async ({ page, browserName }) => {
  // Playwright's Firefox setViewportSize stalls while pointer lock is held; jsdom page tests cover resize invalidation.
  test.skip(browserName === 'firefox', 'setViewportSize hangs under Firefox pointer lock');
  test.setTimeout(90000);
  await page.goto('/benchmark.html');
  await fillCiMetadata(page, browserName);
  await beginCase(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator('[data-case-id="sedan-driver"][data-status="invalid"]')).toBeVisible();
  await expect(page.locator('#benchmark-canvas')).toHaveCount(0);
});
