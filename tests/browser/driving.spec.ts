import { expect, test, type Page } from '@playwright/test';

interface TestPad {
  id: string; index: number; connected: boolean; mapping: string; timestamp: number;
  axes: number[]; buttons: { value: number; pressed: boolean; touched: boolean }[];
  vibrationActuator: null;
  hapticActuators: never[];
}
declare global { interface Window { testPad: TestPad } }

async function open(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Lái thử mô hình', exact: true }).click();
  await expect(page.locator('#simulation')).toBeFocused();
}

async function keyboardDrive(page: Page) {
  await page.keyboard.down('s');
  await page.keyboard.press('Digit4');
  await page.keyboard.press('Space');
  await expect(page.locator('#telemetry')).toContainText('D');
  await page.keyboard.up('s');
}

async function setButton(page: Page, index: number, value: number) {
  await page.evaluate(({ index, value }) => {
    window.testPad.buttons[index] = { value, pressed: value > 0.5, touched: value > 0 };
  }, { index, value });
}

test('real keyboard drivetrain, brake, invalid shift, pause, stale key and reset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page);
  const canvas = page.locator('#simulation');
  const before = await canvas.screenshot();
  await keyboardDrive(page);
  await expect(page.locator('#telemetry')).toContainText('D');
  await expect(page.locator('#telemetry')).toContainText('3 km/h', { timeout: 10000 });
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await page.keyboard.press('Digit2');
  await expect(page.locator('#status-message')).toContainText('Chỉ đổi số');
  await page.keyboard.down('s');
  await expect(page.locator('#telemetry')).toContainText('0 km/h');
  await page.keyboard.up('s');
  await page.keyboard.down('w');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const resume = page.getByRole('button', { name: 'Tiếp tục lái thử', exact: true });
  await expect(resume).toBeVisible();
  await resume.click();
  await expect(resume).toBeVisible();
  await expect(page.locator('#status-message')).toContainText('nhả hết phím');
  await page.keyboard.up('w');
  await resume.click();
  await expect(resume).toHaveCount(0);
  await page.getByRole('button', { name: 'Đặt lại xe', exact: true }).click();
  await expect(page.locator('#telemetry')).toContainText('0 km/h · P');
  await expect(page.locator('#telemetry')).toContainText('Phanh tay: Bật');
  await page.getByRole('button', { name: 'Quay lại menu', exact: true }).click();
  await expect(canvas).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('real contact stops the prototype until Reset or Menu', async ({ page }) => {
  await open(page);
  await keyboardDrive(page);
  await page.keyboard.down('w');
  await expect(page.locator('#status-message')).toContainText('Xe đã chạm', { timeout: 20000 });
  await page.keyboard.up('w');
  await expect(page.getByRole('button', { name: 'Tiếp tục lái thử', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Đặt lại xe', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Đặt lại xe', exact: true }).click();
  await expect(page.locator('#telemetry')).toContainText('0 km/h · P');
});

test('explicit calibration, physical brake plus HUD gear, disconnect and same-ID reconnect', async ({ page }) => {
  await page.addInitScript(() => {
    window.testPad = {
      id: 'Injected calibration wheel', index: 0, connected: true, mapping: 'standard', timestamp: 0,
      axes: [0], buttons: Array.from({ length: 8 }, () => ({ value: 0, pressed: false, touched: false })),
      vibrationActuator: null, hapticActuators: [],
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.testPad] });
  });
  await page.goto('/');
  await page.getByLabel('Nguồn điều khiển', { exact: true }).selectOption('gamepad');
  await page.getByLabel('Thiết bị', { exact: true }).selectOption('0');
  await expect(page.getByRole('button', { name: 'Lái thử mô hình', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Hiệu chuẩn thiết bị', exact: true }).click();
  for (const [value, label] of [[-1, 'Ghi hết lái trái'], [0, 'Ghi chính giữa'], [1, 'Ghi hết lái phải']] as const) {
    await page.evaluate((value) => { window.testPad.axes[0] = value; }, value);
    await page.getByRole('button', { name: label, exact: true }).click();
  }
  for (const [index, label] of [[7, 'Chân ga'], [6, 'Phanh chân']] as const) {
    await setButton(page, index, 0);
    await page.getByRole('button', { name: `${label} — Ghi đã nhả`, exact: true }).click();
    await setButton(page, index, 1);
    await page.getByRole('button', { name: `${label} — Ghi đã nhấn hết`, exact: true }).click();
  }
  await setButton(page, 4, 1);
  await page.getByRole('button', { name: 'Xác minh nút R', exact: true }).click();
  await setButton(page, 5, 1);
  await page.getByRole('button', { name: 'Xác minh nút D', exact: true }).click();
  for (const index of [4, 5, 6, 7]) await setButton(page, index, 0);
  await page.evaluate(() => { window.testPad.axes[0] = 0; });
  await page.getByRole('button', { name: 'Lưu hiệu chuẩn', exact: true }).click();
  await page.getByRole('button', { name: 'Lái thử mô hình', exact: true }).click();
  await setButton(page, 6, 1);
  await expect(page.locator('#telemetry')).toContainText('Phanh chân: 100%');
  await page.locator('#driving-controls').getByRole('button', { name: 'D', exact: true }).click();
  await expect(page.locator('#telemetry')).toContainText('D');
  await page.locator('#driving-controls').getByRole('button', { name: 'Phanh tay', exact: true }).click();
  await setButton(page, 6, 0);
  await expect(page.locator('#telemetry')).toContainText('3 km/h', { timeout: 10000 });
  await page.evaluate(() => { window.testPad.connected = false; });
  const resume = page.getByRole('button', { name: 'Tiếp tục lái thử', exact: true });
  await expect(resume).toBeDisabled();
  await expect(page.locator('#status-message')).toContainText('ngắt kết nối');
  await page.evaluate(() => {
    window.testPad.connected = true;
    const event = new Event('gamepadconnected');
    Object.defineProperty(event, 'gamepad', { value: window.testPad });
    window.dispatchEvent(event);
  });
  await expect(resume).toBeDisabled();
  await page.getByLabel('Nguồn điều khiển', { exact: true }).selectOption('keyboard');
  await expect(resume).toBeEnabled();
  await resume.click();
  await expect(page.locator('#telemetry')).toContainText('Bàn phím');
});
