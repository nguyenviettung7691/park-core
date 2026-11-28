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

test('real keyboard drivetrain, brake, invalid shift, pause, stale key and reset', { tag: '@smoke' }, async ({ page }) => {
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

test('explicit calibration, physical brake and gamepad gear, disconnect and same-ID reconnect', { tag: '@smoke' }, async ({ page }) => {
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
  const capture = page.locator('[data-calibration-capture]');
  for (const value of [-1, 0, 1]) {
    await page.evaluate((value) => { window.testPad.axes[0] = value; }, value);
    await capture.click();
  }
  for (const index of [7, 6]) {
    await setButton(page, index, 0);
    await capture.click();
    await setButton(page, index, 1);
    await capture.click();
  }
  await setButton(page, 4, 1);
  await capture.click();
  await setButton(page, 5, 1);
  await capture.click();
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

test('shows all graphics settings and persists manual choices across reload', async ({ page }) => {
  const benchmarkModuleRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/src/benchmark/page.ts')) benchmarkModuleRequests.push(request.url());
  });
  await page.goto('/');
  await enterLessonMenu(page);
  expect(benchmarkModuleRequests).toHaveLength(0);
  await openSettings(page, 'view');

  const graphics = page.locator('#graphics-controls');
  await expect(graphics).toBeVisible();
  for (const id of [
    'graphics-preset',
    'resolution-scale',
    'frame-rate-cap',
    'anti-aliasing',
    'mirror-quality',
    'overhead-quality',
  ]) {
    await expect(graphics.locator(`#${id}`)).toBeVisible();
    await expect(graphics.locator(`#${id}`)).toBeEnabled();
  }
  await expect(graphics.locator('details')).toHaveCount(0);
  await expect(page.locator('#graphics-preset')).toHaveValue('high');
  await expect(page.locator('#resolution-scale')).toHaveValue('1');
  await expect(page.locator('#frame-rate-cap')).toHaveValue('display');
  await expect(page.locator('#anti-aliasing')).toBeChecked();
  await expect(page.locator('#mirror-quality')).toHaveValue('high');
  await expect(page.locator('#overhead-quality')).toHaveValue('high');

  const benchmarkRoot = page.locator('#graphics-benchmark-root');
  await expect(benchmarkRoot).toBeHidden();
  await page.locator('#graphics-benchmark-toggle').click();
  await expect(benchmarkRoot).toBeVisible();
  await expect(benchmarkRoot.locator('#benchmark-start')).toBeVisible();
  await expect.poll(() => benchmarkModuleRequests.length).toBeGreaterThan(0);
  await expect(benchmarkRoot.locator('#benchmark-status')).toBeHidden();
  await page.locator('#graphics-benchmark-toggle').click();
  await expect(benchmarkRoot).toBeHidden();

  await page.locator('#resolution-scale').selectOption('0.75');
  await expect(page.locator('#graphics-preset')).toHaveValue('custom');
  await closeSettings(page);
  await page.reload();
  await enterLessonMenu(page);
  await openSettings(page, 'view');
  await expect(page.locator('#resolution-scale')).toHaveValue('0.75');
  await expect(page.locator('#graphics-preset')).toHaveValue('custom');
});

test('measures selected graphics on a non-reference setup and keeps tuning manual', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await enterLessonMenu(page);
  await openSettings(page, 'view');
  await page.locator('#resolution-scale').selectOption('0.5');
  await page.locator('#graphics-benchmark-toggle').click();

  const benchmarkRoot = page.locator('#graphics-benchmark-root');
  await benchmarkRoot.locator('#benchmark-start').click();
  await expect(benchmarkRoot.locator('#benchmark-lock')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#resolution-scale')).toBeDisabled();
  await benchmarkRoot.locator('#benchmark-lock').click();
  const canvas = benchmarkRoot.locator('#benchmark-canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(async () => canvas.evaluate((node: HTMLCanvasElement) => node.width))
    .toBe(640);
  await expect.poll(async () => canvas.evaluate((node: HTMLCanvasElement) => node.height))
    .toBe(360);

  const result = benchmarkRoot.locator('[data-case-id="sedan-driver"][data-status="complete"]');
  await expect(result).toBeVisible({ timeout: 90000 });
  await expect(result).toContainText('p95');
  await expect(result).toContainText('không so sánh với mục tiêu tham khảo');
  await expect(result).not.toContainText('đạt mục tiêu tham khảo');
  await expect(canvas).toHaveCount(0);

  await benchmarkRoot.locator('#benchmark-edit-settings').click();
  await expect(result).toHaveCount(0);
  await expect(page.locator('#resolution-scale')).toBeEnabled();
  await page.locator('#resolution-scale').selectOption('0.75');
  await expect(page.locator('#graphics-preset')).toHaveValue('custom');
  await expect(page.locator('#screen-layer > main')).toHaveAttribute('data-screen', 'settings');
});

test('keeps graphics settings read-only from a paused free-drive preview', async ({ page }) => {
  await open(page);
  await waitForPointerLock(page);
  await page.keyboard.press('Escape');
  const resume = page.getByRole('button', { name: 'Tiếp tục lái thử', exact: true });
  await expect(resume).toBeVisible();
  await openSettings(page, 'view');

  for (const id of [
    'graphics-preset',
    'resolution-scale',
    'frame-rate-cap',
    'anti-aliasing',
    'mirror-quality',
    'overhead-quality',
  ]) {
    await expect(page.locator(`#${id}`)).toBeDisabled();
  }
  expect(await page.evaluate(() => document.pointerLockElement === null)).toBe(true);
  await closeSettings(page);
  await expect(resume).toBeVisible();
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

test('adjusts, saves and resets a side mirror from the cockpit', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installAudioMock(page);
  await open(page);
  await waitForPointerLock(page);
  const canvas = page.locator('#simulation');
  const status = page.locator('#status-message');
  const savedLeft = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('park-core.settings.v1') ?? '{}').mirrorAdjustments?.sedan?.left);
  await page.waitForTimeout(300);
  const original = await canvas.screenshot();

  await page.keyboard.press('m');
  await expect(status).toContainText('gương trái');
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(1000);
  await page.keyboard.up('ArrowLeft');
  for (let i = 0; i < 3; i++) await page.keyboard.press('m');
  await expect(status).toContainText('Đã lưu vị trí gương');
  await expect.poll(async () => (await savedLeft())?.yawDeg ?? 0).toBeLessThan(-4);
  expect((await savedLeft()).pitchDeg).toBe(0);
  await page.waitForTimeout(300);
  // Only the left mirror's pixels change; the driver view itself has not moved.
  expect((await canvas.screenshot()).equals(original)).toBe(false);
  await expect(page.locator('#telemetry')).toContainText('0 km/h');

  await openSettings(page, 'view');
  await page.locator('#reset-mirrors').click();
  await closeSettings(page);
  // Resuming re-acquires pointer lock, which can turn the view, so the reset is checked
  // through the saved state; unit tests cover the reset reaching the renderer.
  await expect.poll(async () => (await savedLeft())?.yawDeg).toBe(0);
  const resume = page.getByRole('button', { name: 'Tiếp tục lái thử', exact: true });
  await resume.click();
  await waitForPointerLock(page);

  await page.keyboard.down('s');
  await page.keyboard.press('Digit4');
  await page.keyboard.press('Space');
  await page.keyboard.up('s');
  await page.keyboard.press('m');
  await expect(status).toContainText('Chỉ chỉnh gương khi xe đã dừng và ở số P hoặc đã kéo phanh tay');
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

interface Crop { x: number; y: number; width: number; height: number }

/** Mean absolute per-channel difference (0-255) between two PNG captures, optionally cropped. */
async function meanPixelDiff(page: Page, a: Buffer, b: Buffer, crop?: Crop): Promise<number> {
  return page.evaluate(async ({ a, b, crop }) => {
    async function pixels(base64: string) {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const area = crop ?? { x: 0, y: 0, width: image.width, height: image.height };
      return context.getImageData(area.x, area.y, area.width, area.height).data;
    }
    const [first, second] = [await pixels(a), await pixels(b)];
    let total = 0;
    for (let i = 0; i < first.length; i += 4) {
      total += Math.abs(first[i]! - second[i]!) + Math.abs(first[i + 1]! - second[i + 1]!) +
        Math.abs(first[i + 2]! - second[i + 2]!);
    }
    return total / (first.length / 4 * 3);
  }, { a: a.toString('base64'), b: b.toString('base64'), crop });
}

/** Feeds the app's own pointer-locked mousemove handler. Headless Chromium echoes each synthetic move back. */
async function lookByMouse(page: Page, movementX: number, movementY = 0) {
  await page.evaluate(([movementX, movementY]) => {
    document.dispatchEvent(new MouseEvent('mousemove', { movementX, movementY }));
  }, [movementX, movementY]);
}

/**
 * Re-acquiring pointer lock after a pause can turn the view, so pin the look at its yaw and pitch
 * limits first and then travel back the exact distance (0.002 rad per pixel; 110 degrees = 960 px,
 * 45 degrees = 392.7 px) to land on the neutral pose.
 */
async function centerLook(page: Page) {
  await lookByMouse(page, -5000, 5000);
  await page.waitForTimeout(300);
  await lookByMouse(page, 960, -392.7);
  await page.waitForTimeout(500);
}

test('moves the driver seat in P, locks it while rolling in D, and restores it on reset', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installAudioMock(page);
  await open(page);
  await waitForPointerLock(page);
  const canvas = page.locator('#simulation');
  const resume = page.getByRole('button', { name: 'Tiếp tục lái thử', exact: true });
  const savedSeat = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('park-core.settings.v1') ?? '{}').seatPositions?.sedan);
  await centerLook(page);
  const original = await canvas.screenshot();

  await page.keyboard.press('Escape');
  await expect(resume).toBeVisible();
  await openSettings(page, 'view');
  await expect(page.locator('#seat-height')).toBeEnabled();
  await expect(page.locator('#seat-fore-aft')).toBeEnabled();
  await expect(page.locator('#seat-adjust-hint')).toBeHidden();
  await page.locator('#seat-height').fill('4');
  await expect.poll(savedSeat).toEqual({ foreAftCm: 0, heightCm: 4 });
  await closeSettings(page);
  await resume.click();
  await waitForPointerLock(page);
  await centerLook(page);
  const raised = await canvas.screenshot();
  expect(await meanPixelDiff(page, original, raised)).toBeGreaterThan(1);

  await page.keyboard.press('Escape');
  await expect(resume).toBeVisible();
  await openSettings(page, 'view');
  await page.locator('#reset-seat').click();
  await expect.poll(savedSeat).toEqual({ foreAftCm: 0, heightCm: 0 });
  await closeSettings(page);
  await resume.click();
  await waitForPointerLock(page);
  await centerLook(page);
  const back = await canvas.screenshot();
  expect(await meanPixelDiff(page, original, back)).toBeLessThan(0.5);

  // Rolling in D: the seat is not adjustable, like the mirrors.
  await keyboardDrive(page);
  await expect(page.locator('#telemetry')).toContainText('3 km/h', { timeout: 10000 });
  await page.keyboard.press('Escape');
  await expect(resume).toBeVisible();
  await openSettings(page, 'view');
  await expect(page.locator('#seat-height')).toBeDisabled();
  await expect(page.locator('#seat-fore-aft')).toBeDisabled();
  await expect(page.locator('#reset-seat')).toBeDisabled();
  await expect(page.locator('#seat-adjust-hint')).toBeVisible();
  expect(await savedSeat()).toEqual({ foreAftCm: 0, heightCm: 0 });
  expect(errors).toEqual([]);
});

test('shoulder check by mouse moves the head and releases it on return', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installAudioMock(page);
  await open(page);
  await waitForPointerLock(page);
  const canvas = page.locator('#simulation');
  await centerLook(page);
  const neutral = await canvas.screenshot();
  const leftMirror = { x: 40, y: 390, width: 260, height: 140 };

  // 0.002 rad per pixel: 960 px is the 110 degree left limit; the extra travel clamps there.
  await lookByMouse(page, -1100);
  await page.waitForTimeout(600);
  const shoulder = await canvas.screenshot();
  expect(await meanPixelDiff(page, neutral, shoulder)).toBeGreaterThan(5);
  // The mirror has left the frame at the limit, so its crop shows the cabin side instead.
  expect(await meanPixelDiff(page, neutral, shoulder, leftMirror)).toBeGreaterThan(5);

  // Coming back 960 px releases both the rotation and the head lean.
  await lookByMouse(page, 960);
  await page.waitForTimeout(600);
  expect(await meanPixelDiff(page, neutral, await canvas.screenshot())).toBeLessThan(0.5);
  expect(errors).toEqual([]);
});
