import { expect, test, type Page } from '@playwright/test';
import { enterLessonMenu } from '../ui-journey';

async function openStageOne(page: Page) {
  await page.getByRole('button', { name: 'Bắt đầu bài học', exact: true }).click();
  await expect(page.getByRole('heading', { name: /giai đoạn 1/i })).toBeVisible();
  await expect(page.locator('#simulation')).toHaveCount(0);
}

async function startStageOne(page: Page) {
  await page.goto('/');
  await enterLessonMenu(page);
  await openStageOne(page);
  await page.getByRole('button', { name: 'Bắt đầu lái', exact: true }).click();
  await expect(page.locator('#simulation')).toBeFocused();
  await expect(page.locator('#telemetry')).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    document.pointerLockElement === document.querySelector('#simulation'))).toBe(true);
}

async function shiftToDrive(page: Page) {
  await page.keyboard.down('s');
  await expect(page.locator('[data-telemetry="brake"]')).toHaveJSProperty('value', 1);
  await page.keyboard.press('Digit4');
  await expect(page.locator('#telemetry')).toContainText('D');
  await page.keyboard.up('s');
  await page.keyboard.press('Space');
}

async function secureVehicle(page: Page) {
  await page.keyboard.down('s');
  await expect(page.locator('#telemetry')).toContainText('0 km/h', { timeout: 10000 });
  await page.keyboard.press('Digit1');
  await expect(page.locator('#telemetry')).toContainText('P');
  await page.keyboard.up('s');
  await page.keyboard.press('Space');
}

async function shiftToReverse(page: Page) {
  await page.keyboard.down('s');
  await expect(page.locator('[data-telemetry="brake"]')).toHaveJSProperty('value', 1);
  await page.keyboard.press('Digit2');
  await expect(page.locator('#telemetry')).toContainText('R');
  await page.keyboard.up('s');
  await page.keyboard.press('Space');
}

test('lesson outcomes, persistence, progression and free drive pass browser acceptance', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await startStageOne(page);
  await expect(page.getByRole('button', { name: /ghi nhận thành công/i })).toHaveCount(0);
  await shiftToDrive(page);
  await page.keyboard.down('d');
  await page.waitForTimeout(2000);
  await page.keyboard.up('d');
  await expect(page.getByRole('heading', { name: 'Lượt lái chưa đạt', exact: true }))
    .toBeVisible({ timeout: 30000 });
  await expect(page.locator('#screen-layer')).toContainText('Va chạm');
  await page.getByRole('button', { name: 'Thử lại bài học', exact: true }).click();
  await expect(page.getByRole('heading', { name: /giai đoạn 1/i })).toBeVisible();
  await page.getByRole('button', { name: 'Quay lại menu', exact: true }).click();

  await openStageOne(page);
  await page.getByRole('button', { name: 'Bắt đầu lái', exact: true }).click();
  await expect(page.locator('#simulation')).toBeFocused();
  await expect.poll(() => page.evaluate(() =>
    document.pointerLockElement === document.querySelector('#simulation'))).toBe(true);
  await shiftToDrive(page);
  await page.waitForTimeout(18600);
  await secureVehicle(page);

  await expect(page.getByRole('heading', { name: 'Hoàn thành bài học', exact: true }))
    .toBeVisible({ timeout: 15000 });
  await page.getByText('Xem chi tiết lượt lái', { exact: true }).click();
  await expect(page.getByText('Tốc độ cao nhất', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Về hành trình', exact: true }).click();
  await expect(page.locator('[data-stage-id="2"]')).toBeEnabled();
  await page.locator('[data-stage-id="2"]').click();
  await page.getByRole('button', { name: 'Bắt đầu bài học', exact: true }).click();
  await expect(page.getByRole('heading', { name: /giai đoạn 2/i })).toBeVisible();
  await page.getByRole('button', { name: 'Quay lại menu', exact: true }).click();

  await page.reload();
  await expect(page.locator('[data-stage-id="2"]')).toBeEnabled();
  const progressBeforeReset = await page.evaluate(() => JSON.stringify(
    Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)]),
  ));
  await page.getByRole('button', { name: 'Lịch sử lượt lái', exact: true }).click();
  const attempts = page.locator('[data-attempt-id]');
  await expect(attempts).toHaveCount(2);
  await expect(attempts.nth(0)).toContainText(/— Đạt$/);
  await expect(attempts.nth(1)).toContainText(/— Chưa đạt$/);
  await attempts.nth(0).click();
  await page.getByText('Xem chi tiết lượt lái', { exact: true }).click();
  await expect(page.getByText('Tốc độ cao nhất', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Quay lại lịch sử', exact: true }).click();
  await page.getByRole('button', { name: 'Đặt lại lịch sử', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận xóa lịch sử', exact: true }).click();
  await expect(page.locator('#screen-layer')).toContainText('Chưa có lượt lái hoàn thành.');
  expect(await page.evaluate(() => JSON.stringify(
    Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)]),
  ))).toBe(progressBeforeReset);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id ?? '')).toBe('');
  await page.getByRole('button', { name: 'Quay lại menu', exact: true }).click();

  await page.getByRole('button', { name: 'Lái tự do', exact: true }).click();
  await expect(page.locator('#simulation')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id ?? '')).toBe('');
  await page.getByRole('button', { name: 'Quay lại menu', exact: true }).click();
  await page.getByRole('button', { name: 'Lịch sử lượt lái', exact: true }).click();
  await expect(page.locator('#screen-layer')).toContainText('Chưa có lượt lái hoàn thành.');
  expect(errors).toEqual([]);
});
