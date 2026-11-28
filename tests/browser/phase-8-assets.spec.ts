import { expect, test } from '@playwright/test';
import { scenarios } from '../../src/lessons/scenarios';
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
    test(`stage ${stage} ${vehicle} rests its tyres against the garage wheel stop`, async ({ page }, info) => {
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
      // Review captures for the garage wheel stops, written to the test's output folder.
      for (const shot of ['chase', 'overhead', 'driver-neutral', 'stop-closeup'] as const) {
        await page.evaluate((value) => window.phase8Capture.setShot(value), shot);
        await page.screenshot({ path: info.outputPath(`stage-${stage}-${vehicle}-${shot}.png`) });
      }
      expect(errors).toEqual([]);
    });
  }
}

for (const vehicle of ['sedan', 'cuv']) {
  test(`${vehicle} side-touches the 0.11 m roadside curb with its right tyres`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/tests/browser/fixtures/phase-8.html?vehicle=${vehicle}&environment=roadside&pose=curb-touch`);
    await expect.poll(() => page.evaluate(() => window.phase8Capture?.ready)).toBe(true);
    const report = await page.evaluate(() => window.phase8Capture.report());
    expect([report.wheelEdges[1], report.wheelEdges[3]])
      .toEqual(['roadside-curb-right:touching', 'roadside-curb-right:touching']);
    expect([report.wheelEdges[0], report.wheelEdges[2]]).toEqual(['-:none', '-:none']);
    // Review captures for the roadside curb, written to the test's output folder.
    for (const shot of ['chase', 'driver-neutral', 'driver-right', 'curb-closeup'] as const) {
      await page.evaluate((value) => window.phase8Capture.setShot(value), shot);
      await page.screenshot({ path: info.outputPath(`roadside-curb-${vehicle}-${shot}.png`) });
    }
    expect(errors).toEqual([]);
  });
}

const mirrorShot = { left: 'mirror-left', right: 'mirror-right', rear: 'mirror-rear' } as const;

for (const stage of [1, 2, 3, 4, 5] as const) {
  test(`stage ${stage} scripted actors render within the lesson budget at the check moment`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const scenario = scenarios[stage];
    // Triggers forced at 0: the check moment + 1 s is the latest entry's delay + 1 s.
    const actorsAtS = Math.max(...scenario.actors.map((entry) => entry.delayS)) + 1;
    await page.goto(`/tests/browser/fixtures/phase-8.html?vehicle=cuv&environment=${scenario.environmentId}` +
      `&stage=${stage}&actorsAtS=${actorsAtS}`);
    await expect.poll(() => page.evaluate(() => window.phase8Capture?.ready)).toBe(true);
    const report = await page.evaluate(() => window.phase8Capture.report());
    expect(report.actorsVisible).toBeGreaterThanOrEqual(1);
    expect(report.actorsVisible).toBeLessThanOrEqual(2);
    expect(report.actorsMaxVisible).toBeLessThanOrEqual(2);
    for (const frame of report.frames) {
      expect(frame.find((pass) => pass.name === 'main')!.calls).toBeLessThanOrEqual(140);
    }
    await info.attach('lesson-actors-report', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    // The overhead shows every actor, including ones still outside the mirror frusta.
    const shots = ['driver-neutral', ...new Set(scenario.actors.map((entry) => mirrorShot[entry.side])),
      'overhead'] as const;
    for (const shot of shots) {
      await page.evaluate((value) => window.phase8Capture.setShot(value), shot);
      await info.attach(`stage-${stage}-actors-${shot}.png`, { body: await page.screenshot(), contentType: 'image/png' });
    }
    expect(errors).toEqual([]);
  });
}

// Busiest ambient moments: three actors on the roadside at 19 s, two in the garage at 20 s.
for (const [environment, actorsAtS, busiest] of [['garage', 20, 2], ['roadside', 19, 3]] as const) {
  test(`${environment} ambient actors stay within the sandbox budget`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/tests/browser/fixtures/phase-8.html?vehicle=cuv&environment=${environment}&actorsAtS=${actorsAtS}`);
    await expect.poll(() => page.evaluate(() => window.phase8Capture?.ready)).toBe(true);
    const report = await page.evaluate(() => window.phase8Capture.report());
    expect(report.actorsVisible).toBe(busiest);
    expect(report.actorsMaxVisible).toBeLessThanOrEqual(3);
    for (const frame of report.frames) {
      expect(frame.find((pass) => pass.name === 'main')!.calls).toBeLessThanOrEqual(100);
    }
    await info.attach('ambient-actors-report', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    for (const shot of ['driver-neutral', 'environment'] as const) {
      await page.evaluate((value) => window.phase8Capture.setShot(value), shot);
      await info.attach(`${environment}-ambient-${shot}.png`, { body: await page.screenshot(), contentType: 'image/png' });
    }
    expect(errors).toEqual([]);
  });
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
