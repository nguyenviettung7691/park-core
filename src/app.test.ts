// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { PreviewStartError, type Preview, type PreviewEvents } from './render/preview';
import { testGamepad } from './test/gamepad';
import type { SensorSnapshot } from './contracts';
import type { AssetLoadProgress, SceneAssets } from './runtime-types';
import { collidersForEnvironment } from './world/colliders';
import { profiles } from './vehicle/profiles';
import { buildPrototypeScene } from './render/prototype';
import { AssetLoadError } from './world/assets';
import { createPersistence, type StoragePort } from './storage/persistence';
import type { PersistenceRecord } from './runtime-types';

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
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
    const sceneAssets = (prototype as { sceneAssets?: SceneAssets }).sceneAssets;
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
      dispose: vi.fn(() => {
        if (!disposed) {
          disposed = true;
          live--;
          sceneAssets?.dispose();
        }
      }),
    };
    previews.push(preview);
    return preview;
  });
  return {
    root, factory, previews, prototypes,
    app(overrides: Parameters<typeof createApp>[1] = {}) {
      return createApp(root, {
        createPreview: factory,
        loadSceneAssets: async () => makeSceneAssets(),
        ...overrides,
      });
    },
    setLockResult(value: boolean) { lockResult = value; },
    setLockRequest(request: () => Promise<boolean>) { lockRequest = request; },
    async flush() { await Promise.resolve(); await Promise.resolve(); },
    get live() { return live; },
    get events() {
      if (!events) throw new Error('No preview events');
      return events;
    },
    async openPreview() {
      this.click('Lái thử mô hình');
      await this.flush();
    },
    click(text: string) {
      const button = [...root.querySelectorAll('button')].find((node) => node.textContent === text);
      if (!button) throw new Error(`Button missing: ${text}`);
      button.click();
    },
  };
}

function makeSceneAssets() {
  return buildPrototypeScene(profiles.sedan, collidersForEnvironment('garage')).assets;
}

function appPersistence(
  seed: Partial<Record<PersistenceRecord, string>> = {},
  failWrites = false,
) {
  const keys: Record<PersistenceRecord, string> = {
    progress: 'park-core.progress.v1',
    settings: 'park-core.settings.v1',
    calibration: 'park-core.calibration.v1',
  };
  const values = new Map<string, string>();
  for (const record of ['progress', 'settings', 'calibration'] as const) {
    const value = seed[record];
    if (value !== undefined) values.set(keys[record], value);
  }
  const storage: StoragePort = {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      if (failWrites) throw new Error('quota exceeded');
      values.set(key, value);
    },
    removeItem: (key) => { values.delete(key); },
  };
  const store = createPersistence(() => storage);
  return {
    store,
    values,
    saveProgress: vi.spyOn(store, 'saveProgress'),
    saveSettings: vi.spyOn(store, 'saveSettings'),
    saveCalibrations: vi.spyOn(store, 'saveCalibrations'),
    resetRecord: vi.spyOn(store, 'resetRecord'),
    recordConfirmedStageSuccess: vi.spyOn(store, 'recordConfirmedStageSuccess'),
  };
}

it('hydrates persisted progress, vehicle and settings before showing the stage menu', async () => {
  const f = fixture();
  const persistence = appPersistence({
    progress: JSON.stringify({ version: 1, completedStages: [1], lastVehicle: 'cuv' }),
    settings: JSON.stringify({
      version: 1, volume: 0.25, muted: true, driverFovDeg: 70,
      cameraMode: 'chase', overhead: true, trajectory: true,
      inputSource: 'keyboard', resolutionScale: 1,
    }),
  });
  const app = f.app({ createPersistence: () => persistence.store });

  expect(f.root.querySelector<HTMLSelectElement>('#vehicle')?.value).toBe('cuv');
  expect(f.root.querySelector<HTMLButtonElement>('[data-stage-id="2"]')?.disabled).toBe(false);
  f.click('Lái thử mô hình');
  await f.flush();
  expect(f.prototypes[0]).toMatchObject({
    vehicleId: 'cuv',
    settings: { volume: 0.25, cameraMode: 'chase', overhead: true, trajectory: true },
  });
  app.dispose();
});

