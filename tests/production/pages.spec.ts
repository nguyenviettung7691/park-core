import { expect, test } from '@playwright/test';

const glbPaths = [
  '/assets/vehicles/sedan.glb',
  '/assets/vehicles/cuv.glb',
  '/assets/environments/roadside.glb',
  '/assets/environments/garage.glb',
];

test('built app serves assets and enters Stage 1', async ({ page, request, baseURL }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const builtAssets: { url: string; status: number; type: string }[] = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === new URL(baseURL!).origin && /^\/assets\/.+\.(js|css)$/.test(url.pathname)) {
      builtAssets.push({
        url: url.pathname,
        status: response.status(),
        type: response.headers()['content-type'] ?? '',
      });
    }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Park-Core', exact: true })).toBeVisible();
  const scripts = builtAssets.filter((asset) => asset.url.endsWith('.js'));
  const styles = builtAssets.filter((asset) => asset.url.endsWith('.css'));
  expect(scripts.length).toBeGreaterThan(0);
  expect(styles.length).toBeGreaterThan(0);
  for (const asset of scripts) {
    expect(asset.status).toBe(200);
    expect(asset.type).toMatch(/javascript/i);
  }
  for (const asset of styles) {
    expect(asset.status).toBe(200);
    expect(asset.type).toMatch(/text\/css/i);
  }

  for (const path of glbPaths) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const bytes = await response.body();
    expect(bytes.length, path).toBeGreaterThanOrEqual(12);
    expect(bytes.readUInt32LE(0), path).toBe(0x46546c67);
  }

  await expect(page.locator('[data-stage-id="1"]')).toBeEnabled();
  await page.getByRole('button', { name: 'Bắt đầu bài học', exact: true }).click();
  await page.getByRole('button', { name: 'Bắt đầu lái', exact: true }).click();
  await expect(page.locator('#simulation')).toBeVisible();
  await expect(page.locator('#telemetry')).toBeVisible();
  expect(errors).toEqual([]);
});

test('malformed built GLB shows the asset-load alert instead of a simulation', async ({ page }) => {
  test.setTimeout(60000);
  await page.route('**/assets/vehicles/sedan.glb', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>spa fallback</title>',
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Lái tự do', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Không thể tải mẫu xe');
  await expect(page.locator('#simulation')).toHaveCount(0);
});
