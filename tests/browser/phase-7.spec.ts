import { expect, test } from '@playwright/test';
import { vi } from '../../src/messages';
import { enterLessonMenu, openSettings, closeSettings } from '../ui-journey';
import { installObservationAndPad, calibrateThroughUi, selectGamepadDevice } from './lesson-driver';

test('first visit teaches the goal before driving and remains skippable and replayable', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-onboarding-step="0"]')).toBeVisible();
  await expect(page.locator('#simulation')).toHaveCount(0);
  await page.getByRole('button', { name: vi.tutorialNext, exact: true }).click();
  await expect(page.locator('[data-onboarding-step="1"]')).toContainText('không phải lùi');
  await page.getByRole('button', { name: vi.tutorialNext, exact: true }).click();
  await expect(page.locator('[data-onboarding-step="2"]')).toContainText(vi.menuNotice);
  await page.getByRole('button', { name: vi.finishTutorial, exact: true }).click();
  await expect(page.locator('#start-stage')).toBeVisible();
  await page.reload();
  await expect(page.locator('#start-stage')).toBeVisible();
  await page.getByRole('button', { name: vi.help, exact: true }).click();
  await page.getByRole('button', { name: vi.replayTutorial, exact: true }).click();
  await expect(page.locator('[data-onboarding-step="0"]')).toBeVisible();
  await page.getByRole('button', { name: vi.skipTutorial, exact: true }).click();
  await expect(page.locator('#start-stage')).toBeVisible();
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
});

test('visual lesson goal remains a briefing until the learner explicitly starts', async ({ page }) => {
  await page.goto('/');
  await enterLessonMenu(page);
  await page.locator('#start-stage').click();
  await expect(page.locator('[data-screen="briefing"] svg[role="img"]')).toBeVisible();
  await expect(page.locator('#simulation')).toHaveCount(0);
  await page.getByRole('button', { name: vi.startDriving, exact: true }).click();
  await expect(page.locator('#simulation')).toBeFocused();
  await expect(page.locator('#simulation')).toHaveAccessibleName(vi.stage1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: vi.resumePreview, exact: true })).toBeVisible();
});

test('pause help and settings contain focus and never resume driving on close', async ({ page }) => {
  await page.goto('/');
  await enterLessonMenu(page);
  await page.locator('#start-stage').click();
  await page.getByRole('button', { name: vi.startDriving, exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.pointerLockElement))).toBe(true);
  await expect(page.locator('#view-controls')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: vi.help, exact: true }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const first = dialog.getByRole('button').first();
  const last = dialog.getByRole('button').last();
  await first.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: vi.help, exact: true })).toBeFocused();
  await openSettings(page, 'view');
  await expect(page.locator('#simulation')).toHaveJSProperty('inert', true);
  await page.locator('#camera-mode').selectOption('chase');
  await closeSettings(page);
  await expect(page.getByRole('button', { name: vi.settingsTitle, exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  await openSettings(page, 'view');
  await expect(page.locator('#camera-mode')).toHaveValue('chase');
});

for (const [width, height] of [[1440, 900], [390, 844]]) {
  test(`HUD reserves the real overhead inset at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await enterLessonMenu(page);
    await openSettings(page, 'view');
    await page.locator('#overhead-view').check();
    await closeSettings(page);
    await page.locator('#start-stage').click();
    await page.getByRole('button', { name: vi.startDriving, exact: true }).click();
    await expect(page.locator('#hud')).toHaveAttribute('data-overhead', 'true');
    await expect(page.locator('#lesson-strip')).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const size = Number.parseFloat(document.querySelector<HTMLElement>('#app')!.style.getPropertyValue('--overhead-inset-size'));
      const inset = { x: innerWidth - size - 16, y: innerHeight - size - 16 };
      return [...document.querySelectorAll<HTMLElement>('#lesson-strip, #telemetry, .proximity-warning')]
        .every((node) => {
          const b = node.getBoundingClientRect();
          return b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight &&
            (b.right <= inset.x || b.bottom <= inset.y);
        });
    })).toBe(true);
  });
}

test('grouped calibration supports long device names, cancel, save and disconnect', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installObservationAndPad(page);
  await page.goto('/');
  await enterLessonMenu(page);
  await page.evaluate(() => { window.lessonPad.id = 'Long wheel device '.repeat(24); });
  await selectGamepadDevice(page);
  const setup = page.getByRole('button', { name: vi.calibrate, exact: true });
  await setup.click();
  await expect(page.locator('.calibration fieldset')).toHaveCount(4);
  await expect(page.locator('.calibration details')).not.toHaveAttribute('open');
  await expect(page.getByRole('button', { name: vi.saveCalibration, exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(setup).toBeFocused();
  await calibrateThroughUi(page);
  await expect(page.locator('#start-stage')).toBeEnabled();
  await setup.click();
  await page.evaluate(() => { window.lessonPad.connected = false; });
  await expect(page.getByRole('alert')).toContainText('ngắt kết nối');
  await expect(page.getByRole('button', { name: vi.saveCalibration, exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(setup).toBeFocused();
  await expect(page.locator('#simulation')).toHaveCount(0);
});

test('canceling scoped storage recovery retains unreadable data', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('park-core.settings.v1', '{unreadable'));
  await page.goto('/');
  await enterLessonMenu(page);
  await page.locator('[data-reset-record="settings"]').click();
  await page.getByRole('button', { name: vi.cancelReset, exact: true }).click();
  await expect(page.locator('[data-reset-record="settings"]')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('park-core.settings.v1'))).toBe('{unreadable');
});