it('persists vehicle and setting changes through only their matching records', async () => {
  const f = fixture();
  const persistence = appPersistence();
  const app = f.app({ createPersistence: () => persistence.store });
  const vehicle = f.root.querySelector<HTMLSelectElement>('#vehicle')!;
  vehicle.value = 'cuv';
  vehicle.dispatchEvent(new Event('change'));
  expect(persistence.saveProgress).toHaveBeenCalledWith({
    version: 1, completedStages: [], lastVehicle: 'cuv',
  });
  expect(persistence.saveSettings).not.toHaveBeenCalled();

  await f.openPreview();
  const camera = f.root.querySelector<HTMLSelectElement>('#camera-mode')!;
  camera.value = 'chase';
  camera.dispatchEvent(new Event('change'));
  expect(persistence.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
    cameraMode: 'chase',
  }));
  expect(persistence.saveProgress).toHaveBeenCalledTimes(1);
  app.dispose();
});

it('saves calibration by stable device ID and never records success from preview actions', async () => {
  const f = fixture();
  const pad = testGamepad();
  const persistence = appPersistence();
  const app = f.app({
    createPersistence: () => persistence.store,
    getGamepads: () => [pad],
  });
  const source = f.root.querySelector<HTMLSelectElement>('#input-source')!;
  source.value = 'gamepad';
  source.dispatchEvent(new Event('change'));
  const device = f.root.querySelector<HTMLSelectElement>('#input-device')!;
  device.value = '0';
  device.dispatchEvent(new Event('change'));
  f.root.querySelector<HTMLButtonElement>('#calibrate-device')!.click();

  const click = (label: string) => {
    const button = [...f.root.querySelectorAll('button')]
      .find((candidate) => candidate.textContent === label);
    if (!button) throw new Error(`Button missing: ${label}`);
    button.click();
  };
  pad.axes[0] = -1; click('Ghi hết lái trái');
  pad.axes[0] = 0; click('Ghi chính giữa');
  pad.axes[0] = 1; click('Ghi hết lái phải');
  for (const [index, label] of [[7, 'Chân ga'], [6, 'Phanh chân']] as const) {
    pad.buttons[index]!.value = 0; click(`${label} — Ghi đã nhả`);
    pad.buttons[index]!.value = 1; click(`${label} — Ghi đã nhấn hết`);
  }
  pad.buttons[4]!.value = 1; click('Xác minh nút R');
  pad.buttons[5]!.value = 1; click('Xác minh nút D');
  click('Lưu hiệu chuẩn');

  expect(persistence.saveCalibrations).toHaveBeenCalledWith([
    expect.objectContaining({ deviceId: 'wheel' }),
  ]);
  expect(persistence.saveProgress).not.toHaveBeenCalled();
  expect(persistence.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
    inputSource: 'gamepad',
  }));
  await f.openPreview();
  expect(persistence.recordConfirmedStageSuccess).not.toHaveBeenCalled();
  app.dispose();
});

