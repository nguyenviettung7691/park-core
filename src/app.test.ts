// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { PreviewStartError, type Preview, type PreviewEvents } from './render/preview';
import { testGamepad } from './test/gamepad';
import type { SensorSnapshot } from './contracts';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function fixture() {
  const root = document.createElement('div');
  document.body.append(root);
  let live = 0;
  let lockResult = true;
  let lockRequest: () => Promise<boolean> = async () => lockResult;
  let events: PreviewEvents | undefined;
  const previews: Preview[] = [];
  const prototypes: unknown[] = [];
  const factory = vi.fn((
    canvas: HTMLCanvasElement, _container: HTMLElement, handlers: PreviewEvents, prototype: unknown,
  ) => {
    expect(canvas.isConnected).toBe(true);
    events = handlers;
    prototypes.push(prototype);
    live++;
    let disposed = false;
    const preview: Preview = {
      resume: vi.fn(() => true),
      pause: vi.fn(),
      enqueue: vi.fn(),
      unlockAudio: vi.fn(),
      requestPointerLock: vi.fn(() => lockRequest()),
      updateSettings: vi.fn(),
      recenterView: vi.fn(),
      selectSource: vi.fn(),
      setCalibration: vi.fn(),
      dispose: vi.fn(() => { if (!disposed) { disposed = true; live--; } }),
    };
    previews.push(preview);
    return preview;
  });
  return {
    root, factory, previews, prototypes,
    setLockResult(value: boolean) { lockResult = value; },
    setLockRequest(request: () => Promise<boolean>) { lockRequest = request; },
    async flush() { await Promise.resolve(); await Promise.resolve(); },
    get live() { return live; },
    get events() {
      if (!events) throw new Error('No preview events');
      return events;
    },
    click(text: string) {
      const button = [...root.querySelectorAll('button')].find((node) => node.textContent === text);
      if (!button) throw new Error(`Button missing: ${text}`);
      button.click();
    },
  };
}

it('mounts menu without touching WebGL or storage', () => {
  const f = fixture();
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
  const storage = vi.spyOn(Storage.prototype, 'getItem');
  const app = createApp(f.root, { createPreview: f.factory });
  expect(f.root.querySelector('#vehicle')).not.toBeNull();
  expect(f.root.querySelector('canvas')).toBeNull();
  expect(context).not.toHaveBeenCalled();
  expect(storage).not.toHaveBeenCalled();
  expect(f.factory).not.toHaveBeenCalled();
  app.dispose();
});

it('ten open/close cycles keep at most one canvas and release all previews', () => {
  const f = fixture();
  const app = createApp(f.root, { createPreview: f.factory });
  let previous: Element | null = null;
  for (let i = 0; i < 10; i++) {
    f.click('Lái thử mô hình');
    const canvas = f.root.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas).not.toBe(previous);
    expect(f.root.querySelectorAll('canvas').length).toBe(1);
    expect(f.live).toBe(1);
    expect(f.root.textContent).toContain('Bản thử vật lý — chưa có bài học');
    previous = canvas;
    f.click('Quay lại menu');
    expect(f.live).toBe(0);
    expect(f.root.querySelector('canvas')).toBeNull();
  }
  app.dispose();
  app.dispose();
  expect(f.root.children.length).toBe(0);
  expect(f.previews.every((preview) =>
    vi.mocked(preview.dispose).mock.calls.length === 1)).toBe(true);
});

it('keeps the selected vehicle when leaving the preview', () => {
  const f = fixture();
  const app = createApp(f.root, { createPreview: f.factory });
  const select = f.root.querySelector<HTMLSelectElement>('#vehicle')!;
  select.value = 'cuv';
  select.dispatchEvent(new Event('change'));
  f.click('Lái thử mô hình');
  expect(f.root.textContent).toContain('CUV');
  f.click('Quay lại menu');
  expect(f.root.querySelector<HTMLSelectElement>('#vehicle')?.value).toBe('cuv');
  app.dispose();
});

it('requires explicit resume after preview pause', async () => {
  const f = fixture();
  const app = createApp(f.root, { createPreview: f.factory });
  f.click('Lái thử mô hình');
  await f.flush();
  f.events.onPaused('focus');
  expect(document.activeElement?.textContent).toBe('Tiếp tục lái thử');
  expect(f.previews[0].requestPointerLock).toHaveBeenCalledTimes(1);
  expect(f.previews[0].resume).toHaveBeenCalledTimes(1);
  expect(vi.mocked(f.previews[0].unlockAudio).mock.invocationCallOrder[0])
    .toBeLessThan(vi.mocked(f.previews[0].requestPointerLock).mock.invocationCallOrder[0]!);
  f.click('Tiếp tục lái thử');
  await f.flush();
  expect(f.previews[0].requestPointerLock).toHaveBeenCalledTimes(2);
  expect(f.previews[0].resume).toHaveBeenCalledTimes(2);
  expect(f.root.textContent).not.toContain('Tiếp tục lái thử');
  app.dispose();
});

