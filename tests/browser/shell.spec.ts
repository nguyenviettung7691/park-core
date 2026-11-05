import { expect, test, type Browser } from '@playwright/test';
import { enterLessonMenu } from '../ui-journey';
import { vi } from '../../src/messages';

async function checkFreshViewport(browser: Browser, url: string, width: number, height: number) {
  const context = await browser.newContext({ viewport: { width, height } });
  try {
    const page = await context.newPage();
    await page.goto(url);
    await enterLessonMenu(page);
    await page.getByRole('button', { name: 'Lái tự do', exact: true }).click();
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

test('menu, real rendering, resize, keyboard focus and repeated preview lifecycle', async ({ browser, page }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await enterLessonMenu(page);
  await expect(page.getByRole('heading', { name: 'Park-Core', exact: true })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  const select = page.getByLabel('Chọn xe');
  await select.selectOption('cuv');
  await page.getByText(vi.fullControls, { exact: true }).focus();
  await page.keyboard.press('Tab');
  const open = page.getByRole('button', { name: 'Lái tự do', exact: true });
  await expect(open).toBeFocused();
  expect(await open.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Enter');
  const canvas = page.locator('canvas#simulation');
  await expect(canvas).toBeVisible();
  await expect(page.locator('#telemetry')).toBeVisible();
  await expect(page.locator('#view-controls')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const telemetry = document.querySelector('#telemetry')!.getBoundingClientRect();
    return telemetry.width >= 200 && telemetry.top >= 0 && telemetry.bottom <= innerHeight;
  })).toBe(true);
  const screenshot = await canvas.screenshot();
  const colors = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const surface = document.createElement('canvas');
    surface.width = image.width;
    surface.height = image.height;
    const context = surface.getContext('2d');
    if (!context) throw new Error('Screenshot decode context unavailable');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    const distinct = new Set<number>();
    for (let i = 0; i < pixels.length; i += 4) {
      distinct.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
    }
    return distinct.size;
  }, screenshot.toString('base64'));
  expect(colors).toBeGreaterThan(2);
  if (browser.browserType().name() === 'firefox') {
    await checkFreshViewport(browser, page.url(), 5000, 300);
    await checkFreshViewport(browser, page.url(), 400, 3000);
  } else {
    for (const [width, height] of [[5000, 300], [400, 3000], [1280, 720]]) {
      await page.setViewportSize({ width, height });
      await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) =>
        element.width <= 2560 && element.height <= 1440)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Tiếp tục lái thử', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Quay lại menu', exact: true }).click();
    await expect(canvas).toHaveCount(0);
    await expect(select).toHaveValue('cuv');
    await open.click();
    await expect(canvas).toHaveCount(1);
    await expect(page.locator('#telemetry')).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Tiếp tục lái thử', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Quay lại menu', exact: true }).click();
  expect(errors).toEqual([]);
});

test('missing WebGL2 shows honest feedback with no retry or training controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = new Proxy(getContext, {
      apply(target, receiver, args) {
        if (args[0] === 'webgl2') return null;
        return Reflect.apply(target, receiver, args);
      },
    });
  });
  await page.goto('/');
  await enterLessonMenu(page);
  await page.getByRole('button', { name: 'Lái tự do', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('không hỗ trợ WebGL2');
  await expect(page.getByRole('button')).toHaveText('Quay lại menu');
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('blur needs explicit resume and context loss returns to an honest recovery screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await enterLessonMenu(page);
  const open = page.getByRole('button', { name: 'Lái tự do', exact: true });
  await open.click();
  await expect(page.locator('#telemetry')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tạm dừng', exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.evaluate(() => document.exitPointerLock());
  const resume = page.getByRole('button', { name: 'Tiếp tục lái thử', exact: true });
  await expect(resume).toBeFocused();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(resume).toBeVisible();
  await resume.click();
  await expect(resume).toHaveCount(0);
  const supported = await page.locator('canvas').evaluate((element: HTMLCanvasElement) => {
    const extension = element.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext();
    return true;
  });
  expect(supported).toBe(true);
  await expect(page.getByRole('alert')).toContainText('Mất ngữ cảnh');
  await expect(page.getByRole('button', { name: 'Tải lại trang', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Quay lại menu', exact: true }).click();
  await open.click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(resume).toBeVisible();
  await page.getByRole('button', { name: 'Quay lại menu', exact: true }).click();
  expect(errors).toEqual([]);
});