it('verifies a saved calibration only for the selected stable device ID', async () => {
  const f = fixture();
  const pad = testGamepad();
  const saved = {
    version: 1, deviceId: 'wheel', steeringAxis: 0,
    steeringLeft: -1, steeringCenter: 0, steeringRight: 1,
    throttle: { kind: 'button', index: 7, released: 0, pressed: 1 },
    brake: { kind: 'button', index: 6, released: 0, pressed: 1 },
    reverseButton: 4, driveButton: 5,
  };
  const persistence = appPersistence({
    calibration: JSON.stringify({ version: 1, entries: [saved] }),
  });
  const app = f.app({
    createPersistence: () => persistence.store,
    getGamepads: () => [pad],
  });
  const source = f.root.querySelector<HTMLSelectElement>('#input-source')!;
  source.value = 'gamepad';
  source.dispatchEvent(new Event('change'));
  const device = f.root.querySelector<HTMLSelectElement>('#input-device')!;
  device.value = '0';
  device.dispatchEvent(new Event('change'));
  expect(f.root.querySelector('#verify-saved-calibration')).not.toBeNull();
  f.click('Dùng hiệu chuẩn đã lưu');
  expect(f.root.querySelector<HTMLButtonElement>('#start-stage')?.disabled).toBe(false);
  f.click('Lái thử mô hình');
  await f.flush();

  expect(f.prototypes[0]).toMatchObject({ calibration: saved });
  expect(persistence.saveCalibrations).not.toHaveBeenCalled();
  app.dispose();
});

it('resets only the record that was explicitly confirmed', () => {
  const f = fixture();
  const persistence = appPersistence({ settings: '{invalid' });
  const app = f.app({ createPersistence: () => persistence.store });

  f.root.querySelector<HTMLButtonElement>('[data-reset-record="settings"]')!.click();
  f.root.querySelector<HTMLButtonElement>('[data-confirm-reset="settings"]')!.click();

  expect(persistence.resetRecord).toHaveBeenCalledOnce();
  expect(persistence.resetRecord).toHaveBeenCalledWith('settings');
  expect(persistence.values.has('park-core.settings.v1')).toBe(false);
  expect(persistence.values.has('park-core.progress.v1')).toBe(false);
  app.dispose();
});

it('shows a session-only notice when a persistence write fails', () => {
  const f = fixture();
  const persistence = appPersistence({}, true);
  const app = f.app({ createPersistence: () => persistence.store });
  const vehicle = f.root.querySelector<HTMLSelectElement>('#vehicle')!;
  vehicle.value = 'cuv';
  vehicle.dispatchEvent(new Event('change'));

  expect(f.root.querySelector('#status-message')?.textContent?.toLocaleLowerCase('vi'))
    .toContain('chỉ lưu trong phiên này');
  app.dispose();
});

it('loads the selected vehicle and Garage before creating a preview and releases its assets on close', async () => {
  const f = fixture();
  const assets = makeSceneAssets();
  const dispose = vi.spyOn(assets, 'dispose');
  const loadSceneAssets = vi.fn(async (
    _environment: string, _vehicle: string, _signal: AbortSignal,
    onProgress?: (progress: AssetLoadProgress) => void,
  ) => {
    onProgress?.({ resource: 'vehicle', loadedBytes: 120, totalBytes: 240 });
    return assets;
  });
  const app = f.app({ loadSceneAssets });

  f.click('Lái thử mô hình');
  expect(f.root.querySelector('#screen-layer [role="status"]')?.textContent?.toLocaleLowerCase('vi'))
    .toContain('đang tải xe');
  expect(f.root.querySelector<HTMLProgressElement>('#screen-layer progress')?.value).toBe(120);
  expect(f.root.querySelector<HTMLProgressElement>('#screen-layer progress')?.max).toBe(240);
  expect(f.factory).not.toHaveBeenCalled();
  await f.flush();

  expect(loadSceneAssets).toHaveBeenCalledWith(
    'garage', 'sedan', expect.any(AbortSignal), expect.any(Function),
  );
  expect(f.prototypes[0]).toMatchObject({ environmentId: 'garage', vehicleId: 'sedan' });
  expect((f.prototypes[0] as { sceneAssets: SceneAssets }).sceneAssets).toBe(assets);
  f.click('Quay lại menu');
  expect(dispose).toHaveBeenCalledTimes(1);
  app.dispose();
});

