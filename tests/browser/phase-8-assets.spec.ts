import { expect, test } from '@playwright/test';
import { vi } from '../../src/messages';
import { closeSettings, enterLessonMenu, openSettings } from '../ui-journey';
import type {} from './fixtures/phase-8';

test.use({ viewport: { width: 1280, height: 720 } });

for (const vehicle of ['sedan', 'cuv']) {
  for (const environment of ['garage', 'roadside']) {
    test(`${vehicle}-${environment} original assets render within per-pass budgets`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`/tests/browser/fixtures/phase-8.html?vehicle=${vehicle}&environment=${environment}`);
      await expect.poll(() => page.evaluate(() => window.phase8Capture?.ready), { timeout: 10000 }).toBe(true);
      const report = await page.evaluate(() => window.phase8Capture.report());
      for (const frame of report.frames) {
        expect(frame.find((pass) => pass.name === 'main')!.calls).toBeLessThanOrEqual(100);
        expect(frame.find((pass) => pass.name === 'main')!.calls).toBeGreaterThan(0);
      }
      expect(report.frames[0].filter((pass) => pass.name.startsWith('mirror'))).toHaveLength(3);
      expect(report.frames[1].filter((pass) => pass.name.startsWith('mirror'))).toHaveLength(0);
      expect(report.frames[2].filter((pass) => pass.name.startsWith('mirror'))).toHaveLength(3);
      if (environment === 'garage') {
        expect(report.passes.find((pass) => pass.name === 'main')!.ceilingVisible).toBe(true);
        expect(report.passes.find((pass) => pass.name === 'overhead')!.ceilingVisible).toBe(false);
      }
      await info.attach('asset-report', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
      for (const shot of ['front', 'rear', 'driver', 'overhead', 'environment', 'props'] as const) {
        await page.evaluate((value) => window.phase8Capture.setShot(value), shot);
        await page.screenshot({ path: info.outputPath(`${vehicle}-${environment}-${shot}.png`) });
      }
      expect(errors).toEqual([]);
    });
  }
}

for (const stage of [1, 2, 3, 4, 5]) {
  test(`stage ${stage} parked cars align with the rendered lesson`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const environment = stage === 3 || stage === 5 ? 'roadside' : 'garage';
    await page.goto(`/tests/browser/fixtures/phase-8.html?vehicle=cuv&environment=${environment}&stage=${stage}`);
    await expect.poll(() => page.evaluate(() => window.phase8Capture?.ready)).toBe(true);
    const report = await page.evaluate(() => window.phase8Capture.report());
    expect(report.parkedTriangles).toHaveLength(stage === 4 ? 1 : 2);
    for (const count of report.parkedTriangles) expect(count).toBeLessThanOrEqual(4000);
    expect(report.wheelStopTriangles).toHaveLength(stage === 3 || stage === 5 ? 0 : 1);
    for (const count of report.wheelStopTriangles) expect(count).toBeGreaterThan(0);
    for (const frame of report.frames) {
      expect(frame.find((pass) => pass.name === 'main')!.calls).toBeLessThanOrEqual(140);
    }
    await info.attach('lesson-asset-report', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    await page.evaluate(() => window.phase8Capture.setShot('environment'));
    await page.screenshot({ path: info.outputPath(`stage-${stage}-parked-cars.png`) });
    expect(errors).toEqual([]);
  });
}

for (const stage of [1, 2, 4]) {
  for (const vehicle of ['sedan', 'cuv']) {
    test(`stage ${stage} ${vehicle} rests its tyres against the garage wheel stop`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`/tests/browser/fixtures/phase-8.html?vehicle=${vehicle}&environment=garage&stage=${stage}&pose=stop-touch`);
      await expect.poll(() => page.evaluate(() => window.phase8Capture?.ready)).toBe(true);
      const report = await page.evaluate(() => window.phase8Capture.report());
      const leading = stage === 1 ? report.wheelEdges.slice(0, 2) : report.wheelEdges.slice(2);
      expect(leading).toEqual([`stage${stage}-wheel-stop:touching`, `stage${stage}-wheel-stop:touching`]);
      for (const frame of report.frames) {
        expect(frame.find((pass) => pass.name === 'main')!.calls).toBeLessThanOrEqual(140);
      }
      // Review captures for the environment change (issue #11); approval is the developer's.
      for (const shot of ['chase', 'overhead', 'driver-neutral', 'stop-closeup'] as const) {
        await page.evaluate((value) => window.phase8Capture.setShot(value), shot);
        await page.screenshot({ path: `test-results/issue-11-task6/stage-${stage}-${vehicle}-${shot}.png` });
      }
      expect(errors).toEqual([]);
    });
  }
}

test('captures the real updated menu and chase view', async ({ page }, info) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await enterLessonMenu(page);
  await page.screenshot({ path: info.outputPath('app-menu.png') });
  await page.getByLabel('Chọn xe').selectOption('cuv');
  await openSettings(page, 'view');
  await page.locator('#camera-mode').selectOption('chase');
  await page.locator('#overhead-view').check();
  await closeSettings(page);
  await page.locator('#start-stage').click();
  await page.getByRole('button', { name: vi.startDriving, exact: true }).click();
  await expect(page.locator('#simulation')).toBeVisible();
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: info.outputPath('app-driving.png') });
});
