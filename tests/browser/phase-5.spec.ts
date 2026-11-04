import { expect, test } from '@playwright/test';

test('all vehicle and environment assets load and render through WebGL', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/browser/fixtures/phase-5.html');
  await expect(page.locator('body')).toHaveAttribute('data-complete', 'true');

  const pairs = page.locator('#asset-results [data-pair]');
  await expect(pairs).toHaveCount(4);
  await expect(page.locator('#asset-results [data-status="ready"]')).toHaveCount(4);
  await expect.poll(() => pairs.evaluateAll((items) =>
    items.every((item) => Number(item.getAttribute('data-render-calls')) > 0))).toBe(true);
  expect(await page.locator('#asset-renderer').evaluate((element: HTMLCanvasElement) =>
    element.getContext('webgl2') !== null)).toBe(true);
  expect(errors).toEqual([]);
});

test('Stage 1 loads selected assets, cancels stale loading, retries and closes repeatedly', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('/assets/')) requests.push(new URL(request.url()).pathname);
  });
  await page.addInitScript(() => {
    const fetchAsset = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await fetchAsset(input, init);
      if (String(input).includes('/assets/')) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return response;
    };
  });
  let sedanAttempts = 0;
  await page.route('**/assets/vehicles/sedan.glb', async (route) => {
    sedanAttempts++;
    if (sedanAttempts === 1) await route.abort();
    else await route.continue();
  });
  await page.goto('/');

  const stageButtons = page.locator('[data-stage-id]');
  await expect(stageButtons).toHaveCount(5);
  await expect(page.locator('[data-stage-id="1"]')).toBeEnabled();
  for (const id of [2, 3, 4, 5]) {
    await expect(page.locator(`[data-stage-id="${id}"]`)).toBeDisabled();
    await expect(page.locator(`[data-stage-id="${id}"]`)).toContainText('Đã khóa');
  }
  await expect(page.getByRole('button', { name: /ghi nhận thành công/i })).toHaveCount(0);

  await page.getByLabel('Chọn xe').selectOption('cuv');
  await page.getByRole('button', { name: 'Lái thử mô hình', exact: true }).click();
  await expect(page.locator('#screen-layer [role="status"]')).toContainText('Đang chuẩn bị');
  await expect.poll(() => requests).toContain('/assets/vehicles/cuv.glb');
  await page.getByRole('button', { name: 'Quay lại menu', exact: true }).click();
  await expect(page.locator('#simulation')).toHaveCount(0);
  await expect(page.locator('[data-stage-id="2"]')).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Park-Core', exact: true })).toBeVisible();

  await page.getByLabel('Chọn xe').selectOption('sedan');
  await page.getByRole('button', { name: 'Lái thử mô hình', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Không thể tải mẫu xe');
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(page.locator('#simulation')).toBeVisible();
  await expect(page.locator('#telemetry')).toBeVisible();
  await expect.poll(() => requests).toContain('/assets/environments/garage.glb');
  await expect.poll(() => requests).toContain('/assets/vehicles/sedan.glb');

  for (let attempt = 0; attempt < 4; attempt++) {
    await expect(page.locator('#simulation')).toHaveCount(1);
    await expect(page.locator('#telemetry')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Quay lại menu', exact: true }).click();
    await expect(page.locator('#simulation')).toHaveCount(0);
    await page.getByRole('button', { name: 'Lái thử mô hình', exact: true }).click();
    await expect(page.locator('#simulation')).toBeVisible();
    await expect(page.locator('#telemetry')).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Quay lại menu', exact: true }).click();
  expect(errors).toEqual([]);
});