it('aborts loading on Menu and disposes a late result without attaching it', async () => {
  const f = fixture();
  const assets = makeSceneAssets();
  const dispose = vi.spyOn(assets, 'dispose');
  let signal: AbortSignal | undefined;
  let resolveAssets!: (value: SceneAssets) => void;
  const loadSceneAssets = vi.fn((_environment: string, _vehicle: string, request: AbortSignal) => {
    signal = request;
    return new Promise<SceneAssets>((resolve) => { resolveAssets = resolve; });
  });
  const app = f.app({ loadSceneAssets });

  f.click('Lái thử mô hình');
  f.click('Quay lại menu');
  expect(signal?.aborted).toBe(true);
  resolveAssets(assets);
  await f.flush();

  expect(f.factory).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledTimes(1);
  app.dispose();
});

it('aborts loading on app disposal and releases any late result', async () => {
  const f = fixture();
  const assets = makeSceneAssets();
  const dispose = vi.spyOn(assets, 'dispose');
  let signal: AbortSignal | undefined;
  let resolveAssets!: (value: SceneAssets) => void;
  const app = f.app({
    loadSceneAssets: (_environment, _vehicle, request) => {
      signal = request;
      return new Promise<SceneAssets>((resolve) => { resolveAssets = resolve; });
    },
  });

  f.click('Lái thử mô hình');
  app.dispose();
  expect(signal?.aborted).toBe(true);
  resolveAssets(assets);
  await f.flush();

  expect(f.factory).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledOnce();
});

it('releases loaded assets when preview initialization fails', async () => {
  const f = fixture();
  const assets = makeSceneAssets();
  const dispose = vi.spyOn(assets, 'dispose');
  f.factory.mockImplementationOnce(() => { throw new PreviewStartError('renderer-failed'); });
  const app = f.app({
    loadSceneAssets: async () => assets,
  });
  await f.openPreview();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(f.root.textContent).toContain('Không thể khởi tạo trình kết xuất');
  app.dispose();
});

it('shows a retryable localized error for a typed vehicle asset failure', async () => {
  const f = fixture();
  const app = f.app({
    loadSceneAssets: async () => { throw new AssetLoadError('vehicle', 'network'); },
  });

  await f.openPreview();

  expect(f.root.textContent).toContain('Không thể tải mẫu xe đã chọn');
  expect([...f.root.querySelectorAll('#screen-layer button')].map((node) => node.textContent))
    .toEqual(['Thử lại', 'Quay lại menu']);
  app.dispose();
});

it('hydrates storage before mounting the menu without touching WebGL', () => {
  const f = fixture();
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
  const storage = vi.spyOn(Storage.prototype, 'getItem');
  const app = f.app();
  expect(f.root.querySelector('#vehicle')).not.toBeNull();
  expect(f.root.querySelector('canvas')).toBeNull();
  expect(context).not.toHaveBeenCalled();
  expect(storage).toHaveBeenCalledTimes(3);
  expect(storage).toHaveBeenCalledWith('park-core.progress.v1');
  expect(storage).toHaveBeenCalledWith('park-core.settings.v1');
  expect(storage).toHaveBeenCalledWith('park-core.calibration.v1');
  expect(f.factory).not.toHaveBeenCalled();
  app.dispose();
});

