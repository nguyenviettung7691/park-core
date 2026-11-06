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
import { calibrationForProfile, controllerProfiles } from '../input/profiles';

afterEach(() => document.body.replaceChildren());

const context: ScreenContext = {
  onboarding: { dismissed: true, status: 'persistent' },
  onboardingResetRequested: false,
  progress: { version: 1, completedStages: [], lastVehicle: 'sedan' },
  settings: {
    version: 1, volume: 0.5, muted: false, driverFovDeg: 60,
    cameraMode: 'driver', overhead: false, trajectory: false,
    inputSource: 'keyboard', preset: 'high', resolutionScale: 1,
    frameRateCap: 'display', antialias: true,
    mirrorQuality: 'high', overheadQuality: 'high',
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

function animationClock() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callbacks.set(++next, callback);
    return next;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    callbacks.delete(id);
  });
  return {
    tick(count = 1) {
      for (let frame = 0; frame < count; frame++) {
        const entry = callbacks.entries().next().value as
          [number, FrameRequestCallback] | undefined;
        if (!entry) throw new Error('Animation frame was not scheduled');
        callbacks.delete(entry[0]);
        entry[1](16);
      }
    },
  };
}

function profileGamepad() {
  const pad = testGamepad();
  pad.axes.splice(0, pad.axes.length, 0, 0, 0);
  return pad;
}

it('renders a decorative parking mark beside the accessible menu heading', () => {
  const element = root();
  mountScreen(element, { kind: 'menu' }, context, vi.fn());

  const heading = element.querySelector('h1');
  const mark = element.querySelector<HTMLImageElement>('.brand-mark');
  expect(heading?.textContent).toBe('Park-Core');
  expect(mark?.getAttribute('src')).toBe('/park-core-mark.svg');
  expect(mark?.getAttribute('alt')).toBe('');
  expect(mark?.getAttribute('aria-hidden')).toBe('true');
  expect(mark?.parentElement?.contains(heading)).toBe(true);
});

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

const recap: AttemptSummary = {
  stageId: 5, vehicleId: 'sedan', outcome: 'success', failureReason: null, obstacleId: null,
  elapsedSimulationS: 40, closestSampledClearanceM: null, peakSpeedMps: 0.4,
  directionChanges: 2, acknowledgedStepIds: [], usedAids: [],
};

it.each([
  ['collision', 'Va chạm', 'hai đầu xe'],
  ['curb-contact', 'Chạm lề', 'lề đường'],
  ['out-of-bounds', 'Ra khỏi khu vực lái', 'ranh giới'],
  ['tipped', 'Xe nghiêng quá giới hạn', 'giảm tốc'],
  ['speed-envelope', 'Vượt tốc độ an toàn kéo dài', 'chân phanh'],
] as const)('offers a specific practice tip for %s without hiding the recorded metrics', (failureReason, reason, tip) => {
  const element = root();
  mountScreen(element, { kind: 'fail', summary: { ...recap, outcome: 'fail', failureReason },
    historyStatus: 'persistent' }, context, vi.fn());
  expect(element.querySelector('[data-practice-tip]')?.textContent).toContain(tip);
  expect(element.textContent).toContain(reason);
  expect(element.querySelector('details')?.open).toBe(false);
  expect(element.querySelector('details dl')?.textContent).toContain(messages.historyPeakSpeed);
  expect(element.querySelector('.primary-action')?.textContent).toBe(messages.retryLesson);
});

it('pages all history records in batches without dropping older attempts', () => {
  const element = root();
  const records = Array.from({ length: 45 }, (_, index): CompletedAttemptRecord => ({
    id: `attempt-${index}`, completedAt: '2026-11-04T10:00:00.000Z', summary: recap,
  }));
  const action = vi.fn();
  mountScreen(element, { kind: 'history-list', records, status: 'persistent', resetRequested: false }, context, action);
  expect(element.querySelectorAll('[data-attempt-id]')).toHaveLength(20);
  const more = [...element.querySelectorAll('button')].find((node) => node.textContent === 'Xem thêm lượt lái')!;
  more.click();
  expect(element.querySelectorAll('[data-attempt-id]')).toHaveLength(40);
  more.click();
  expect(element.querySelectorAll('[data-attempt-id]')).toHaveLength(45);
  expect(more.hidden).toBe(true);
  element.querySelector<HTMLButtonElement>('[data-attempt-id="attempt-44"]')!.click();
  expect(action).toHaveBeenLastCalledWith({ type: 'select-attempt', id: 'attempt-44' });
});

