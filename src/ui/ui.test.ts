// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mountScreen } from './screens';
import { mountHud } from './hud';
import type { ScreenContext } from '../runtime-types';

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
  const unmount = mountHud(element);
  for (const id of [
    'lesson-strip', 'proximity-front', 'proximity-rear',
    'telemetry', 'view-controls', 'overhead-frame',
  ]) {
    const node = element.querySelector<HTMLElement>('#' + id);
    expect(node?.hidden).toBe(true);
    expect(node?.textContent).toBe('');
  }
  expect(element.querySelector('#status-message')?.getAttribute('aria-live')).toBe('polite');
  unmount();
  expect(element.children.length).toBe(0);
});

it('focuses explicit resume without exposing menu controls while paused', () => {
  const element = root();
  const action = vi.fn();
  const state = { kind: 'menu' } as const;
  mountScreen(element, state, context, action, { state, preview: 'paused' });
  expect(element.querySelector('select')).toBeNull();
  expect(document.activeElement?.textContent).toBe('Tiếp tục xem thử');
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
