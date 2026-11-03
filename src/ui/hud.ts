import type {
  InputAction, InputSource, SensorBand, SensorId, SensorSnapshot, VehicleTelemetry,
} from '../contracts';
import type { PreviewPhase, ScreenAction, SettingsSaveV1 } from '../runtime-types';
import { vi } from '../messages';
import { selectMostSevereWarning } from '../sensors/warnings';

export interface Hud {
  update(telemetry: VehicleTelemetry | null, source: InputSource): void;
  updateSensors(sensors: SensorSnapshot | null): void;
  updateSettings(settings: SettingsSaveV1): void;
  setDriveControls(visible: boolean): void;
  setSession(phase: PreviewPhase): void;
  dispose(): void;
}

export function mountHud(root: HTMLElement, onAction: (action: ScreenAction) => void): Hud {
  const hud = document.createElement('div');
  hud.id = 'hud';
  const nodes = new Map<string, HTMLDivElement>();
  const listeners = new AbortController();
  for (const id of [
    'lesson-strip', 'proximity-front', 'proximity-rear', 'telemetry',
    'view-controls', 'overhead-frame', 'status-message', 'driving-controls',
  ]) {
    const element = document.createElement('div');
    element.id = id;
    if (id === 'status-message') {
      element.setAttribute('role', 'status');
      element.setAttribute('aria-live', 'polite');
    } else element.hidden = true;
    nodes.set(id, element);
    hud.append(element);
  }
  const telemetryNode = nodes.get('telemetry')!;
  const frontSensorNode = nodes.get('proximity-front')!;
  const rearSensorNode = nodes.get('proximity-rear')!;
  frontSensorNode.setAttribute('aria-live', 'off');
  rearSensorNode.setAttribute('aria-live', 'off');
  const controls = nodes.get('driving-controls')!;
  const viewControls = nodes.get('view-controls')!;
  viewControls.className = 'view-controls';
  viewControls.setAttribute('role', 'group');
  viewControls.setAttribute('aria-label', vi.viewSettings);
  let settings: SettingsSaveV1 = {
    version: 1, volume: 0.5, muted: false, driverFovDeg: 60,
    cameraMode: 'driver', overhead: false, trajectory: false,
    inputSource: 'keyboard', resolutionScale: 1,
  };
  function changeSettings(patch: Partial<SettingsSaveV1>) {
    settings = { ...settings, ...patch };
    onAction({ type: 'update-settings', settings });
  }
  function settingLabel(id: string, text: string) {
    const label = document.createElement('label');
    label.htmlFor = id;
    label.append(document.createTextNode(text));
    return label;
  }
  const cameraLabel = settingLabel('camera-mode', vi.cameraMode);
  const cameraMode = document.createElement('select');
  cameraMode.id = 'camera-mode';
  for (const [value, label] of [['driver', vi.driverCamera], ['chase', vi.chaseCamera]] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    cameraMode.append(option);
  }
  cameraMode.addEventListener('change', () => {
    if (cameraMode.value !== 'driver' && cameraMode.value !== 'chase') return;
    changeSettings({ cameraMode: cameraMode.value });
  }, { signal: listeners.signal });
  cameraLabel.append(cameraMode);
  const overheadLabel = settingLabel('overhead-view', vi.overheadView);
  const overhead = document.createElement('input');
  overhead.type = 'checkbox';
  overhead.id = 'overhead-view';
  overhead.addEventListener('change', () => changeSettings({ overhead: overhead.checked }),
    { signal: listeners.signal });
  overheadLabel.append(overhead);
  const trajectoryLabel = settingLabel('trajectory-view', vi.trajectoryView);
  const trajectory = document.createElement('input');
  trajectory.type = 'checkbox';
  trajectory.id = 'trajectory-view';
  trajectory.addEventListener('change', () => changeSettings({ trajectory: trajectory.checked }),
    { signal: listeners.signal });
  trajectoryLabel.append(trajectory);
  const fovLabel = settingLabel('driver-fov', vi.driverFov);
  const fov = document.createElement('input');
  fov.type = 'range';
  fov.id = 'driver-fov';
  fov.min = '50';
  fov.max = '80';
  fov.step = '1';
  fov.addEventListener('change', () => changeSettings({ driverFovDeg: fov.valueAsNumber }),
    { signal: listeners.signal });
  fovLabel.append(fov);
  const volumeLabel = settingLabel('volume', vi.warningVolume);
  const volume = document.createElement('input');
  volume.type = 'range';
  volume.id = 'volume';
  volume.min = '0';
  volume.max = '1';
  volume.step = '0.05';
  volume.addEventListener('change', () => changeSettings({ volume: volume.valueAsNumber }),
    { signal: listeners.signal });
  volumeLabel.append(volume);
  const muteLabel = settingLabel('mute-audio', vi.muteWarnings);
  const mute = document.createElement('input');
  mute.type = 'checkbox';
  mute.id = 'mute-audio';
  mute.addEventListener('change', () => changeSettings({ muted: mute.checked }),
    { signal: listeners.signal });
  muteLabel.append(mute);
  const recenter = document.createElement('button');
  recenter.type = 'button';
  recenter.id = 'recenter-view';
  recenter.textContent = vi.recenterView;
  recenter.addEventListener('click', () => onAction({ type: 'recenter-view' }),
    { signal: listeners.signal });
  viewControls.append(cameraLabel, overheadLabel, trajectoryLabel, fovLabel, recenter, volumeLabel, muteLabel);
  const session = document.createElement('div');
  session.id = 'session-controls';
  session.className = 'preview-controls';
  session.hidden = true;
  function sessionButton(label: string, action: ScreenAction) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.addEventListener('click', () => onAction(action), { signal: listeners.signal });
    session.append(element);
    return element;
  }
  const pause = sessionButton(vi.pause, { type: 'pause' });
  sessionButton(vi.resetPreview, { type: 'reset-preview' });
  sessionButton(vi.closePreview, { type: 'menu' });
  let latest: VehicleTelemetry | null = null;
  function button(label: string, action: () => InputAction) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.addEventListener('click', () => onAction({
      type: 'input-action', action: action(),
    }), { signal: listeners.signal });
    controls.append(element);
    return element;
  }
  const gears = (['P', 'R', 'N', 'D'] as const).map((gear) => ({
    gear, element: button(gear, () => ({ type: 'request-gear', gear })),
  }));
  const parking = button(vi.parkingBrake, () => ({ type: 'toggle-parking-brake' }));
  for (const [indicator, label] of [['left', vi.indicatorLeft], ['right', vi.indicatorRight]] as const) {
    button(label, () => ({
      type: 'set-indicator', indicator: latest?.indicator === indicator ? 'off' : indicator,
    }));
  }
  root.append(hud, session);
  let driveControls = false;
  const sensorNames: Readonly<Record<SensorId, string>> = {
    'front-left-outer': vi.sensorFrontLeftOuter,
    'front-left': vi.sensorFrontLeft,
    'front-center': vi.sensorFrontCenter,
    'front-right': vi.sensorFrontRight,
    'front-right-outer': vi.sensorFrontRightOuter,
    'rear-left-outer': vi.sensorRearLeftOuter,
    'rear-left': vi.sensorRearLeft,
    'rear-center': vi.sensorRearCenter,
    'rear-right': vi.sensorRearRight,
    'rear-right-outer': vi.sensorRearRightOuter,
  };
  const bandNames: Readonly<Record<SensorBand, string>> = {
    clear: vi.sensorBandClear,
    green: vi.sensorBandGreen,
    yellow: vi.sensorBandYellow,
    red: vi.sensorBandRed,
    stop: vi.sensorBandStop,
  };
  return {
    update(telemetry, source) {
      latest = telemetry;
      telemetryNode.hidden = telemetry === null;
      controls.hidden = telemetry === null || !driveControls;
      if (!telemetry) { telemetryNode.textContent = ''; return; }
      telemetryNode.textContent = `${Math.round(Math.abs(telemetry.signedSpeedMps) * 3.6)} km/h · ${telemetry.gear}` +
        ` · ${vi.parkingBrake}: ${telemetry.parkingBrake ? vi.on : vi.off}` +
        ` · ${vi.brake}: ${Math.round(telemetry.brake * 100)}%` +
        ` · ${telemetry.indicator === 'off' ? vi.off :
          telemetry.indicator === 'left' ? vi.indicatorLeft : vi.indicatorRight}` +
        ` · ${source === 'keyboard' ? vi.keyboard : vi.gamepad}`;
      gears.forEach(({ gear, element }) => element.setAttribute('aria-pressed', String(telemetry.gear === gear)));
      parking.setAttribute('aria-pressed', String(telemetry.parkingBrake));
    },
    updateSensors(sensors) {
      for (const [front, node, sideLabel] of [
        [true, frontSensorNode, vi.sensorFront],
        [false, rearSensorNode, vi.sensorRear],
      ] as const) {
        if (!sensors) {
          node.hidden = true;
          node.textContent = '';
          node.className = '';
          continue;
        }
        const warning = selectMostSevereWarning(sensors.readings.filter((reading) =>
          reading.id.startsWith(front ? 'front-' : 'rear-')));
        node.hidden = false;
        node.className = `proximity-warning sensor-${warning?.band ?? 'clear'}`;
        node.textContent = warning
          ? `${sideLabel}: ${bandNames[warning.band]} · ${sensorNames[warning.id]} · ` +
            `${warning.distanceM!.toFixed(2).replace('.', ',')} m`
          : `${sideLabel}: ${vi.sensorNoWarning}`;
      }
    },
    updateSettings(value) {
      settings = { ...value };
      cameraMode.value = settings.cameraMode;
      overhead.checked = settings.overhead;
      trajectory.checked = settings.trajectory;
      fov.value = String(settings.driverFovDeg);
      volume.value = String(settings.volume);
      mute.checked = settings.muted;
    },
    setDriveControls(visible) {
      driveControls = visible;
      controls.hidden = !visible || latest === null;
    },
    setSession(phase) {
      session.hidden = phase === 'closed';
      pause.hidden = phase !== 'running';
      viewControls.hidden = phase === 'closed';
    },
    dispose() { listeners.abort(); hud.remove(); session.remove(); },
  };
}
