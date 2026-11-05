import { expect, test } from '@playwright/test';
import { vi } from '../../src/messages';
import { enterLessonMenu } from '../ui-journey';

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
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: vi.resumePreview, exact: true })).toBeVisible();
});
