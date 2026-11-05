import { expect, test, type Browser, type Page } from '@playwright/test';
import { enterLessonMenu, openSettings, closeSettings } from '../ui-journey';

interface TestPad {
  id: string; index: number; connected: boolean; mapping: string; timestamp: number;
  axes: number[]; buttons: { value: number; pressed: boolean; touched: boolean }[];
  vibrationActuator: null;
  hapticActuators: never[];
}
interface TestAudioStats {
  contexts: number; resumes: number; suspends: number; closes: number; gainValues: number[];
}
declare global {
  interface Window { testPad: TestPad; testAudioStats: TestAudioStats }
}

async function open(page: Page) {
  await page.goto('/');
  await enterLessonMenu(page);
  await page.getByRole('button', { name: 'Lái tự do', exact: true }).click();
  await expect(page.locator('#simulation')).toBeFocused();
  await expect(page.locator('#telemetry')).toBeVisible();
}

async function waitForPointerLock(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    document.pointerLockElement === document.querySelector('#simulation'))).toBe(true);
}

async function installAudioMock(page: Page, unavailable = false) {
  await page.addInitScript((isUnavailable) => {
    const stats = { contexts: 0, resumes: 0, suspends: 0, closes: 0, gainValues: [] as number[] };
    window.testAudioStats = stats;
    class TestAudioContext {
      state: AudioContextState = 'suspended';
      currentTime = 0;
      destination = {};
      constructor() { stats.contexts++; }
      createOscillator() {
        return {
          type: 'sine',
          frequency: { setValueAtTime: () => undefined },
          connect: () => undefined,
          start: () => undefined,
          stop: () => undefined,
          disconnect: () => undefined,
        };
      }
      createGain() {
        const gain = {
          value: 0,
          cancelScheduledValues: () => undefined,
          setValueAtTime(value: number) {
            gain.value = value;
            stats.gainValues.push(value);
          },
        };
        return { gain, connect: () => undefined, disconnect: () => undefined };
      }
      resume() {
        stats.resumes++;
        if (isUnavailable) return Promise.reject(new DOMException('Denied', 'NotAllowedError'));
        this.state = 'running';
        return Promise.resolve();
      }
      suspend() {
        stats.suspends++;
        this.state = 'suspended';
        return Promise.resolve();
      }
      close() {
        stats.closes++;
        this.state = 'closed';
        return Promise.resolve();
      }
    }
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true, value: TestAudioContext,
    });
  }, unavailable);
}

async function checkFreshViewport(browser: Browser, url: string, width: number, height: number) {
  const context = await browser.newContext({ viewport: { width, height } });
  try {
    const page = await context.newPage();
    await installAudioMock(page);
    await page.goto(url);
    await enterLessonMenu(page);
    await page.getByRole('button', { name: 'Lái tự do', exact: true }).click();
    await waitForPointerLock(page);
    const canvas = page.locator('#simulation');
    await expect(canvas).toHaveAttribute('data-engine', /three\.js/i);
    await expect.poll(() => canvas.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return [Math.round(bounds.width), Math.round(bounds.height)];
    })).toEqual([width, height]);
    await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) =>
      element.width <= 2560 && element.height <= 1440)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await canvas.screenshot();
  } finally {
    await context.close();
  }
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
  await waitForPointerLock(page);
  await page.keyboard.press('Escape');
  await expect(resume).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBe(null);
  await page.getByRole('button', { name: 'Đặt lại xe', exact: true }).click();
  await expect(page.locator('[data-telemetry="speed"]')).toHaveText('0 km/h');
  await expect(page.locator('[data-telemetry="gear"]')).toHaveText('P');
  await expect(page.locator('#telemetry')).toContainText('Phanh tay: Bật');
  await page.keyboard.press('Escape');
  await expect(resume).toBeVisible();
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
  await expect(page.locator('[data-telemetry="speed"]')).toHaveText('0 km/h');
  await expect(page.locator('[data-telemetry="gear"]')).toHaveText('P');
});

test('explicit calibration, physical brake and gamepad gear, disconnect and same-ID reconnect', async ({ page }) => {
  await page.addInitScript(() => {
    window.testPad = {
      id: 'Injected calibration wheel', index: 0, connected: true, mapping: 'standard', timestamp: 0,
      axes: [0], buttons: Array.from({ length: 8 }, () => ({ value: 0, pressed: false, touched: false })),
      vibrationActuator: null, hapticActuators: [],
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.testPad] });
  });
  await page.goto('/');
  await enterLessonMenu(page);
  await page.getByLabel('Nguồn điều khiển', { exact: true }).selectOption('gamepad');
  await page.getByLabel('Thiết bị', { exact: true }).selectOption('0');
  await expect(page.getByRole('button', { name: 'Lái tự do', exact: true })).toBeDisabled();
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
  await page.getByRole('button', { name: 'Lái tự do', exact: true }).click();
  await expect(page.locator('#telemetry')).toBeVisible();
  await setButton(page, 6, 1);
  await expect(page.locator('[data-telemetry="brake"]')).toHaveJSProperty('value', 1);
  await setButton(page, 5, 1);
  await expect(page.locator('#telemetry')).toContainText('D');
  await setButton(page, 5, 0);
  await setButton(page, 6, 0);
  await expect(page.locator('[data-telemetry="brake"]')).toHaveJSProperty('value', 0);
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
  await waitForPointerLock(page);
  await expect(page.locator('#telemetry')).toHaveAccessibleName(/Bàn phím/);
});