it('preserves audio-unavailable notice and renders real sensor readings from the preview', async () => {
  const f = fixture();
  const app = createApp(f.root, { createPreview: f.factory });
  f.click('Lái thử mô hình');
  f.events.onNotice('audioUnavailable');
  await f.flush();
  expect(f.root.querySelector('#status-message')?.textContent)
    .toContain('cảnh báo hình ảnh vẫn đang hoạt động');

  const sensors: SensorSnapshot = {
    sampledAtS: 1,
    readings: [
      { id: 'front-center', distanceM: 0.55, obstacleId: '4', band: 'red' },
    ],
  };
  f.events.onSensors(sensors);
  expect(f.root.querySelector<HTMLElement>('#proximity-front')?.hidden).toBe(false);
  expect(f.root.querySelector('#proximity-front')?.textContent).toContain('0,55');
  f.click('Quay lại menu');
  expect(f.root.querySelector<HTMLElement>('#proximity-front')?.hidden).toBe(true);
  app.dispose();
});

it('disposes context-lost content before showing recovery and reopens on a fresh canvas', () => {
  const f = fixture();
  const app = createApp(f.root, { createPreview: f.factory });
  f.click('Lái thử mô hình');
  const canvas = f.root.querySelector('canvas');
  f.events.onFault('context-lost');
  expect(f.live).toBe(0);
  expect(f.root.querySelector('canvas')).toBeNull();
  expect(f.root.textContent).toContain('Tải lại trang');
  f.click('Quay lại menu');
  f.click('Lái thử mô hình');
  expect(f.root.querySelector('canvas')).not.toBe(canvas);
  app.dispose();
});

it('surfaces startup failure without a canvas and offers retry only when recoverable', () => {
  const f = fixture();
  f.factory.mockImplementationOnce(() => { throw new PreviewStartError('webgl-unsupported'); });
  const app = createApp(f.root, { createPreview: f.factory });
  f.click('Lái thử mô hình');
  expect(f.root.querySelector('canvas')).toBeNull();
  expect([...f.root.querySelectorAll('#screen-layer button')].map((node) => node.textContent))
    .toEqual(['Quay lại menu']);
  f.click('Quay lại menu');
  f.factory.mockImplementationOnce(() => { throw new PreviewStartError('renderer-failed'); });
  f.click('Lái thử mô hình');
  expect(f.root.textContent).toContain('Thử lại');
  f.click('Thử lại');
  expect(f.live).toBe(1);
  app.dispose();
});

it('ignores callbacks from a closed preview rather than changing the current screen', () => {
  const f = fixture();
  const app = createApp(f.root, { createPreview: f.factory });
  f.click('Lái thử mô hình');
  const old = f.events;
  f.click('Quay lại menu');
  old.onFault('runtime-error', new Error('Late callback'));
  old.onPaused('focus');
  expect(f.root.querySelector('#vehicle')).not.toBeNull();
  expect(f.root.textContent).not.toContain('Thử lại');
  app.dispose();
});

it('keeps the paused UI when pointer lock is denied on resume', async () => {
  const f = fixture();
  const app = createApp(f.root, { createPreview: f.factory });
  f.click('Lái thử mô hình');
  await f.flush();
  expect(f.previews[0].resume).toHaveBeenCalledTimes(1);
  f.events.onPaused('focus');
  f.setLockResult(false);
  f.click('Tiếp tục lái thử');
  await f.flush();
  expect(f.root.textContent).toContain('Tiếp tục lái thử');
  expect(f.previews[0].resume).toHaveBeenCalledTimes(1);
  expect(f.root.querySelector('#status-message')?.textContent).not.toBe('');
  app.dispose();
});

it('makes resume single-flight and ignores a lock request completed after pause', async () => {
  const f = fixture();
  let resolveLock!: (locked: boolean) => void;
  f.setLockRequest(() => new Promise((resolve) => { resolveLock = resolve; }));
  const app = createApp(f.root, { createPreview: f.factory });
  f.click('Lái thử mô hình');
  const preview = f.previews[0]!;
  expect(preview.requestPointerLock).toHaveBeenCalledOnce();
  f.click('Tiếp tục lái thử');
  expect(preview.requestPointerLock).toHaveBeenCalledOnce();

  f.events.onPaused('focus');
  resolveLock(true);
  await f.flush();

  expect(preview.resume).not.toHaveBeenCalled();
  expect(f.root.textContent).toContain('Tiếp tục lái thử');
  app.dispose();
});

it('rebuilds a fresh prototype on reset and disposes the previous instance', () => {
  const f = fixture();
  const app = createApp(f.root, { createPreview: f.factory });
  f.click('Lái thử mô hình');
  const first = f.previews[0];
  const canvas = f.root.querySelector('canvas');
  f.click('Đặt lại xe');
  expect(first.dispose).toHaveBeenCalledTimes(1);
  expect(f.root.querySelector('canvas')).not.toBe(canvas);
  expect(f.live).toBe(1);
  app.dispose();
});

