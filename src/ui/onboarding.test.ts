// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mountOnboarding } from './onboarding';
import type { ScreenContext } from '../runtime-types';

afterEach(() => document.body.replaceChildren());
const context: ScreenContext = {
  progress: { version: 1, completedStages: [], lastVehicle: 'sedan' },
  settings: { version: 1, volume: 0.5, muted: false, driverFovDeg: 60,
    cameraMode: 'driver', overhead: false, trajectory: false,
    inputSource: 'keyboard', resolutionScale: 1 },
  selectedStageId: 1, selectedVehicleId: 'sedan', unlockedStageIds: [1],
  recordStatus: { progress: 'persistent', settings: 'persistent', calibration: 'persistent' },
  resetRequested: null, onboarding: { dismissed: false, status: 'persistent' },
  onboardingResetRequested: false,
};

it.each([0, 1, 2] as const)('offers skip and bounded navigation on tutorial step %s', (step) => {
  const action = vi.fn();
  mountOnboarding(document.body, { kind: 'onboarding', step, origin: 'menu' }, context,
    undefined, action);
  const skip = document.querySelector<HTMLButtonElement>('[data-action="dismiss-tutorial"]')!;
  skip.click();
  expect(action).toHaveBeenLastCalledWith({ type: 'dismiss-tutorial' });
  const next = document.querySelector<HTMLButtonElement>('.primary-action')!;
  next.click();
  expect(action).toHaveBeenLastCalledWith({ type: step === 2 ? 'dismiss-tutorial' : 'tutorial-next' });
  expect(document.querySelector('[data-action="tutorial-back"]') === null).toBe(step === 0);
  expect(document.querySelector('svg[role="img"]')).not.toBeNull();
});

it.each(['session-only', 'reset-required'] as const)('does not conceal onboarding save failures: %s', (status) => {
  mountOnboarding(document.body, { kind: 'onboarding', step: 0, origin: 'menu' },
    { ...context, onboarding: { dismissed: false, status } }, undefined, vi.fn());
  expect(document.querySelector('[role="status"], [role="alert"]')?.textContent).toMatch(/phiên|đặt lại/i);
  expect(document.querySelector<HTMLButtonElement>('[data-action="dismiss-tutorial"]')?.disabled).toBe(false);
});

it('explains braking rather than reversing and does not claim an unverified gamepad is ready', () => {
  const unmount = mountOnboarding(document.body, { kind: 'onboarding', step: 1, origin: 'menu' },
    context, undefined, vi.fn());
  expect(document.body.textContent).toContain('không phải lùi');
  unmount();
  mountOnboarding(document.body, { kind: 'onboarding', step: 1, origin: 'menu' },
    { ...context, settings: { ...context.settings, inputSource: 'gamepad' } },
    { source: 'gamepad', index: null, devices: [], ready: false, savedCalibrationAvailable: false }, vi.fn());
  expect(document.body.textContent).toContain('chưa được hiệu chỉnh');
});