it('ten open/close cycles keep at most one canvas and release all previews', async () => {
  const f = fixture();
  const app = f.app();
  let previous: Element | null = null;
  for (let i = 0; i < 10; i++) {
    await f.openPreview();
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

it('keeps the selected vehicle when leaving the preview', async () => {
  const f = fixture();
  const app = f.app();
  const select = f.root.querySelector<HTMLSelectElement>('#vehicle')!;
  select.value = 'cuv';
  select.dispatchEvent(new Event('change'));
  await f.openPreview();
  expect(f.root.textContent).toContain('CUV');
  f.click('Quay lại menu');
  expect(f.root.querySelector<HTMLSelectElement>('#vehicle')?.value).toBe('cuv');
  app.dispose();
});

it('requires explicit resume after preview pause', async () => {
  const f = fixture();
  const app = f.app();
  await f.openPreview();
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
  const app = f.app();
  await f.openPreview();
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

it('disposes context-lost content before showing recovery and reopens on a fresh canvas', async () => {
  const f = fixture();
  const app = f.app();
  await f.openPreview();
  const canvas = f.root.querySelector('canvas');
  f.events.onFault('context-lost');
  expect(f.live).toBe(0);
  expect(f.root.querySelector('canvas')).toBeNull();
  expect(f.root.textContent).toContain('Tải lại trang');
  f.click('Quay lại menu');
  await f.openPreview();
  expect(f.root.querySelector('canvas')).not.toBe(canvas);
  app.dispose();
});

it('surfaces startup failure without a canvas and offers retry only when recoverable', async () => {
  const f = fixture();
  f.factory.mockImplementationOnce(() => { throw new PreviewStartError('webgl-unsupported'); });
  const app = f.app();
  await f.openPreview();
  expect(f.root.querySelector('canvas')).toBeNull();
  expect([...f.root.querySelectorAll('#screen-layer button')].map((node) => node.textContent))
    .toEqual(['Quay lại menu']);
  f.click('Quay lại menu');
  f.factory.mockImplementationOnce(() => { throw new PreviewStartError('renderer-failed'); });
  await f.openPreview();
  expect(f.root.textContent).toContain('Thử lại');
  f.click('Thử lại');
  await f.flush();
  expect(f.live).toBe(1);
  app.dispose();
});

it('ignores callbacks from a closed preview rather than changing the current screen', async () => {
  const f = fixture();
  const app = f.app();
  await f.openPreview();
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
  const app = f.app();
  await f.openPreview();
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
  const app = f.app();
  await f.openPreview();
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

it('rebuilds a fresh prototype on reset and disposes the previous instance', async () => {
  const f = fixture();
  const app = f.app();
  await f.openPreview();
  const first = f.previews[0];
  const canvas = f.root.querySelector('canvas');
  f.click('Đặt lại xe');
  await f.flush();
  expect(first.dispose).toHaveBeenCalledTimes(1);
  expect(f.root.querySelector('canvas')).not.toBe(canvas);
  expect(f.live).toBe(1);
  app.dispose();
});

it('does not discover controllers until the learner selects that input source', () => {
  const f = fixture();
  const getGamepads = vi.fn(() => []);
  const app = f.app({ getGamepads });
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
  const app = f.app({ getGamepads: () => [pad] });
  await f.openPreview();
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

it('passes initial settings and persists HUD changes through settings only', async () => {
  const f = fixture();
  const persistence = appPersistence();
  const app = f.app({ createPersistence: () => persistence.store });
  await f.openPreview();

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
  expect(persistence.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
    cameraMode: 'chase',
  }));
  expect(persistence.saveProgress).not.toHaveBeenCalled();
  app.dispose();
});

it('preserves the selected input source when later HUD settings change', async () => {
  const f = fixture();
  const app = f.app();
  await f.openPreview();
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
  const app = f.app();
  await f.openPreview();
  expect(f.previews[0].resume).not.toHaveBeenCalled();
  expect(f.root.textContent).toContain('Tiếp tục lái thử');
  expect(f.root.querySelector('#status-message')?.textContent).toContain('con trỏ');
  app.dispose();
});

it('keeps native Reset connected when keyboard focus loss pauses before its click', async () => {
  const f = fixture();
  const app = f.app();
  await f.openPreview();
  const reset = [...f.root.querySelectorAll('button')].find((button) => button.textContent === 'Đặt lại xe')!;
  reset.focus();
  f.events.onPaused('focus');
  expect(reset.isConnected).toBe(true);
  reset.click();
  await f.flush();
  expect(f.factory).toHaveBeenCalledTimes(2);
  app.dispose();
});