it('returns from Stage 5 to the journey without suggesting a sixth lesson', () => {
  const element = root();
  const action = vi.fn();
  mountScreen(element, { kind: 'success', summary: recap, historyStatus: 'persistent' }, context, action);
  expect(element.querySelector('[data-recap-outcome]')?.textContent).toContain('mục tiêu');
  element.querySelector<HTMLButtonElement>('.primary-action')!.click();
  expect(action).toHaveBeenCalledWith({ type: 'continue' });
  expect(element.textContent).not.toContain('Giai đoạn 6');
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
    profiles: controllerProfiles, matchedProfileId: null,
  });

  element.querySelector<HTMLButtonElement>('#verify-saved-calibration')?.click();
  expect(action).toHaveBeenCalledWith({ type: 'verify-saved-calibration' });
});

it('offers named profiles, marks an exact match as a suggestion, and keeps manual calibration available', () => {
  const element = root();
  const action = vi.fn();
  const setup = {
    source: 'gamepad' as const, index: 0,
    devices: [{ index: 0, id: 'Xbox Wireless Controller Series X' }],
    ready: false, savedCalibrationAvailable: false,
    profiles: controllerProfiles, matchedProfileId: 'xbox-series-x' as const,
  };
  const view: ShellView = {
    state: { kind: 'menu' }, preview: 'closed',
    overlay: { kind: 'settings', tab: 'input', returnTo: { kind: 'menu' } },
  };
  mountScreen(element, view.state, {
    ...context, settings: { ...context.settings, inputSource: 'gamepad' },
  }, action, view, setup);

  expect(element.querySelector('[data-profile-match-status]')?.textContent)
    .toContain('Khớp với thiết bị hiện tại');
  const choices = [...element.querySelectorAll<HTMLButtonElement>('[data-controller-profile]')];
  expect(choices).toHaveLength(6);
  expect(choices.map((choice) => choice.textContent)).toContain('Xbox Wireless Controller (Series X)');
  expect(element.querySelector('#calibrate-device')).not.toBeNull();
  element.querySelector<HTMLButtonElement>('[data-controller-profile="xbox-series-x"]')!.click();
  expect(action).toHaveBeenCalledWith({
    type: 'open-profile-verification', profileId: 'xbox-series-x',
  });
});

