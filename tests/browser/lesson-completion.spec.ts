import { expect, test, type Page } from '@playwright/test';
import { enterLessonMenu } from '../ui-journey';
import type { StageId, VehicleId } from '../../src/contracts';
import { vi } from '../../src/messages';
import {
  calibrateThroughUi, driveLesson, ensureGamepadReady, installObservationAndPad, releasePad,
} from './lesson-driver';

const stages: readonly StageId[] = [1, 2, 3, 4, 5];
const JOURNEY_TIMEOUT_MS = 10 * 60_000;

async function openMenuAfterReload(page: Page) {
  await page.reload();
  await expect(page.locator('#start-stage')).toBeVisible();
  await ensureGamepadReady(page);
}

async function completeStage(page: Page, vehicleId: VehicleId, stageId: StageId, log: (line: string) => void) {
  await page.locator('#vehicle').selectOption(vehicleId);
  for (const other of stages) {
    const choice = page.locator(`[data-stage-id="${other}"]`);
    if (other <= stageId) await expect(choice).toBeEnabled();
    else await expect(choice).toBeDisabled();
  }
  await page.locator(`[data-stage-id="${stageId}"]`).click();
  await expect(page.locator(`[data-stage-id="${stageId}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: vi.startStage, exact: true }).click();
  await expect(page.getByRole('heading', { name: vi[`stage${stageId}`], exact: true })).toBeVisible();
  await expect(page.locator('#screen-layer')).toContainText(vehicleId === 'sedan' ? vi.sedan : vi.cuv);
  await page.getByRole('button', { name: vi.startDriving, exact: true }).click();
  await expect(page.locator('#simulation')).toBeFocused();
  await expect.poll(() => page.evaluate(() =>
    document.pointerLockElement === document.querySelector('#simulation'))).toBe(true);

  const result = await driveLesson(page, stageId, vehicleId, log);
  expect(result.summary).toMatchObject({ stageId, vehicleId, outcome: 'success', failureReason: null });

  await expect(page.getByRole('heading', { name: vi.successTitle, exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByText(vi.metricDetails, { exact: true }).click();
  await expect(page.getByText(vi.historyPeakSpeed, { exact: true })).toBeVisible();
  await expect(page.locator('#screen-layer')).not.toContainText(vi.failTitle);
  await releasePad(page);
  await page.getByRole('button', { name: vi.continue, exact: true }).click();
  await expect(page.locator(`[data-stage-id="${stageId}"]`)).toContainText(vi.completedStage);
  return result;
}

async function verifyPersistence(page: Page, vehicleId: VehicleId, stageId: StageId) {
  await openMenuAfterReload(page);
  await expect(page.locator(`[data-stage-id="${stageId}"]`)).toContainText(vi.completedStage);
  if (stageId < 5) {
    await expect(page.locator(`[data-stage-id="${stageId + 1}"]`)).toBeEnabled();
    if (stageId < 4) await expect(page.locator(`[data-stage-id="${stageId + 2}"]`)).toBeDisabled();
  } else {
    await expect(page.locator('[data-stage-id="6"]')).toHaveCount(0);
    await expect(page.locator('[data-stage-id]')).toHaveCount(5);
  }
  await page.getByRole('button', { name: vi.openHistory, exact: true }).click();
  const attempts = page.locator('[data-attempt-id]');
  await expect(attempts).toHaveCount(stageId);
  await expect(attempts.first()).toContainText(vi[`stage${stageId}`]);
  await expect(attempts.first()).toContainText(vehicleId === 'sedan' ? vi.sedan : vi.cuv);
  await expect(attempts.first()).toContainText(`— ${vi.outcomeSuccess}`);
  await attempts.first().click();
  await page.getByText(vi.metricDetails, { exact: true }).click();
  await expect(page.getByText(vi.historyPeakSpeed, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: vi.backToHistory, exact: true }).click();
  await page.getByRole('button', { name: vi.closePreview, exact: true }).click();
  await expect(page.locator('#start-stage')).toBeVisible();
  await ensureGamepadReady(page);
}

for (const vehicleId of ['sedan', 'cuv'] as const) {
  test(`${vehicleId} completes lessons 1-5 through real gamepad and keyboard journey`, async ({ page }, testInfo) => {
    test.setTimeout(JOURNEY_TIMEOUT_MS);
    const errors: string[] = [];
    const lines: string[] = [];
    const log = (line: string) => { lines.push(line); };
    page.on('pageerror', (error) => errors.push(error.message));
    await installObservationAndPad(page);
    await page.goto('/');
    await enterLessonMenu(page);
    await expect(page.locator('#start-stage')).toBeVisible();
    expect(await page.evaluate(() => ['park-core.progress.v1', 'park-core.settings.v1',
      'park-core.calibration.v1'].map((key) => localStorage.getItem(key)))).toEqual([null, null, null]);
    await calibrateThroughUi(page);
    await expect(page.locator('#start-stage')).toBeEnabled();

    try {
      for (const stageId of stages) {
        await test.step(`stage ${stageId} ${vehicleId}`, async () => {
          const result = await completeStage(page, vehicleId, stageId, log);
          const line = `RESULT stage=${stageId} vehicle=${vehicleId} wallMs=${result.wallMs}` +
            ` simS=${result.simulationS.toFixed(1)} elapsedS=${result.summary.elapsedSimulationS.toFixed(1)}` +
            ` finalPos=${result.finalPositionM?.map((v) => v.toFixed(2)).join(',') ?? 'n/a'}`;
          log(line);
          console.log(line);
          await verifyPersistence(page, vehicleId, stageId);
        });
      }
      expect(errors).toEqual([]);
    } finally {
      await testInfo.attach('drive-log', { body: lines.join('\n'), contentType: 'text/plain' });
    }
  });
}
