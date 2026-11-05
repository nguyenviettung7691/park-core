import { expect, test, type Page } from '@playwright/test';
import type { AppObservation } from '../../src/app-observation';
import type { VehicleTelemetry } from '../../src/contracts';
import { enterLessonMenu } from '../ui-journey';

declare global {
  interface Window {
    phase6Telemetry: VehicleTelemetry | null;
  }
}

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
  await expect.poll(() => page.evaluate(() => window.phase6Telemetry?.gear)).toBe('D');
  await page.keyboard.up('s');
  await page.keyboard.press('Space');
}

async function secureVehicle(page: Page) {
  await page.keyboard.down('s');
  await expect(page.locator('[data-telemetry="brake"]')).toHaveJSProperty('value', 1);
  await page.waitForFunction(() => window.phase6Telemetry !== null &&
    Math.abs(window.phase6Telemetry.signedSpeedMps) < 0.05, undefined, { timeout: 10000 });
  await page.keyboard.press('Digit1');
  await expect.poll(() => page.evaluate(() => window.phase6Telemetry?.gear)).toBe('P');
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
  await page.addInitScript(() => {
    window.phase6Telemetry = null;
    window.addEventListener('park-core:observation', (raw) => {
      const event = (raw as CustomEvent<AppObservation>).detail;
      if (event.kind === 'session' || event.kind === 'closed') window.phase6Telemetry = null;
      else if (event.kind === 'telemetry') window.phase6Telemetry = event.telemetry;
    });
  });

  await startStageOne(page);
  await expect(page.getByRole('button', { name: /ghi nhận thành công/i })).toHaveCount(0);
  await shiftToDrive(page);
  await page.keyboard.down('d');
  await page.waitForFunction(() => window.phase6Telemetry !== null &&
    Math.abs(window.phase6Telemetry.headingRad) >= 0.25, undefined, { timeout: 10000 });
  await page.keyboard.up('d');
  await expect(page.getByRole('heading', { name: 'Lượt lái chưa đạt', exact: true }))
    .toBeVisible({ timeout: 30000 });
  await expect(page.locator('#screen-layer')).toContainText('Va chạm');
  await page.getByRole('button', { name: 'Thử lại bài học', exact: true }).click();
  await expect(page.getByRole('heading', { name: /giai đoạn 1/i })).toBeVisible();
  await page.getByRole('button', { name: 'Quay lại menu', exact: true }).click();

  await openStageOne(page);
  // Exercise the fixed-step cap on the successful drive without changing physics or lesson rules.
  await page.evaluate(() => {
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      const requestedAt = performance.now();
      const wait: FrameRequestCallback = (now) => {
        if (now - requestedAt >= 100) callback(now);
        else requestFrame(wait);
      };
      return requestFrame(wait);
    };
  });
  await page.getByRole('button', { name: 'Bắt đầu lái', exact: true }).click();
  await expect(page.locator('#simulation')).toBeFocused();
  await expect.poll(() => page.evaluate(() =>
    document.pointerLockElement === document.querySelector('#simulation'))).toBe(true);
  await shiftToDrive(page);
  await page.waitForFunction(() => window.phase6Telemetry !== null &&
    window.phase6Telemetry.pose.positionM[2] <= -4.9, undefined, { timeout: 90000 });
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
