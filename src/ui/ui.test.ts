// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mountCalibration, mountScreen } from './screens';
import { mountHud } from './hud';
import { mountViewSettings } from './view-settings';
import type { ScreenContext, ShellView } from '../runtime-types';
import type {
  AttemptSummary, CompletedAttemptRecord, SensorSnapshot, VehicleTelemetry,
} from '../contracts';
import { testGamepad } from '../test/gamepad';
import { vi as messages } from '../messages';

afterEach(() => document.body.replaceChildren());

const context: ScreenContext = {
  onboarding: { dismissed: true, status: 'persistent' },
  onboardingResetRequested: false,
  progress: { version: 1, completedStages: [], lastVehicle: 'sedan' },
  settings: {
    version: 1, volume: 0.5, muted: false, driverFovDeg: 60,
    cameraMode: 'driver', overhead: false, trajectory: false,
    inputSource: 'keyboard', resolutionScale: 1,
  },
  selectedStageId: 1,
  selectedVehicleId: 'sedan',
  unlockedStageIds: [1],
  recordStatus: { progress: 'persistent', settings: 'persistent', calibration: 'persistent' },
  resetRequested: null,
};

function root() {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

it('renders five stages, keeps locked stages disabled, and starts Stage 1 with the selected vehicle', () => {
  const element = root();
  const action = vi.fn();
  const unmount = mountScreen(element, { kind: 'menu' }, context, action);
  expect(element.querySelector('label[for="vehicle"]')).not.toBeNull();
  const stages = [...element.querySelectorAll<HTMLButtonElement>('[data-stage-id]')];
  expect(stages).toHaveLength(5);
  expect(stages.map((stage) => stage.disabled)).toEqual([false, true, true, true, true]);
  expect(stages.slice(1).every((stage) => stage.textContent?.includes('Đã khóa'))).toBe(true);
  const select = element.querySelector<HTMLSelectElement>('#vehicle');
  expect(select).toBeInstanceOf(HTMLSelectElement);
  if (!select) throw new Error('Vehicle selector missing');
  select.value = 'cuv';
  select.dispatchEvent(new Event('change'));
  expect(action).toHaveBeenLastCalledWith({ type: 'select-vehicle', vehicleId: 'cuv' });
  element.querySelector<HTMLButtonElement>('#start-stage')?.click();
  expect(action).toHaveBeenLastCalledWith({ type: 'start', stageId: 1, vehicleId: 'cuv' });
  unmount();
  expect(element.children.length).toBe(0);
});

it('shows the F stopped hint only on the current acknowledgement step', () => {
  const lesson = { stageId: 2 as const, stepIndex: 1, stepDwellS: 0, parkingDwellS: 0,
    acknowledgedStepIds: [] };
  const element = root();
  mountScreen(element, { kind: 'playing', lesson }, context, vi.fn());
  expect(element.textContent).toContain(messages.acknowledgeHint);
  expect(messages.acknowledgeHint).toContain('F');
  element.replaceChildren();
  mountScreen(element, { kind: 'playing', lesson: { ...lesson, stepIndex: 0 } }, context, vi.fn());
  expect(element.textContent).not.toContain(messages.acknowledgeHint);
});

it('offers lesson, free-drive, and history entry points from the main menu', () => {
  const element = root();
  mountScreen(element, { kind: 'menu' }, context, vi.fn());

  const labels = [...element.querySelectorAll('button')].map((button) => button.textContent);
  expect(labels).toContain('Bắt đầu bài học');
  expect(labels).toContain('Lái tự do');
  expect(labels).toContain('Lịch sử lượt lái');
});

it('explains the parking goal visually before accepting an explicit lesson start', () => {
  const element = root();
  const action = vi.fn();
  mountScreen(element, { kind: 'briefing', stageId: 3 }, context, action);
  expect(element.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toContain('minh họa');
  expect(element.textContent).toContain('song song');
  expect(action).not.toHaveBeenCalled();
});

it('localizes acknowledged steps and obstacle labels in history details', () => {
  const element = root();
  const summary: AttemptSummary = {
    stageId: 1,
    vehicleId: 'sedan',
    outcome: 'fail',
    failureReason: 'collision',
    obstacleId: 'stage1-parked-left',
    elapsedSimulationS: 1,
    closestSampledClearanceM: null,
    peakSpeedMps: 0.2,
    directionChanges: 0,
    acknowledgedStepIds: ['survey-space'],
    usedAids: [],
  };
  const record: CompletedAttemptRecord = {
    id: 'attempt',
    completedAt: '2026-11-04T10:00:00.000Z',
    summary,
  };
  mountScreen(element, {
    kind: 'history-detail', record, status: 'persistent', resetRequested: false,
  }, context, vi.fn());

  expect(element.textContent).toContain(messages.lessonSurveySpace);
  expect(element.textContent).toContain('Xe đỗ bên trái');
  expect(element.textContent).not.toContain('survey-space');
  expect(element.textContent).not.toContain('stage1-parked-left');
});

it('enables only stages derived from the unlocked context and lets the learner select them', () => {
  const element = root();
  const action = vi.fn();
  const unlocked = {
    ...context,
    progress: { ...context.progress, completedStages: [1] as const },
    unlockedStageIds: [1, 2] as const,
  };
  mountScreen(element, { kind: 'menu' }, unlocked, action);
  expect(element.querySelector('[data-stage-id="1"]')?.textContent).toContain('Đã hoàn thành');
  const stage2 = element.querySelector<HTMLButtonElement>('[data-stage-id="2"]')!;
  expect(stage2.disabled).toBe(false);
  stage2.click();
  expect(action).toHaveBeenCalledWith({ type: 'select-stage', stageId: 2 });
});

it('shows storage recovery and session-only states in Vietnamese without color-only cues', () => {
  const element = root();
  const action = vi.fn();
  const state = {
    ...context,
    recordStatus: { progress: 'session-only', settings: 'reset-required', calibration: 'persistent' } as const,
  };
  mountScreen(element, { kind: 'menu' }, state, action);

  expect(element.querySelector('[role="status"]')?.textContent?.toLocaleLowerCase('vi'))
    .toContain('chỉ lưu trong phiên này');
  expect(element.querySelector('[role="alert"]')?.textContent?.toLocaleLowerCase('vi'))
    .toContain('không đọc được');
  const request = element.querySelector<HTMLButtonElement>('[data-reset-record="settings"]')!;
  request.click();
  expect(action).toHaveBeenCalledWith({ type: 'request-reset', record: 'settings' });
});

it('requires confirmation for the matching reset record before emitting a reset action', () => {
  const element = root();
  const action = vi.fn();
  const state = {
    ...context,
    recordStatus: { progress: 'persistent', settings: 'reset-required', calibration: 'persistent' } as const,
    resetRequested: 'settings' as const,
  };
  mountScreen(element, { kind: 'menu' }, state, action);
  expect(element.querySelector('[data-confirm-reset="settings"]')).not.toBeNull();
  expect(element.querySelector('[data-confirm-reset="progress"]')).toBeNull();
  element.querySelector<HTMLButtonElement>('[data-confirm-reset="settings"]')?.click();
  expect(action).toHaveBeenCalledWith({ type: 'confirm-reset', record: 'settings' });
});

it('offers explicit verification for a saved calibration matching the selected device', () => {
  const element = root();
  const action = vi.fn();
  mountScreen(element, { kind: 'menu' }, {
    ...context,
    settings: { ...context.settings, inputSource: 'gamepad' },
  }, action, undefined, {
    source: 'gamepad', index: 0, devices: [{ index: 0, id: 'wheel' }],
    ready: false, savedCalibrationAvailable: true,
  });

  element.querySelector<HTMLButtonElement>('#verify-saved-calibration')?.click();
  expect(action).toHaveBeenCalledWith({ type: 'verify-saved-calibration' });
});

it('shows accessible indeterminate asset progress and lets the learner cancel to the menu', () => {
  const element = root();
  const action = vi.fn();
  const view: ShellView = {
    state: { kind: 'loading', stageId: 1, mode: 'sandbox' },
    preview: 'closed',
    assetLoadProgress: { resource: 'vehicle', loadedBytes: 120, totalBytes: null },
  };
  mountScreen(element, view.state, context, action, view);

  const status = element.querySelector('[role="status"]');
  const progress = element.querySelector('progress');
  expect(status?.textContent?.toLocaleLowerCase('vi')).toContain('đang tải');
  expect(progress).not.toBeNull();
  expect(progress?.hasAttribute('value')).toBe(false);
  element.querySelector<HTMLButtonElement>('button')?.click();
  expect(action).toHaveBeenCalledWith({ type: 'menu' });
});

it('keeps unavailable HUD features empty and hidden with a discrete live status', () => {
  const element = root();
  const hud = mountHud(element, vi.fn());
  for (const id of [
    'lesson-strip', 'proximity-front', 'proximity-rear', 'telemetry', 'overhead-frame',
  ]) {
    const node = element.querySelector<HTMLElement>('#' + id);
    expect(node?.hidden).toBe(true);
    expect(node?.textContent).toBe('');
  }
  expect(element.querySelector('#status-message')?.getAttribute('aria-live')).toBe('polite');
  hud.dispose();
  expect(element.children.length).toBe(0);
});

it('keeps proximity warnings hidden until a real sample, then labels bands and distances', () => {
  const element = root();
  const hud = mountHud(element, vi.fn());
  const front = element.querySelector<HTMLElement>('#proximity-front')!;
  const rear = element.querySelector<HTMLElement>('#proximity-rear')!;
  expect(front.hidden).toBe(true);
  expect(front.textContent).toBe('');
  expect(rear.hidden).toBe(true);
  expect(rear.textContent).toBe('');

  const sensors: SensorSnapshot = {
    sampledAtS: 1,
    readings: [
      { id: 'front-left-outer', distanceM: 0.8, obstacleId: 'barrier-1', band: 'yellow' },
      { id: 'front-center', distanceM: 0.55, obstacleId: 'barrier-2', band: 'red' },
      { id: 'rear-center', distanceM: null, obstacleId: null, band: 'clear' },
    ],
  };
  hud.updateSensors(sensors);

  expect(front.hidden).toBe(false);
  expect(front.textContent).toContain('Trước');
  expect(front.textContent).toContain('ĐỎ');
  expect(front.textContent).toContain('0,55');
  expect(rear.hidden).toBe(false);
  expect(rear.textContent).toContain('Sau');
  expect(rear.textContent).toContain('Không phát hiện bằng cảm biến trong phạm vi 2,5 m');
  expect(front.className).toContain('sensor-red');

  hud.updateSensors(null);
  expect(front.hidden).toBe(true);
  expect(front.textContent).toBe('');
  expect(rear.hidden).toBe(true);
  expect(rear.textContent).toBe('');
  hud.dispose();
});

it('shows the most severe warning band rather than the nearest lower-severity sensor', () => {
  const element = root();
  const hud = mountHud(element, vi.fn());
  hud.updateSensors({
    sampledAtS: 1,
    readings: [
      { id: 'front-center', distanceM: 0.2, obstacleId: 'near', band: 'red' },
      { id: 'front-left', distanceM: 0.3, obstacleId: 'latched', band: 'stop' },
    ],
  });
  const front = element.querySelector<HTMLElement>('#proximity-front')!;
  expect(front.textContent).toContain('DỪNG');
  expect(front.className).toContain('sensor-stop');
  hud.dispose();
});

it('qualifies green and no-hit sensor readings and clears the note without a snapshot', () => {
  const element = root();
  const hud = mountHud(element, vi.fn());
  const front = element.querySelector<HTMLElement>('#proximity-front')!;
  const rear = element.querySelector<HTMLElement>('#proximity-rear')!;
  const snapshot: SensorSnapshot = {
    sampledAtS: 1,
    readings: [
      { id: 'front-center', distanceM: 1.8, obstacleId: 'barrier', band: 'green' },
      { id: 'rear-center', distanceM: null, obstacleId: null, band: 'clear' },
    ],
  };

  hud.updateSensors(snapshot);
  expect(front.textContent).toContain('PHÁT HIỆN XA');
  expect(front.textContent).not.toContain('XANH — an toàn');
  expect(front.textContent).toContain('Cảm biến có thể bỏ sót vật cản.');
  expect(rear.textContent).toContain('Không phát hiện bằng cảm biến trong phạm vi 2,5 m');
  expect(rear.textContent).toContain('Cảm biến có thể bỏ sót vật cản.');

  const guidance = front.querySelector('.sensor-guidance');
  expect(guidance).not.toBeNull();
  hud.updateSensors({
    sampledAtS: 2,
    readings: [
      { id: 'front-center', distanceM: 0.4, obstacleId: 'barrier', band: 'red' },
      { id: 'rear-center', distanceM: null, obstacleId: null, band: 'clear' },
    ],
  });
  expect(front.querySelector('.sensor-guidance')).toBe(guidance);
  expect(front.textContent).toContain('0,40 m');
  expect(front.textContent).toContain('Cảm biến có thể bỏ sót vật cản.');

  hud.updateSensors(null);
  expect(front.hidden).toBe(true);
  expect(front.textContent).toBe('');
  expect(rear.hidden).toBe(true);
  expect(rear.textContent).toBe('');
  hud.dispose();
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

it('keeps moved settings labeled and preserves edits across view and audio tabs', () => {
  const element = root();
  const action = vi.fn();
  const unmountView = mountViewSettings(element, context.settings, 'view', action);
  const controls = element.querySelector<HTMLElement>('#view-controls')!;
  expect(controls.getAttribute('role')).toBe('group');
  expect(controls.hidden).toBe(false);

  const mode = element.querySelector<HTMLSelectElement>('#camera-mode')!;
  expect(element.querySelector('label[for="camera-mode"]')?.textContent).not.toBe('');
  mode.value = 'chase';
  mode.dispatchEvent(new Event('change'));
  expect(action).toHaveBeenLastCalledWith({
    type: 'update-settings', settings: { ...context.settings, cameraMode: 'chase' },
  });

  const overhead = element.querySelector<HTMLInputElement>('#overhead-view')!;
  overhead.checked = true;
  overhead.dispatchEvent(new Event('change'));
  expect(action).toHaveBeenLastCalledWith({
    type: 'update-settings', settings: { ...context.settings, cameraMode: 'chase', overhead: true },
  });

  const trajectory = element.querySelector<HTMLInputElement>('#trajectory-view')!;
  trajectory.checked = true;
  trajectory.dispatchEvent(new Event('change'));
  expect(action).toHaveBeenLastCalledWith({
    type: 'update-settings',
    settings: { ...context.settings, cameraMode: 'chase', overhead: true, trajectory: true },
  });

  const fov = element.querySelector<HTMLInputElement>('#driver-fov')!;
  fov.value = '75';
  fov.dispatchEvent(new Event('change'));
  expect(action).toHaveBeenLastCalledWith({
    type: 'update-settings',
    settings: { ...context.settings, cameraMode: 'chase', overhead: true, trajectory: true, driverFovDeg: 75 },
  });

  element.querySelector<HTMLButtonElement>('#recenter-view')!.click();
  expect(action).toHaveBeenLastCalledWith({ type: 'recenter-view' });
  unmountView();
  const unmountAudio = mountViewSettings(element, { ...context.settings, cameraMode: 'chase',
    overhead: true, trajectory: true, driverFovDeg: 75 }, 'audio', action);
  const volume = element.querySelector<HTMLInputElement>('#volume')!;
  volume.value = '0.25';
  volume.dispatchEvent(new Event('change'));
  expect(action).toHaveBeenLastCalledWith({
    type: 'update-settings',
    settings: { ...context.settings, cameraMode: 'chase', overhead: true, trajectory: true,
      driverFovDeg: 75, volume: 0.25 },
  });

  const muted = element.querySelector<HTMLInputElement>('#mute-audio')!;
  muted.checked = true;
  muted.dispatchEvent(new Event('change'));
  expect(action).toHaveBeenLastCalledWith({
    type: 'update-settings',
    settings: { ...context.settings, cameraMode: 'chase', overhead: true, trajectory: true,
      driverFovDeg: 75, volume: 0.25, muted: true },
  });
  unmountAudio();
  expect(element.children.length).toBe(0);
});

it('updates a stable coach without stealing driving focus or showing running settings', () => {
  const element = root();
  const focus = document.createElement('canvas');
  focus.tabIndex = 0;
  element.append(focus);
  const action = vi.fn();
  const hud = mountHud(element, action);
  focus.focus();
  const coach = element.querySelector('#lesson-strip');
  hud.setSession('running');
  hud.updateLesson({ stageId: 1, stepIndex: 1, stepDwellS: 0, parkingDwellS: 0, acknowledgedStepIds: [] });
  expect(element.querySelector('#lesson-strip')).toBe(coach);
  expect(coach?.textContent).toContain(messages.lessonApproachForward);
  expect(document.activeElement).toBe(focus);
  expect(element.querySelector('#camera-mode')).toBeNull();
  expect(action).not.toHaveBeenCalled();
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