test('unlocks audio on start, pauses silently, and requires explicit pointer-lock resume', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installAudioMock(page);
  await page.goto('/');
  await enterLessonMenu(page);
  expect(await page.evaluate(() => window.testAudioStats.contexts)).toBe(0);
  await page.getByRole('button', { name: 'Lái tự do', exact: true }).click();
  await waitForPointerLock(page);
  await expect.poll(() => page.evaluate(() => window.testAudioStats.resumes)).toBe(1);
  await keyboardDrive(page);
  const front = page.locator('#proximity-front');
  await expect(front).toContainText(/\d,\d{2} m/, { timeout: 25000 });
  await page.keyboard.down('s');
  await expect(page.locator('#telemetry')).toContainText('0 km/h');
  await page.keyboard.press('Space');
  await expect(page.locator('#telemetry')).toContainText('Phanh tay: Bật');
  await page.keyboard.up('s');
  await expect(page.locator('#status-message')).not.toContainText('Xe đã chạm');
  await expect.poll(() => page.evaluate(() =>
    window.testAudioStats.gainValues.some((value) => value > 0))).toBe(true);

  await page.keyboard.press('Escape');
  const resume = page.getByRole('button', { name: 'Tiếp tục lái thử', exact: true });
  await expect(resume).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.testAudioStats.suspends)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() =>
    window.testAudioStats.gainValues.at(-1))).toBe(0);
  await resume.click();
  await waitForPointerLock(page);
  await expect.poll(() => page.evaluate(() => window.testAudioStats.resumes)).toBeGreaterThan(1);
  await page.keyboard.press('Escape');
  await expect(resume).toBeVisible();
  await page.getByRole('button', { name: 'Quay lại menu', exact: true }).click();
  await expect(page.locator('#simulation')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('keeps front and rear distance labels visible while warnings are muted', async ({ page }) => {
  test.setTimeout(45000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installAudioMock(page);
  await open(page);
  await waitForPointerLock(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Tiếp tục lái thử', exact: true })).toBeVisible();
  await openSettings(page, 'audio');
  await page.getByLabel('Tắt âm thanh cảnh báo', { exact: true }).check();
  await expect(page.locator('#mute-audio')).toBeChecked();
  await closeSettings(page);
  await page.getByRole('button', { name: 'Tiếp tục lái thử', exact: true }).click();
  await waitForPointerLock(page);
  await keyboardDrive(page);
  await expect(page.locator('#proximity-front')).toContainText(/\d,\d{2} m/, { timeout: 25000 });
  await page.keyboard.down('s');
  await expect(page.locator('[data-telemetry="speed"]')).toHaveText('0 km/h');
  await expect(page.locator('[data-telemetry="brake"]')).toHaveJSProperty('value', 1);
  await page.keyboard.press('Space');
  await expect(page.locator('[data-telemetry="parking-brake"]')).toHaveText('Phanh tay: Bật');
  await page.keyboard.up('s');
  await expect(page.locator('#hud')).toHaveAttribute('data-session', 'running');
  await expect(page.locator('#status-message')).not.toContainText('Xe đã chạm');
  const front = page.locator('#proximity-front');
  const rear = page.locator('#proximity-rear');
  const guidance = 'Cảm biến có thể bỏ sót vật cản.';
  await expect(front).toContainText('Trước:');
  await expect(front.locator('.sensor-guidance')).toHaveText(guidance);
  await expect(rear).toContainText('Sau:');
  await expect(rear).toContainText('Không phát hiện bằng cảm biến trong phạm vi 2,5 m');
  await expect(rear.locator('.sensor-guidance')).toHaveText(guidance);
  await page.setViewportSize({ width: 640, height: 900 });
  for (const locator of [front, front.locator('.sensor-guidance'), rear, rear.locator('.sensor-guidance')]) {
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(640);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(900);
  }
  expect(await page.evaluate(() =>
    window.testAudioStats.gainValues.some((value) => value > 0))).toBe(false);
  expect(errors).toEqual([]);
});

test('keeps visual proximity warnings when AudioContext is unavailable', async ({ page }) => {
  test.setTimeout(45000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installAudioMock(page, true);
  await page.goto('/');
  await enterLessonMenu(page);
  expect(await page.evaluate(() => window.testAudioStats.contexts)).toBe(0);
  await page.getByRole('button', { name: 'Lái tự do', exact: true }).click();
  await waitForPointerLock(page);
  await expect(page.locator('#status-message')).toContainText('Âm thanh cảnh báo không khả dụng');
  await keyboardDrive(page);
  await page.keyboard.down('w');
  await expect(page.locator('#proximity-front')).toContainText(/\d,\d{2} m/, { timeout: 25000 });
  await page.keyboard.up('w');
  await expect(page.locator('#proximity-front')).toContainText('Trước:');
  await expect(page.locator('#proximity-rear')).toContainText('Sau:');
  expect(errors).toEqual([]);
});

test('renders camera modes, bounded look, resized overhead, trajectory and mirror updates', async ({ browser, page }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installAudioMock(page);
  await open(page);
  await waitForPointerLock(page);
  const canvas = page.locator('#simulation');
  await expect(canvas).toHaveAttribute('data-engine', /three\.js/i);
  const driverView = await canvas.screenshot();
  await page.keyboard.down('s');
  await page.keyboard.press('Digit4');
  await expect(page.locator('#telemetry')).toContainText('D');
  await page.keyboard.up('s');
  const resume = page.getByRole('button', { name: 'Tiếp tục lái thử', exact: true });

  await page.keyboard.press('Escape');
  await expect(resume).toBeVisible();
  await openSettings(page, 'view');
  await page.locator('#camera-mode').selectOption('chase');
  await closeSettings(page);
  await resume.click();
  await waitForPointerLock(page);
  const chaseView = await canvas.screenshot();
  expect(chaseView.equals(driverView)).toBe(false);

  await page.keyboard.press('Escape');
  await expect(resume).toBeVisible();
  await openSettings(page, 'view');
  await page.locator('#camera-mode').selectOption('driver');
  await page.locator('#overhead-view').check();
  await page.locator('#driver-fov').focus();
  await page.keyboard.press('End');
  await expect(page.locator('#driver-fov')).toHaveValue('80');
  await closeSettings(page);
  await resume.click();
  await waitForPointerLock(page);
  const overheadView = await canvas.screenshot();
  expect(overheadView.equals(driverView)).toBe(false);

  await page.keyboard.press('Escape');
  await expect(resume).toBeVisible();
  await openSettings(page, 'view');
  await page.locator('#trajectory-view').check();
  await closeSettings(page);
  await resume.click();
  await waitForPointerLock(page);
  const trajectoryView = await canvas.screenshot();
  expect(trajectoryView.equals(overheadView)).toBe(false);

  await page.mouse.move(0, 360);
  await page.mouse.move(1279, 360);
  const lookedView = await canvas.screenshot();
  expect(lookedView.equals(trajectoryView)).toBe(false);

  await page.keyboard.press('Escape');
  await expect(resume).toBeVisible();
  await openSettings(page, 'view');
  await page.locator('#recenter-view').click();
  await closeSettings(page);
  await resume.click();
  await waitForPointerLock(page);
  const centeredView = await canvas.screenshot();
  expect(centeredView.equals(lookedView)).toBe(false);

  await page.keyboard.press('Escape');
  await expect(resume).toBeVisible();
  await openSettings(page, 'view');
  await page.locator('#overhead-view').uncheck();
  await page.locator('#trajectory-view').uncheck();
  await closeSettings(page);
  if (browser.browserType().name() === 'chromium') {
    await page.setViewportSize({ width: 800, height: 600 });
    await expect.poll(() => canvas.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return [Math.round(bounds.width), Math.round(bounds.height)];
    })).toEqual([800, 600]);
  } else {
    await checkFreshViewport(browser, page.url(), 800, 600);
  }
  const beforeDrive = await canvas.screenshot();
  await resume.click();
  await waitForPointerLock(page);
  await keyboardDrive(page);
  await page.keyboard.down('w');
  await expect(page.locator('#telemetry')).toContainText(/[1-9]\d* km\/h/, { timeout: 10000 });
  await page.keyboard.up('w');
  expect((await canvas.screenshot()).equals(beforeDrive)).toBe(false);
  expect(errors).toEqual([]);
});

test('repeatedly opens and closes the preview without uncaught errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installAudioMock(page);
  await page.goto('/');
  await enterLessonMenu(page);
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.getByRole('button', { name: 'Lái tự do', exact: true }).click();
    await waitForPointerLock(page);
    await expect(page.locator('#telemetry')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Tiếp tục lái thử', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Quay lại menu', exact: true }).click();
    await expect(page.locator('#simulation')).toHaveCount(0);
  }
  await expect.poll(() => page.evaluate(() => window.testAudioStats.closes)).toBe(3);
  expect(errors).toEqual([]);
});
