import { expect, type Page } from '@playwright/test';
import { vi } from '../src/messages';
import type { SettingsTab } from '../src/runtime-types';

export async function enterLessonMenu(page: Page): Promise<void> {
  const screen = page.locator('main[data-screen]');
  await expect(screen).toBeVisible();
  if (await screen.getAttribute('data-screen') === 'onboarding') {
    await page.getByRole('button', { name: vi.skipTutorial, exact: true }).click();
  }
  await expect(page.locator('#start-stage')).toBeVisible();
}

export async function openSettings(page: Page, tab: SettingsTab): Promise<void> {
  if (await page.evaluate(() => document.pointerLockElement !== null)) {
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: vi.settingsTitle, exact: true }).click();
  await page.getByRole('button', { name: vi[`${tab}Tab`], exact: true }).click();
}

export async function closeSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: vi.tutorialBack, exact: true }).click();
}