it('does not discover controllers until the learner selects that input source', () => {
  const f = fixture();
  const getGamepads = vi.fn(() => []);
  const app = createApp(f.root, { createPreview: f.factory, getGamepads });
  expect(getGamepads).not.toHaveBeenCalled();
  const source = f.root.querySelector<HTMLSelectElement>('#input-source')!;
  source.value = 'gamepad';
  source.dispatchEvent(new Event('change'));
  expect(getGamepads).toHaveBeenCalledOnce();
  expect([...f.root.querySelectorAll('button')].find((button) => button.textContent === 'Lái thử mô hình')?.disabled)
    .toBe(true);
  app.dispose();
});

it('cancels calibration back to paused controls and restores its trigger focus', async () => {
  const f = fixture();
  const pad = testGamepad();
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const app = createApp(f.root, { createPreview: f.factory, getGamepads: () => [pad] });
  f.click('Lái thử mô hình');
  await f.flush();
  f.events.onPaused('user');
  const source = f.root.querySelector<HTMLSelectElement>('#input-source')!;
  source.value = 'gamepad'; source.dispatchEvent(new Event('change'));
  const device = f.root.querySelector<HTMLSelectElement>('#input-device')!;
  device.value = '0'; device.dispatchEvent(new Event('change'));
  f.click('Hiệu chuẩn thiết bị');
  expect(f.root.querySelector('[role="dialog"]')).not.toBeNull();
  f.click('Hủy');
  expect(f.root.querySelector('[role="dialog"]')).toBeNull();
  expect(f.root.textContent).toContain('Tiếp tục lái thử');
  expect(document.activeElement?.textContent).toBe('Hiệu chuẩn thiết bị');
  expect(f.previews[0].resume).toHaveBeenCalledTimes(1);
  app.dispose();
});

it('passes initial settings and routes HUD changes to the live preview without persistence', async () => {
  const f = fixture();
  const setItem = vi.spyOn(Storage.prototype, 'setItem');
  const app = createApp(f.root, { createPreview: f.factory });
  f.click('Lái thử mô hình');
  await f.flush();

  expect(f.prototypes[0]).toMatchObject({
    settings: {
      version: 1, volume: 0.5, muted: false, driverFovDeg: 60,
      cameraMode: 'driver', overhead: false, trajectory: false,
      inputSource: 'keyboard', resolutionScale: 1,
    },
  });
  const mode = f.root.querySelector<HTMLSelectElement>('#camera-mode')!;
  mode.value = 'chase';
  mode.dispatchEvent(new Event('change'));
  expect(f.previews[0].updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({
    cameraMode: 'chase',
  }));
  f.root.querySelector<HTMLButtonElement>('#recenter-view')!.click();
  expect(f.previews[0].recenterView).toHaveBeenCalledOnce();
  expect(setItem).not.toHaveBeenCalled();
  app.dispose();
});

it('preserves the selected input source when later HUD settings change', async () => {
  const f = fixture();
  const app = createApp(f.root, { createPreview: f.factory });
  f.click('Lái thử mô hình');
  await f.flush();
  f.events.onPaused('focus');

  const source = f.root.querySelector<HTMLSelectElement>('#input-source')!;
  source.value = 'gamepad';
  source.dispatchEvent(new Event('change'));
  const mode = f.root.querySelector<HTMLSelectElement>('#camera-mode')!;
  mode.value = 'chase';
  mode.dispatchEvent(new Event('change'));

  expect(f.previews[0].updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({
    cameraMode: 'chase', inputSource: 'gamepad',
  }));
  app.dispose();
});

it('keeps the preview paused and displays a Vietnamese notice when pointer lock is denied', async () => {
  const f = fixture();
  f.setLockResult(false);
  const app = createApp(f.root, { createPreview: f.factory });
  f.click('Lái thử mô hình');
  await f.flush();
  expect(f.previews[0].resume).not.toHaveBeenCalled();
  expect(f.root.textContent).toContain('Tiếp tục lái thử');
  expect(f.root.querySelector('#status-message')?.textContent).toContain('con trỏ');
  app.dispose();
});

it('keeps native Reset connected when keyboard focus loss pauses before its click', () => {
  const f = fixture();
  const app = createApp(f.root, { createPreview: f.factory });
  f.click('Lái thử mô hình');
  const reset = [...f.root.querySelectorAll('button')].find((button) => button.textContent === 'Đặt lại xe')!;
  reset.focus();
  f.events.onPaused('focus');
  expect(reset.isConnected).toBe(true);
  reset.click();
  expect(f.factory).toHaveBeenCalledTimes(2);
  app.dispose();
});
