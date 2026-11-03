// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mountCalibration, mountScreen } from './screens';
import { mountHud } from './hud';
import type { ScreenContext } from '../runtime-types';
import type { VehicleTelemetry } from '../contracts';
import { testGamepad } from '../test/gamepad';

afterEach(() => document.body.replaceChildren());

const context: ScreenContext = {
  progress: { version: 1, completedStages: [], lastVehicle: 'sedan' },
  settings: {
    version: 1, volume: 0.5, muted: false, driverFovDeg: 60,
    cameraMode: 'driver', overhead: false, trajectory: false,
    inputSource: 'keyboard', resolutionScale: 1,
  },
  selectedStageId: 1,
  selectedVehicleId: 'sedan',
};

function root() {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

it('provides a labeled menu selector and emits typed preview and vehicle actions', () => {
  const element = root();
  const action = vi.fn();
  const unmount = mountScreen(element, { kind: 'menu' }, context, action);
  expect(element.textContent).not.toContain('Bắt đầu');
  expect(element.querySelector('label[for="vehicle"]')).not.toBeNull();
  const select = element.querySelector('select');
  expect(select).toBeInstanceOf(HTMLSelectElement);
  if (!select) throw new Error('Vehicle selector missing');
  select.value = 'cuv';
  select.dispatchEvent(new Event('change'));
  expect(action).toHaveBeenLastCalledWith({ type: 'select-vehicle', vehicleId: 'cuv' });
  element.querySelector('button')?.click();
  expect(action).toHaveBeenLastCalledWith({ type: 'open-preview' });
  unmount();
  expect(element.children.length).toBe(0);
});

it('keeps unavailable HUD features empty and hidden with a discrete live status', () => {
  const element = root();
  const hud = mountHud(element, vi.fn());
  for (const id of [
    'lesson-strip', 'proximity-front', 'proximity-rear',
    'telemetry', 'view-controls', 'overhead-frame',
  ]) {
    const node = element.querySelector<HTMLElement>('#' + id);
    expect(node?.hidden).toBe(true);
    expect(node?.textContent).toBe('');
  }
  expect(element.querySelector('#status-message')?.getAttribute('aria-live')).toBe('polite');
  hud.dispose();
  expect(element.children.length).toBe(0);
});

it('shows only real telemetry and sends semantic driving actions from the gamepad HUD', () => {
  const element = root();
  const action = vi.fn();
  const hud = mountHud(element, action);
  const telemetry: VehicleTelemetry = {
    simulationTimeS: 1, vehicleId: 'sedan',
    pose: { positionM: [0, 0.52, 4], rotation: [0, 0, 0, 1] },
    headingRad: 0, signedSpeedMps: 0.83, totalSpeedMps: 0.83, angularSpeedRadps: 0,
    steeringWheelRad: 0, frontWheelAnglesRad: [0, 0], gear: 'D',
    parkingBrake: false, indicator: 'left', brake: 0,
  };
  hud.update(telemetry, 'gamepad');
  hud.setDriveControls(true);
  expect(element.querySelector<HTMLElement>('#telemetry')?.hidden).toBe(false);
  expect(element.querySelector('#telemetry')?.textContent).toContain('3 km/h');
  [...element.querySelectorAll('button')].find((button) => button.textContent === 'D')!.click();
  expect(action).toHaveBeenLastCalledWith({
    type: 'input-action', action: { type: 'request-gear', gear: 'D' },
  });
  for (const id of ['lesson-strip', 'proximity-front', 'proximity-rear', 'overhead-frame']) {
    expect(element.querySelector<HTMLElement>(`#${id}`)?.hidden).toBe(true);
    expect(element.querySelector(`#${id}`)?.textContent).toBe('');
  }
  hud.dispose();
});

it('keeps calibration captures invalid until verified and cancels its polling without saving', () => {
  const element = root();
  let next = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const request = vi.spyOn(window, 'requestAnimationFrame')
    .mockImplementation((callback) => { frames.set(++next, callback); return next; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
  const complete = vi.fn();
  const cancel = vi.fn();
  const unmount = mountCalibration(element, 0, () => [], complete, cancel);
  const save = [...element.querySelectorAll('button')].find((button) => button.textContent === 'Lưu hiệu chuẩn')!;
  expect(save.disabled).toBe(true);
  expect(element.querySelector('[role="alert"]')?.textContent).not.toBe('');
  element.querySelector('[role="dialog"]')!.dispatchEvent(
    new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }),
  );
  expect(cancel).toHaveBeenCalledOnce();
  expect(complete).not.toHaveBeenCalled();
  unmount();
  expect(frames.size).toBe(0);
  expect(request).toHaveBeenCalled();
  vi.restoreAllMocks();
});

it('saves explicitly captured endpoints and invalidates them on rebinding or device replacement', () => {
  const element = root();
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++next, callback); return next;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
  const pad = testGamepad();
  const complete = vi.fn();
  const unmount = mountCalibration(element, 0, () => [pad], complete, vi.fn());
  function click(text: string) {
    const node = [...element.querySelectorAll('button')].find((button) => button.textContent === text)!;
    node.click();
  }
  function captureAll() {
    pad.axes[0] = -1; click('Ghi hết lái trái');
    pad.axes[0] = 0; click('Ghi chính giữa');
    pad.axes[0] = 1; click('Ghi hết lái phải');
    for (const [index, label] of [[7, 'Chân ga'], [6, 'Phanh chân']] as const) {
      pad.buttons[index]!.value = 0; click(`${label} — Ghi đã nhả`);
      pad.buttons[index]!.value = 1; click(`${label} — Ghi đã nhấn hết`);
    }
    pad.buttons[4]!.value = 1; click('Xác minh nút R');
    pad.buttons[5]!.value = 1; click('Xác minh nút D');
  }
  captureAll();
  const save = [...element.querySelectorAll('button')].find((button) => button.textContent === 'Lưu hiệu chuẩn')!;
  expect(save.disabled).toBe(false);
  save.click();
  expect(complete).toHaveBeenLastCalledWith({
    version: 1, deviceId: 'wheel', steeringAxis: 0, steeringLeft: -1, steeringCenter: 0,
    steeringRight: 1, throttle: { kind: 'button', index: 7, released: 0, pressed: 1 },
    brake: { kind: 'button', index: 6, released: 0, pressed: 1 }, reverseButton: 4, driveButton: 5,
  });
  pad.axes[0] = 1; click('Ghi hết lái trái');
  expect(save.disabled).toBe(true);
  expect(element.querySelector('[role="alert"]')?.textContent).toContain('Dữ liệu hiệu chỉnh không hợp lệ');
  pad.axes[0] = -1; click('Ghi hết lái trái');
  expect(save.disabled).toBe(false);
  const axis = element.querySelector<HTMLInputElement>('input')!;
  axis.value = '1'; axis.dispatchEvent(new Event('change'));
  expect(save.disabled).toBe(true);
  axis.value = '0'; axis.dispatchEvent(new Event('change'));
  captureAll();
  expect(save.disabled).toBe(false);
  pad.id = 'replacement';
  const [id, callback] = frames.entries().next().value!;
  frames.delete(id); callback(16);
  expect(save.disabled).toBe(true);
  expect(element.querySelector('[role="alert"]')?.textContent).toContain('thiết bị khác');
  pad.axes[0] = NaN;
  const [nextId, nextCallback] = frames.entries().next().value!;
  frames.delete(nextId); nextCallback(32);
  expect(save.disabled).toBe(true);
  expect(element.querySelector('[role="alert"]')?.textContent).toContain('không hợp lệ');
  unmount();
  expect(frames.size).toBe(0);
  vi.restoreAllMocks();
});

it('focuses explicit resume without exposing menu controls while paused', () => {
  const element = root();
  const action = vi.fn();
  const state = { kind: 'menu' } as const;
  mountScreen(element, state, context, action, { state, preview: 'paused' });
  expect(element.querySelector('select')).toBeNull();
  expect(document.activeElement?.textContent).toBe('Tiếp tục lái thử');
  element.querySelector('button')?.click();
  expect(action).toHaveBeenCalledWith({ type: 'resume' });
});

it('offers only a route back to menu when WebGL is unsupported', () => {
  const element = root();
  mountScreen(element, {
    kind: 'error', messageKey: 'webglUnsupported', retryable: false,
  }, context, vi.fn());
  expect([...element.querySelectorAll('button')].map((node) => node.textContent))
    .toEqual(['Quay lại menu']);
});

it('offers reload rather than in-place retry after context loss', () => {
  const element = root();
  mountScreen(element, {
    kind: 'error', messageKey: 'webglContextLost', retryable: true,
  }, context, vi.fn());
  expect([...element.querySelectorAll('button')].map((node) => node.textContent))
    .toEqual(['Tải lại trang', 'Quay lại menu']);
});
