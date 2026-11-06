// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from './app';
import {
  PreviewStartError, type Preview, type PreviewEvents, type PreviewSessionMode,
} from './render/preview';
import { testGamepad } from './test/gamepad';
import type { AttemptSummary, SensorSnapshot, VehicleTelemetry } from './contracts';
import type { AppObservation } from './app-observation';
import type { AssetLoadProgress, SceneAssets } from './runtime-types';
import { collidersForEnvironment } from './world/colliders';
import { profiles } from './vehicle/profiles';
import { buildPrototypeScene } from './render/prototype';
import { AssetLoadError } from './world/assets';
import { createPersistence, type StoragePort } from './storage/persistence';
import { createOnboarding } from './storage/onboarding';
import type {
  AttemptHistorySnapshot, AttemptHistoryStore, PersistenceRecord,
} from './runtime-types';

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
  const modes: (PreviewSessionMode | undefined)[] = [];
  const factory = vi.fn((
    canvas: HTMLCanvasElement, _container: HTMLElement, handlers: PreviewEvents, prototype: unknown,
    _overrides?: unknown, mode?: PreviewSessionMode,
  ) => {
    expect(canvas.isConnected).toBe(true);
    events = handlers;
    prototypes.push(prototype);
    modes.push(mode);
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
    root, factory, previews, prototypes, modes,
    app(overrides: Parameters<typeof createApp>[1] = {}) {
      return createApp(root, {
        createOnboarding: () => ({
          snapshot: () => ({ dismissed: true, status: 'persistent' }),
          dismiss: () => ({ dismissed: true, status: 'persistent' }),
          reset: () => ({ dismissed: false, status: 'persistent' }),
        }),
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
      this.click('Lái tự do');
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

const attemptSummary: AttemptSummary = {
  stageId: 1,
  vehicleId: 'sedan',
  outcome: 'success',
  failureReason: null,
  obstacleId: null,
  elapsedSimulationS: 4,
  closestSampledClearanceM: null,
  peakSpeedMps: 0.5,
  directionChanges: 0,
  acknowledgedStepIds: ['survey-space'],
  usedAids: [],
};

it('shows fresh onboarding without loading a simulation and remembers explicit skip', () => {
  const f = fixture();
  const store = createOnboarding(() => localStorage);
  const app = f.app({ createOnboarding: () => store });
  expect(f.root.querySelector('[data-screen="onboarding"]')).not.toBeNull();
  expect(f.factory).not.toHaveBeenCalled();
  f.click('Bỏ qua hướng dẫn');
  expect(f.root.querySelector('#start-stage')).not.toBeNull();
  app.dispose();
  const again = f.app({ createOnboarding: () => createOnboarding(() => localStorage) });
  expect(f.root.querySelector('#start-stage')).not.toBeNull();
  again.dispose();
});

it('returns from replay and device setup to pause without resuming or changing progress', async () => {
  const f = fixture();
  const app = f.app();
  await f.openPreview();
  f.events.onPaused('user');
  vi.mocked(f.previews[0]!.resume).mockClear();
  f.click('Trợ giúp');
  f.click('Xem lại hướng dẫn');
  f.click('Tiếp theo');
  f.click('Thiết lập điều khiển');
  f.click('Quay lại');
  expect(f.root.querySelector('[data-onboarding-step="1"]')).not.toBeNull();
  f.click('Bỏ qua hướng dẫn');
  expect(f.root.querySelector('[data-screen="menu"]')).not.toBeNull();
  expect(f.previews[0]!.resume).not.toHaveBeenCalled();
  expect(f.root.querySelector('#simulation')).not.toBeNull();
  app.dispose();
});

it('retains corrupt tutorial data until confirmation and keeps its warning after skip', () => {
  const f = fixture();
  localStorage.setItem('park-core.onboarding.v1', '{');
  const app = f.app({ createOnboarding: () => createOnboarding(() => localStorage) });
  f.click('Bỏ qua hướng dẫn');
  expect(f.root.querySelector('[role="alert"]')?.textContent).toContain('Hướng dẫn làm quen');
  f.click('Trợ giúp');
  f.click('Đặt lại hướng dẫn');
  f.click('Hủy');
  expect(localStorage.getItem('park-core.onboarding.v1')).toBe('{');
  f.click('Đặt lại hướng dẫn');
  f.click('Xác nhận đặt lại hướng dẫn');
  expect(localStorage.getItem('park-core.onboarding.v1')).toBeNull();
  app.dispose();
});

it('does not replace an unresolved audio warning with a routine shift notice', async () => {
  const f = fixture();
  const app = f.app();
  await f.openPreview();
  f.events.onNotice('audioUnavailable');
  f.events.onNotice('gearRejected');
  expect(f.root.querySelector('#status-message')?.textContent).toContain('Âm thanh cảnh báo không khả dụng');
  app.dispose();
});

function appHistory(
  records: AttemptHistorySnapshot['records'] = [],
  appendStatus: 'persistent' | 'session-only' | 'reset-required' = 'persistent',
) {
  let nextId = 0;
  const store: AttemptHistoryStore = {
    list: vi.fn(async () => ({ records, status: 'persistent' as const })),
    append: vi.fn(async (summary) => ({
      record: {
        id: `attempt-${++nextId}`,
        completedAt: '2026-11-04T10:00:00.000Z',
        summary,
      },
      status: appendStatus,
    })),
    reset: vi.fn(async () => 'persistent' as const),
  };
  return store;
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
  expect(f.root.querySelector('[data-stage-id="2"]')?.getAttribute('aria-pressed')).toBe('true');
  expect(f.root.querySelector<HTMLButtonElement>('[data-stage-id="2"]')?.disabled).toBe(false);
  f.click('Lái tự do');
  await f.flush();
  expect(f.prototypes[0]).toMatchObject({
    vehicleId: 'cuv',
    settings: { volume: 0.25, cameraMode: 'chase', overhead: true, trajectory: true },
  });
  app.dispose();
});

it('holds lesson assets on the briefing screen until the learner explicitly starts driving', async () => {
  const f = fixture();
  const app = f.app();

  f.click('Bắt đầu bài học');
  await f.flush();

  expect(f.root.textContent).toContain('Giai đoạn 1 — Garage: khu thử xe');
  expect(f.factory).not.toHaveBeenCalled();
  expect(f.root.querySelector('#screen-layer canvas')).toBeNull();
  f.click('Bắt đầu lái');
  await f.flush();
  expect(f.factory).toHaveBeenCalledOnce();
  expect(f.modes[0]).toMatchObject({ kind: 'lesson', scenario: { stageId: 1 } });
  app.dispose();
});

it('records each lesson outcome once and awards progression only on success', async () => {
  const f = fixture();
  const persistence = appPersistence();
  const history = appHistory();
  const app = f.app({
    createPersistence: () => persistence.store,
    createAttemptHistoryStore: () => history,
  });
  f.click('Bắt đầu bài học');
  await f.flush();
  f.click('Bắt đầu lái');
  await f.flush();
  f.events.onAttemptOutcome!(attemptSummary);
  f.events.onAttemptOutcome!(attemptSummary);
  await f.flush();

  expect(persistence.recordConfirmedStageSuccess).toHaveBeenCalledOnce();
  expect(persistence.recordConfirmedStageSuccess).toHaveBeenCalledWith(1);
  expect(history.append).toHaveBeenCalledOnce();
  expect(history.append).toHaveBeenCalledWith(attemptSummary);
  expect(f.root.textContent).toContain('Hoàn thành bài học');
  expect(f.root.textContent).toContain('Lịch sử được lưu');
  f.click('Về hành trình');
  expect(f.root.querySelector('[data-stage-id="2"]')?.getAttribute('aria-pressed')).toBe('true');
  app.dispose();
});

it('recommends Stage 5 for replay after completing the full curriculum', () => {
  const f = fixture();
  const persistence = appPersistence({
    progress: JSON.stringify({ version: 1, completedStages: [1, 2, 3, 4, 5], lastVehicle: 'sedan' }),
  });
  const app = f.app({ createPersistence: () => persistence.store });
  expect(f.root.querySelector('[data-stage-id="5"]')?.getAttribute('aria-pressed')).toBe('true');
  f.root.querySelector<HTMLButtonElement>('[data-stage-id="1"]')!.click();
  expect(f.root.querySelector('[data-stage-id="1"]')?.getAttribute('aria-pressed')).toBe('true');
  app.dispose();
});

it('does not store or award completion for a sandbox preview outcome callback', async () => {
  const f = fixture();
  const persistence = appPersistence();
  const history = appHistory();
  const app = f.app({
    createPersistence: () => persistence.store,
    createAttemptHistoryStore: () => history,
  });
  await f.openPreview();
  f.events.onAttemptOutcome!(attemptSummary);
  await f.flush();

  expect(history.append).not.toHaveBeenCalled();
  expect(persistence.recordConfirmedStageSuccess).not.toHaveBeenCalled();
  app.dispose();
});

it('persists failure recaps without awarding stage completion', async () => {
  const f = fixture();
  const persistence = appPersistence();
  const history = appHistory([], 'session-only');
  const app = f.app({
    createPersistence: () => persistence.store,
    createAttemptHistoryStore: () => history,
  });
  f.click('Bắt đầu bài học');
  await f.flush();
  f.click('Bắt đầu lái');
  await f.flush();
  const failedPreview = f.previews[0]!;
  f.events.onAttemptOutcome!({
    ...attemptSummary,
    outcome: 'fail',
    failureReason: 'collision',
    obstacleId: 'barrier',
  });
  await f.flush();

  expect(history.append).toHaveBeenCalledOnce();
  expect(persistence.recordConfirmedStageSuccess).not.toHaveBeenCalled();
  expect(f.root.textContent).toContain('Lượt lái chưa đạt');
  expect(f.root.textContent).toContain('Va chạm');
  expect(f.root.textContent).toContain('chỉ được giữ trong phiên này');
  f.click('Thử lại bài học');
  await f.flush();
  expect(f.root.textContent).toContain('Giai đoạn 1 — Garage: khu thử xe');
  expect(f.factory).toHaveBeenCalledOnce();
  expect(failedPreview.dispose).toHaveBeenCalledOnce();
  f.click('Bắt đầu lái');
  await f.flush();
  expect(f.factory).toHaveBeenCalledTimes(2);
  expect(f.modes[1]).toMatchObject({ kind: 'lesson', scenario: { stageId: 1 } });
  app.dispose();
});

it('lists, opens, returns from, and explicitly resets attempt history', async () => {
  const f = fixture();
  const record = {
    id: 'stored-attempt',
    completedAt: '2026-11-04T10:00:00.000Z',
    summary: attemptSummary,
  };
  const history = appHistory([record]);
  const app = f.app({ createAttemptHistoryStore: () => history });
  f.click('Lịch sử lượt lái');
  await f.flush();

  expect(f.root.textContent).toContain('Giai đoạn 1');
  f.click(f.root.querySelector<HTMLButtonElement>('[data-attempt-id]')!.textContent ?? '');
  expect(f.root.textContent).toContain('Các bước đã xác nhận');
  f.click('Quay lại lịch sử');
  f.click('Đặt lại lịch sử');
  expect(f.root.textContent).toContain('Xác nhận xóa lịch sử');
  f.click('Xác nhận xóa lịch sử');
  await f.flush();
  expect(history.reset).toHaveBeenCalledOnce();
  expect(history.list).toHaveBeenCalledTimes(2);
  app.dispose();
});

it('ignores a late history read after returning to the main menu', async () => {
  const f = fixture();
  const history = appHistory();
  let resolveHistory!: (snapshot: AttemptHistorySnapshot) => void;
  vi.mocked(history.list).mockImplementation(() => new Promise((resolve) => {
    resolveHistory = resolve;
  }));
  const app = f.app({ createAttemptHistoryStore: () => history });
  f.click('Lịch sử lượt lái');
  f.click('Quay lại menu');
  resolveHistory({ records: [], status: 'persistent' });
  await f.flush();

  expect(f.root.querySelector('#vehicle')).not.toBeNull();
  expect(f.root.textContent).not.toContain('Chưa có lượt lái hoàn thành');
  app.dispose();
});

it('ignores a late history read after app disposal', async () => {
  const f = fixture();
  const history = appHistory();
  let resolveHistory!: (snapshot: AttemptHistorySnapshot) => void;
  vi.mocked(history.list).mockImplementation(() => new Promise((resolve) => {
    resolveHistory = resolve;
  }));
  const app = f.app({ createAttemptHistoryStore: () => history });
  f.click('Lịch sử lượt lái');
  app.dispose();
  resolveHistory({ records: [], status: 'persistent' });
  await f.flush();

  expect(f.root.children).toHaveLength(0);
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
  f.events.onPaused('focus');
  f.click('Cài đặt');
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
  const capture = () => click('Ghi nhận vị trí này');
  pad.axes[0] = -1; capture();
  pad.axes[0] = 0; capture();
  pad.axes[0] = 1; capture();
  for (const index of [7, 6]) {
    pad.buttons[index]!.value = 0; capture();
    pad.buttons[index]!.value = 1; capture();
  }
  pad.buttons[4]!.value = 1; capture();
  pad.buttons[5]!.value = 1; capture();
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

it('opens a selected controller profile for verification without saving it automatically', () => {
  const f = fixture();
  const pad = testGamepad();
  pad.id = 'Xbox Wireless Controller Series X';
  const persistence = appPersistence();
  const app = f.app({
    createPersistence: () => persistence.store,
    getGamepads: () => [pad],
  });
  try {
    const source = f.root.querySelector<HTMLSelectElement>('#input-source')!;
    source.value = 'gamepad';
    source.dispatchEvent(new Event('change'));
    const device = f.root.querySelector<HTMLSelectElement>('#input-device')!;
    device.value = '0';
    device.dispatchEvent(new Event('change'));

    const profile = f.root.querySelector<HTMLButtonElement>(
      '[data-controller-profile="xbox-series-x"]',
    );
    expect(profile).not.toBeNull();
    profile?.click();
    expect(f.root.querySelector('[role="dialog"]')).not.toBeNull();
    expect(f.root.querySelector('[data-capture-progress]')?.textContent).toContain('0 / 6');
    expect(persistence.saveCalibrations).not.toHaveBeenCalled();
  } finally {
    app.dispose();
  }
});

it('saves a profile only after all checks and binds it to the actual device ID', () => {
  const f = fixture();
  const pad = testGamepad();
  pad.id = 'Xbox Wireless Controller Series X';
  const persistence = appPersistence();
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const tick = () => {
    const callback = frames.shift();
    if (!callback) throw new Error('Calibration animation frame missing');
    callback(0);
  };
  const app = f.app({
    createPersistence: () => persistence.store,
    getGamepads: () => [pad],
  });
  try {
    const source = f.root.querySelector<HTMLSelectElement>('#input-source')!;
    source.value = 'gamepad';
    source.dispatchEvent(new Event('change'));
    const device = f.root.querySelector<HTMLSelectElement>('#input-device')!;
    device.value = '0';
    device.dispatchEvent(new Event('change'));
    f.root.querySelector<HTMLButtonElement>(
      '[data-controller-profile="xbox-series-x"]',
    )!.click();
    expect(persistence.saveCalibrations).not.toHaveBeenCalled();

    const checkAxis = (active: number) => {
      tick();
      pad.axes[0] = active;
      tick(); tick(); tick();
      pad.axes[0] = 0;
      tick();
    };
    const checkButton = (index: number) => {
      tick();
      pad.buttons[index]!.value = 1;
      pad.buttons[index]!.pressed = true;
      tick(); tick(); tick();
      pad.buttons[index]!.value = 0;
      pad.buttons[index]!.pressed = false;
      tick();
    };
    checkAxis(-1);
    checkAxis(1);
    for (const index of [7, 6, 4, 5]) checkButton(index);

    expect(f.root.querySelector('[data-capture-progress]')?.textContent).toContain('6 / 6');
    expect(persistence.saveCalibrations).not.toHaveBeenCalled();
    f.click('Lưu hiệu chuẩn');
    expect(persistence.saveCalibrations).toHaveBeenCalledWith([
      expect.objectContaining({ deviceId: 'Xbox Wireless Controller Series X' }),
    ]);
    expect(f.root.querySelector<HTMLButtonElement>('#start-stage')?.disabled).toBe(false);
  } finally {
    app.dispose();
  }
});

it('does not save or mark input ready when the selected profile device is replaced', () => {
  const f = fixture();
  const pad = testGamepad();
  pad.id = 'Xbox Wireless Controller Series X';
  const persistence = appPersistence();
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const app = f.app({
    createPersistence: () => persistence.store,
    getGamepads: () => [pad],
  });
  try {
    const source = f.root.querySelector<HTMLSelectElement>('#input-source')!;
    source.value = 'gamepad';
    source.dispatchEvent(new Event('change'));
    const device = f.root.querySelector<HTMLSelectElement>('#input-device')!;
    device.value = '0';
    device.dispatchEvent(new Event('change'));
    f.root.querySelector<HTMLButtonElement>(
      '[data-controller-profile="xbox-series-x"]',
    )!.click();

    pad.id = 'Replacement Controller';
    const callback = frames.shift();
    if (!callback) throw new Error('Calibration animation frame missing');
    callback(0);

    expect(f.root.querySelector('[role="alert"]')?.textContent).toContain('đã bị thay');
    const save = [...f.root.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Lưu hiệu chuẩn');
    expect(save?.disabled).toBe(true);
    f.click('Hủy');
    expect(persistence.saveCalibrations).not.toHaveBeenCalled();
    expect(f.root.querySelector<HTMLButtonElement>('#start-stage')?.disabled).toBe(true);
    expect((document.activeElement as HTMLElement).dataset.controllerProfile).toBe('xbox-series-x');
  } finally {
    app.dispose();
  }
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
  f.click('Lái tự do');
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

it('exposes denied settings saves inside the active overlay without losing focus or expiring', async () => {
  const f = fixture();
  const persistence = appPersistence({}, true);
  const app = f.app({ createPersistence: () => persistence.store });
  await f.openPreview();
  f.events.onPaused('focus');
  f.click('Cài đặt');
  vi.useFakeTimers();
  try {
    f.events.onNotice('gearRejected');
    const camera = f.root.querySelector<HTMLSelectElement>('#camera-mode')!;
    camera.focus();
    camera.value = 'chase';
    camera.dispatchEvent(new Event('change'));
    expect(f.root.querySelector('[role="dialog"]')?.textContent).toContain('Chỉ lưu trong phiên này');
    expect(document.activeElement?.id).toBe('camera-mode');
    vi.advanceTimersByTime(6000);
    expect(f.root.querySelector('#status-message')?.textContent).toContain('chỉ lưu trong phiên này');
    f.events.onNotice('gearRejected');
    expect(f.root.querySelector('#status-message')?.textContent).toContain('chỉ lưu trong phiên này');
  } finally { app.dispose(); vi.useRealTimers(); }
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

  f.click('Lái tự do');
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

  f.click('Lái tự do');
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

  f.click('Lái tự do');
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
    expect(f.root.textContent).toContain('Lái tự do · Không tính tiến độ bài học');
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
  expect(f.prototypes[0]).toMatchObject({ vehicleId: 'cuv' });
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
  expect([...f.root.querySelectorAll('button')].find((button) => button.textContent === 'Lái tự do')?.disabled)
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
  f.events.onPaused('focus');
  f.click('Cài đặt');
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
  f.click('Cài đặt');
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

const observedTelemetry: VehicleTelemetry = {
  simulationTimeS: 1, vehicleId: 'sedan',
  pose: { positionM: [1, 0, 2], rotation: [0, 0, 0, 1] },
  headingRad: 0, signedSpeedMps: 1, totalSpeedMps: 1, angularSpeedRadps: 0,
  steeringWheelRad: 0, frontWheelAnglesRad: [0, 0], gear: 'D', parkingBrake: false,
  indicator: 'off', brake: 0,
};

it('observes lesson session and initial lesson before telemetry, with per-generation identity', async () => {
  const f = fixture();
  const seen: AppObservation[] = [];
  const app = f.app({ onObservation: (event) => seen.push(event) });
  f.click('Bắt đầu bài học');
  await f.flush();
  f.click('Bắt đầu lái');
  await f.flush();
  f.events.onTelemetry!(observedTelemetry);
  expect(seen.map((event) => event.kind)).toEqual(['session', 'lesson', 'resumed', 'telemetry']);
  expect(seen[0]).toMatchObject({ kind: 'session', stageId: 1, vehicleId: 'sedan' });
  expect(seen.map((event) => event.sequence)).toEqual([0, 1, 2, 3]);
  expect(new Set(seen.map((event) => event.generation)).size).toBe(1);
  expect(seen.every((event) => typeof event.capturedAtMs === 'number')).toBe(true);
  const first = seen[0].generation;
  f.events.onPaused('user');
  expect(seen.at(-1)).toMatchObject({ kind: 'paused', reason: 'user' });
  app.dispose();
  expect(seen.at(-1)).toMatchObject({ kind: 'closed', generation: first });
  expect(seen.at(-1)!.sequence).toBe(seen.length - 1);
});

it('observes sandbox with null stage and fresh generation per preview', async () => {
  const f = fixture();
  const seen: AppObservation[] = [];
  const app = f.app({ onObservation: (event) => seen.push(event) });
  await f.openPreview();
  f.click('Quay lại menu');
  await f.openPreview();
  const sessions = seen.filter((event) => event.kind === 'session');
  expect(sessions).toHaveLength(2);
  expect(sessions[0]).toMatchObject({ stageId: null });
  expect(sessions[1].generation).not.toBe(sessions[0].generation);
  expect(seen.filter((event) => event.kind === 'closed')).toHaveLength(1);
  expect(seen.some((event) => event.kind === 'lesson')).toBe(false);
  expect(sessions[1].sequence).toBe(0);
  app.dispose();
});

it('ignores stale preview callbacks and detaches observed objects from runtime and history', async () => {
  const f = fixture();
  const seen: AppObservation[] = [];
  const history = appHistory();
  const app = f.app({
    onObservation: (event) => {
      seen.push(event);
      if (event.kind === 'outcome') (event.summary.acknowledgedStepIds as string[]).push('mutated');
      if (event.kind === 'telemetry') (event.telemetry.pose.positionM as unknown as number[])[0] = 99;
    },
    createAttemptHistoryStore: () => history,
  });
  f.click('Bắt đầu bài học');
  await f.flush();
  f.click('Bắt đầu lái');
  await f.flush();
  const old = f.events;
  f.events.onTelemetry!(observedTelemetry);
  f.events.onAttemptOutcome!(attemptSummary);
  await f.flush();
  expect(observedTelemetry.pose.positionM[0]).toBe(1);
  expect(attemptSummary.acknowledgedStepIds).toEqual(['survey-space']);
  expect(history.append).toHaveBeenCalledWith(attemptSummary);
  f.click('Quay lại menu');
  const count = seen.length;
  old.onTelemetry!(observedTelemetry);
  old.onPaused('focus');
  old.onLessonUpdate!({
    stageId: 1, stepIndex: 0, stepDwellS: 0, parkingDwellS: 0, acknowledgedStepIds: [],
  });
  expect(seen).toHaveLength(count);
  app.dispose();
});

it('turns observer failures into the standard runtime fault', async () => {
  const f = fixture();
  const app = f.app({
    onObservation: (event) => { if (event.kind === 'lesson') throw new Error('observer'); },
  });
  f.click('Bắt đầu bài học');
  await f.flush();
  f.click('Bắt đầu lái');
  await f.flush();
  expect(f.root.querySelector('[role="alert"]')).not.toBeNull();
  expect(f.live).toBe(0);
  app.dispose();
});