it('keeps named profile choice and manual calibration available for an unmatched device', () => {
  const element = root();
  const action = vi.fn();
  const setup = {
    source: 'gamepad' as const, index: 0,
    devices: [{ index: 0, id: 'Unknown Controller' }],
    ready: false, savedCalibrationAvailable: false,
    profiles: controllerProfiles, matchedProfileId: null,
  };
  const view: ShellView = {
    state: { kind: 'menu' }, preview: 'closed',
    overlay: { kind: 'settings', tab: 'input', returnTo: { kind: 'menu' } },
  };
  mountScreen(element, view.state, {
    ...context, settings: { ...context.settings, inputSource: 'gamepad' },
  }, action, view, setup);

  expect(element.querySelector('[data-profile-match-status]')?.textContent)
    .toContain('Chưa nhận diện chính xác');
  expect(element.querySelectorAll('[data-controller-profile]')).toHaveLength(6);
  const manual = element.querySelector<HTMLButtonElement>('#calibrate-device');
  expect(manual?.disabled).toBe(false);
  manual?.click();
  expect(action).toHaveBeenCalledWith({ type: 'open-calibration' });
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

it('announces sensor severity and direction changes without repeating distance samples', () => {
    const element = root();
    const hud = mountHud(element, vi.fn());
    const update = (distanceM: number, id: 'front-center' | 'front-left' = 'front-center') =>
      hud.updateSensors({ sampledAtS: 1, readings: [{ id, distanceM, obstacleId: 'wall', band: 'red' }] });
    update(0.55);
    const announcement = element.querySelector<HTMLElement>('#sensor-announcement')!;
    expect(announcement?.getAttribute('aria-live')).toBe('polite');
    expect(announcement?.textContent).toContain('ĐỎ');
    const original = announcement.firstChild;
    update(0.54);
    expect(announcement.firstChild).toBe(original);
    update(0.53, 'front-left');
    expect(announcement.firstChild).not.toBe(original);
    hud.updateSensors(null);
    expect(announcement.textContent).toBe('');
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

it('guides manual calibration one illustrated capture at a time in the nine-control order', () => {
  animationClock();
  const element = root();
  const previousFocus = document.createElement('button');
  document.body.append(previousFocus);
  previousFocus.focus();
  const pad = testGamepad();
  const unmount = mountCalibration(element, 0, () => [pad], vi.fn(), vi.fn());
  const expected = [
    ['steering-left', 'steering'],
    ['steering-center', 'steering'],
    ['steering-right', 'steering'],
    ['throttle-released', 'throttle'],
    ['throttle-pressed', 'throttle'],
    ['brake-released', 'brake'],
    ['brake-pressed', 'brake'],
    ['reverse', 'reverse'],
    ['drive', 'drive'],
  ] as const;
  const samples = [
    () => { pad.axes[0] = -1; },
    () => { pad.axes[0] = 0; },
    () => { pad.axes[0] = 1; },
    () => { pad.buttons[7]!.value = 0; },
    () => { pad.buttons[7]!.value = 1; },
    () => { pad.buttons[6]!.value = 0; },
    () => { pad.buttons[6]!.value = 1; },
    () => { pad.buttons[4]!.value = 1; },
    () => { pad.buttons[5]!.value = 1; },
  ];
  const kind = element.querySelector<HTMLSelectElement>('[data-illustration-kind]');
  expect(kind?.value).toBe('gamepad');
  kind!.value = 'wheel';
  kind!.dispatchEvent(new Event('change'));
  const wheelIllustration = element.querySelector('svg[role="img"]');
  expect(wheelIllustration?.getAttribute('data-controller-kind')).toBe('wheel');
  expect(wheelIllustration?.getAttribute('aria-label')).toContain('vô lăng');
  kind!.value = 'gamepad';
  kind!.dispatchEvent(new Event('change'));
  expect(element.querySelector('details')?.open).toBe(false);

  expected.forEach(([step, part], index) => {
    expect(element.querySelector('[data-calibration-step]')?.getAttribute('data-calibration-step'))
      .toBe(step);
    expect(element.querySelector('svg[role="img"]')?.getAttribute('data-highlighted-part'))
      .toBe(part);
    expect(element.querySelector(`svg [data-part="${part}"][data-active="true"]`)).not.toBeNull();
    expect(element.querySelector('[data-capture-progress]')?.textContent)
      .toContain(`${index} / 9`);
    samples[index]!();
    const capture = element.querySelector<HTMLButtonElement>('[data-calibration-capture]')!;
    if (index === expected.length - 1) capture.focus();
    capture.click();
    if (index === expected.length - 1) {
      expect(document.activeElement).toBe([...element.querySelectorAll('button')]
        .find((button) => button.textContent === messages.saveCalibration));
    }
  });
  expect(element.querySelector('[data-capture-progress]')?.textContent).toContain('9 / 9');
  expect(element.querySelector<HTMLButtonElement>('[data-calibration-capture]')?.hidden).toBe(true);
  unmount();
  expect(document.activeElement).toBe(previousFocus);
  vi.restoreAllMocks();
});

it('clears the current manual step when the connected device is replaced', () => {
  const clock = animationClock();
  const element = root();
  const pad = testGamepad();
  const unmount = mountCalibration(element, 0, () => [pad], vi.fn(), vi.fn());
  pad.axes[0] = -1;
  element.querySelector<HTMLButtonElement>('[data-calibration-capture]')!.click();
  expect(element.querySelector('[data-capture-progress]')?.textContent).toContain('1 / 9');
  pad.id = 'replacement';
  clock.tick();
  expect(element.querySelector('[data-capture-progress]')?.textContent).toContain('0 / 9');
  expect(element.querySelector('[role="alert"]')?.textContent).toContain('thiết bị khác');
  expect(element.querySelector<HTMLButtonElement>('[data-calibration-capture]')?.disabled).toBe(true);
  unmount();
  vi.restoreAllMocks();
});

it('allows restarting manual capture when completed endpoints are invalid', () => {
  animationClock();
  const element = root();
  const pad = testGamepad();
  const unmount = mountCalibration(element, 0, () => [pad], vi.fn(), vi.fn());
  const samples = [
    () => { pad.axes[0] = 0; },
    () => { pad.axes[0] = 0; },
    () => { pad.axes[0] = 1; },
    () => { pad.buttons[7]!.value = 0; },
    () => { pad.buttons[7]!.value = 1; },
    () => { pad.buttons[6]!.value = 0; },
    () => { pad.buttons[6]!.value = 1; },
    () => { pad.buttons[4]!.value = 1; },
    () => { pad.buttons[5]!.value = 1; },
  ];
  for (const setSample of samples) {
    setSample();
    element.querySelector<HTMLButtonElement>('[data-calibration-capture]')!.click();
  }
  const save = [...element.querySelectorAll('button')]
    .find((button) => button.textContent === messages.saveCalibration);
  const restart = element.querySelector<HTMLButtonElement>('[data-calibration-capture]');
  expect(save?.disabled).toBe(true);
  expect(restart?.hidden).toBe(false);
  expect(restart?.textContent).toBe('Bắt đầu lại');
  restart?.click();
  expect(element.querySelector('[data-capture-progress]')?.textContent).toContain('0 / 9');
  expect(element.querySelector('[data-calibration-step]')?.getAttribute('data-calibration-step'))
    .toBe('steering-left');
  unmount();
  vi.restoreAllMocks();
});

it('uses a selected profile kind for the verification illustration', () => {
  animationClock();
  const element = root();
  const profile = controllerProfiles.find(({ id }) => id === 'logitech-g29')!;
  const unmount = mountCalibration(element, 0, () => [testGamepad()], vi.fn(), vi.fn(), profile);
  const illustration = element.querySelector('svg[role="img"]');
  expect(illustration?.getAttribute('data-controller-kind')).toBe('wheel');
  expect(illustration?.getAttribute('data-highlighted-part')).toBe('steering');
  expect(illustration?.getAttribute('aria-label')).toContain('vô lăng');
  const fallback = element.querySelector<HTMLButtonElement>('[data-manual-fallback]')!;
  fallback.focus();
  fallback.click();
  expect(document.activeElement).toBe(element.querySelector('[data-calibration-capture]'));
  expect(element.querySelector('[data-calibration-step]')?.getAttribute('data-calibration-step'))
    .toBe('steering-left');
  expect(element.querySelector('[data-capture-progress]')?.textContent).toContain('0 / 9');
  expect(element.querySelector('svg[role="img"]')?.getAttribute('data-controller-kind')).toBe('wheel');
  unmount();
  vi.restoreAllMocks();
});

it('allows fresh manual calibration after a preset device is replaced', () => {
  const clock = animationClock();
  const element = root();
  const pad = profileGamepad();
  const profile = controllerProfiles.find(({ id }) => id === 'xbox-series-x')!;
  const unmount = mountCalibration(element, 0, () => [pad], vi.fn(), vi.fn(), profile);
  pad.id = 'replacement';
  clock.tick();
  expect(element.querySelector('[data-capture-progress]')?.textContent).toContain('0 / 6');
  element.querySelector<HTMLButtonElement>('[data-manual-fallback]')!.click();
  clock.tick();
  const capture = element.querySelector<HTMLButtonElement>('[data-calibration-capture]');
  expect(element.querySelector('[data-capture-progress]')?.textContent).toContain('0 / 9');
  expect(capture?.disabled).toBe(false);
  pad.axes[0] = -1;
  capture?.click();
  expect(element.querySelector('[data-capture-progress]')?.textContent).toContain('1 / 9');
  unmount();
  vi.restoreAllMocks();
});

it('groups device setup, keeps diagnostics optional, and contains keyboard focus', () => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  const element = root();
  const pad = testGamepad();
  pad.id = 'Long wheel device '.repeat(24);
  const cancel = vi.fn();
  const unmount = mountCalibration(element, 0, () => [pad], vi.fn(), cancel);
  expect([...element.querySelectorAll('legend')].map((node) => node.textContent))
    .toEqual(['Vô lăng']);
  expect(element.querySelector('details')?.open).toBe(false);
  expect(element.querySelector('details pre')).not.toBeNull();
  expect(element.querySelector('[data-calibration-device]')?.textContent).toBe(pad.id);
  expect(element.querySelector<HTMLSelectElement>('[data-illustration-kind]')?.value).toBe('gamepad');
  expect(element.querySelector('svg[role="img"]')?.getAttribute('data-highlighted-part')).toBe('steering');
  const buttons = [...element.querySelectorAll('button')];
  expect(element.querySelector('[data-capture-progress]')?.textContent).toContain('0 / 9');
  expect(buttons.some((node) => node.dataset.calibrationCapture !== undefined)).toBe(true);
  const last = element.querySelector<HTMLElement>('summary')!;
  last.focus();
  last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(element.querySelector('[data-illustration-kind]'));
  last.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
  expect(cancel).toHaveBeenCalledOnce();
  unmount();
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
  function capture(step: string, setSample: () => void) {
    expect(element.querySelector('[data-calibration-step]')?.getAttribute('data-calibration-step'))
      .toBe(step);
    setSample();
    element.querySelector<HTMLButtonElement>('[data-calibration-capture]')!.click();
  }
  function captureAll() {
    capture('steering-left', () => { pad.axes[0] = -1; });
    capture('steering-center', () => { pad.axes[0] = 0; });
    capture('steering-right', () => { pad.axes[0] = 1; });
    capture('throttle-released', () => { pad.buttons[7]!.value = 0; });
    capture('throttle-pressed', () => { pad.buttons[7]!.value = 1; });
    capture('brake-released', () => { pad.buttons[6]!.value = 0; });
    capture('brake-pressed', () => { pad.buttons[6]!.value = 1; });
    capture('reverse', () => { pad.buttons[4]!.value = 1; });
    capture('drive', () => { pad.buttons[5]!.value = 1; });
  }
  capture('steering-left', () => { pad.axes[0] = -1; });
  const axis = element.querySelector<HTMLInputElement>('input')!;
  axis.value = '1'; axis.dispatchEvent(new Event('change'));
  expect(element.querySelector('[data-capture-progress]')?.textContent).toContain('0 / 9');
  const resetAxis = element.querySelector<HTMLInputElement>('input')!;
  resetAxis.value = '0'; resetAxis.dispatchEvent(new Event('change'));
  captureAll();
  const save = [...element.querySelectorAll('button')].find((button) => button.textContent === 'Lưu hiệu chuẩn')!;
  expect(save.disabled).toBe(false);
  save.click();
  expect(complete).toHaveBeenLastCalledWith({
    version: 1, deviceId: 'wheel', steeringAxis: 0, steeringLeft: -1, steeringCenter: 0,
    steeringRight: 1, throttle: { kind: 'button', index: 7, released: 0, pressed: 1 },
    brake: { kind: 'button', index: 6, released: 0, pressed: 1 }, reverseButton: 4, driveButton: 5,
  });
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

it('auto-verifies each profile control and waits for neutral before advancing', () => {
  const clock = animationClock();
  const element = root();
  const pad = profileGamepad();
  const complete = vi.fn();
  const profile = controllerProfiles.find(({ id }) => id === 'xbox-series-x')!;
  const unmount = mountCalibration(element, 0, () => [pad], complete, vi.fn(), profile);
  const progress = element.querySelector<HTMLElement>('[data-capture-progress]');
  expect(progress?.textContent).toContain('0 / 6');
  clock.tick();

  function checkAxis(index: number, value: number, neutral: number) {
    clock.tick();
    pad.axes[index] = value;
    clock.tick(3);
    expect(progress?.textContent).toContain(`${verified} / 6`);
    pad.axes[index] = neutral;
    clock.tick();
    verified++;
    expect(progress?.textContent).toContain(`${verified} / 6`);
  }
  function checkButton(index: number) {
    clock.tick();
    pad.buttons[index]!.value = 1;
    pad.buttons[index]!.pressed = true;
    clock.tick(3);
    expect(progress?.textContent).toContain(`${verified} / 6`);
    pad.buttons[index]!.value = 0;
    pad.buttons[index]!.pressed = false;
    clock.tick();
    verified++;
    expect(progress?.textContent).toContain(`${verified} / 6`);
  }

  let verified = 0;
  checkAxis(0, -1, 0);
  checkAxis(0, 1, 0);
  checkButton(7);
  checkButton(6);
  checkButton(4);
  checkButton(5);
  expect(complete).not.toHaveBeenCalled();

  const save = [...element.querySelectorAll('button')]
    .find((button) => button.textContent === messages.saveCalibration);
  expect(save?.disabled).toBe(false);
  save?.click();
  expect(complete).toHaveBeenCalledWith(calibrationForProfile('xbox-series-x', pad.id));
  unmount();
  vi.restoreAllMocks();
});

it('does not verify preset movement from a reversed direction or short spike', () => {
  const clock = animationClock();
  const element = root();
  const pad = profileGamepad();
  const profile = controllerProfiles.find(({ id }) => id === 'xbox-series-x')!;
  const complete = vi.fn();
  const unmount = mountCalibration(element, 0, () => [pad], complete, vi.fn(), profile);
  const progress = element.querySelector<HTMLElement>('[data-capture-progress]');

  clock.tick();
  pad.axes[0] = 1;
  clock.tick(3);
  expect(progress?.textContent).toContain('0 / 6');
  pad.axes[0] = 0;
  clock.tick();
  pad.axes[0] = -1;
  clock.tick();
  pad.axes[0] = 0;
  clock.tick(3);
  expect(progress?.textContent).toContain('0 / 6');
  expect(complete).not.toHaveBeenCalled();
  unmount();
  vi.restoreAllMocks();
});

it('does not verify a pedal whose preset axis is active at rest and reversed when pressed', () => {
  const clock = animationClock();
  const element = root();
  const pad = profileGamepad();
  const profile = controllerProfiles.find(({ id }) => id === 'logitech-g29')!;
  const complete = vi.fn();
  const unmount = mountCalibration(element, 0, () => [pad], complete, vi.fn(), profile);
  const progress = element.querySelector<HTMLElement>('[data-capture-progress]');

  clock.tick();
  pad.axes[0] = -1;
  clock.tick(3);
  pad.axes[0] = 0;
  clock.tick();
  clock.tick();
  pad.axes[0] = 1;
  clock.tick(3);
  pad.axes[0] = 0;
  clock.tick();
  expect(progress?.textContent).toContain('2 / 6');

  pad.axes[1] = 1;
  clock.tick(3);
  pad.axes[1] = -1;
  clock.tick();
  expect(progress?.textContent).toContain('2 / 6');
  expect(complete).not.toHaveBeenCalled();
  unmount();
  vi.restoreAllMocks();
});

it('invalidates preset verification on missing samples and device replacement', () => {
  const clock = animationClock();
  const element = root();
  const pad = profileGamepad();
  const profile = controllerProfiles.find(({ id }) => id === 'xbox-series-x')!;
  const complete = vi.fn();
  const unmount = mountCalibration(element, 0, () => [pad], complete, vi.fn(), profile);
  const progress = element.querySelector<HTMLElement>('[data-capture-progress]');

  clock.tick();
  pad.axes[0] = -1;
  clock.tick(3);
  pad.axes[0] = 0;
  clock.tick();
  expect(progress?.textContent).toContain('1 / 6');
  pad.axes.length = 0;
  clock.tick();
  expect(progress?.textContent).toContain('0 / 6');
  expect(complete).not.toHaveBeenCalled();

  pad.axes.splice(0, 0, 0, 0, 0);
  clock.tick();
  pad.axes[0] = -1;
  clock.tick(3);
  pad.axes[0] = 0;
  clock.tick();
  expect(progress?.textContent).toContain('1 / 6');
  pad.id = 'replacement';
  clock.tick();
  expect(progress?.textContent).toContain('0 / 6');
  expect(element.querySelector('[role="alert"]')?.textContent)
    .toContain(messages.controllerReplaced);
  expect(complete).not.toHaveBeenCalled();
  unmount();
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
