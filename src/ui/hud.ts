import type {
  InputAction, InputSource, LessonRuntime, SensorBand, SensorId, SensorSnapshot, VehicleTelemetry,
} from '../contracts';
import type { PreviewPhase, ScreenAction, SettingsSaveV1 } from '../runtime-types';
import { vi } from '../messages';
import { selectMostSevereWarning } from '../sensors/warnings';
import { scenarios } from '../lessons/scenarios';

export interface Hud {
  updateLesson(lesson: LessonRuntime | null): void;
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
    'overhead-frame', 'status-message', 'driving-controls',
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
  const telemetryFields = new Map<string, HTMLSpanElement>();
  for (const name of ['speed', 'gear', 'parking-brake', 'indicator']) {
    const field = document.createElement('span');
    field.dataset.telemetry = name;
    telemetryFields.set(name, field);
    telemetryNode.append(field);
  }
  const brakeMeter = document.createElement('meter');
  brakeMeter.dataset.telemetry = 'brake';
  brakeMeter.min = 0; brakeMeter.max = 1; brakeMeter.value = 0;
  brakeMeter.setAttribute('aria-label', vi.brake);
  telemetryNode.append(brakeMeter);
  const coach = nodes.get('lesson-strip')!;
  coach.setAttribute('aria-live', 'polite');
  coach.setAttribute('role', 'status');
  const frontSensorNode = nodes.get('proximity-front')!;
  const rearSensorNode = nodes.get('proximity-rear')!;
  const sensorPanels = [frontSensorNode, rearSensorNode].map((node) => {
    const reading = document.createElement('span');
    const guidance = document.createElement('small');
    guidance.className = 'sensor-guidance';
    node.append(reading, guidance);
    return { node, reading, guidance };
  });
  frontSensorNode.setAttribute('aria-live', 'off');
  rearSensorNode.setAttribute('aria-live', 'off');
  const controls = nodes.get('driving-controls')!;
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
  function setText(node: HTMLElement, value: string) {
    if (node.textContent !== value) node.textContent = value;
  }
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
    updateLesson(lesson) {
      coach.hidden = lesson === null && hud.dataset.session !== 'running';
      if (!lesson) { setText(coach, coach.hidden ? '' : `${vi.previewBadge}\n${vi.pauseHint}`); return; }
      const scenario = scenarios[lesson.stageId];
      const step = scenario.steps[lesson.stepIndex];
      const acknowledgement = step?.required.some((value) => value.kind === 'acknowledgement') &&
        !lesson.acknowledgedStepIds.includes(step.id);
      setText(coach, step ? `${vi.taskLabel} ${lesson.stepIndex + 1} / ${scenario.steps.length}\n` +
        vi[step.instructionKey] + (acknowledgement ? `\n${vi.acknowledgeHint}` : '') +
        `\n${vi.pauseHint}` : '');
    },
    update(telemetry, source) {
      latest = telemetry;
      telemetryNode.hidden = telemetry === null;
      controls.hidden = telemetry === null || !driveControls;
      if (!telemetry) {
        telemetryFields.forEach((field) => setText(field, ''));
        brakeMeter.value = 0;
        return;
      }
      setText(telemetryFields.get('speed')!, `${Math.round(Math.abs(telemetry.signedSpeedMps) * 3.6)} km/h`);
      setText(telemetryFields.get('gear')!, telemetry.gear);
      setText(telemetryFields.get('parking-brake')!, `${vi.parkingBrake}: ${telemetry.parkingBrake ? vi.on : vi.off}`);
      setText(telemetryFields.get('indicator')!, telemetry.indicator === 'off' ? '' :
        telemetry.indicator === 'left' ? vi.indicatorLeft : vi.indicatorRight);
      brakeMeter.value = telemetry.brake;
      telemetryNode.setAttribute('aria-label', `${vi.vehicleState} · ${source === 'keyboard' ? vi.keyboard : vi.gamepad}`);
      gears.forEach(({ gear, element }) => element.setAttribute('aria-pressed', String(telemetry.gear === gear)));
      parking.setAttribute('aria-pressed', String(telemetry.parkingBrake));
    },
    updateSensors(sensors) {
      for (const [index, panel, sideLabel] of [
        [0, sensorPanels[0], vi.sensorFront],
        [1, sensorPanels[1], vi.sensorRear],
      ] as const) {
        const front = index === 0;
        const { node, reading, guidance } = panel;
        if (!sensors) {
          node.hidden = true;
          reading.textContent = '';
          guidance.textContent = '';
          node.className = '';
          continue;
        }
        const warning = selectMostSevereWarning(sensors.readings.filter((reading) =>
          reading.id.startsWith(front ? 'front-' : 'rear-')));
        node.hidden = false;
        node.className = `proximity-warning sensor-${warning?.band ?? 'clear'}`;
        setText(reading, warning
          ? `${sideLabel}: ${bandNames[warning.band]} · ${sensorNames[warning.id]} · ` +
            `${warning.distanceM!.toFixed(2).replace('.', ',')} m`
          : `${sideLabel}: ${vi.sensorNoWarning}`);
        setText(guidance, vi.sensorReminder);
      }
    },
    updateSettings(value) {
      hud.dataset.overhead = String(value.overhead);
    },
    setDriveControls(visible) {
      driveControls = visible;
      controls.hidden = !visible || latest === null;
    },
    setSession(phase) {
      session.hidden = phase !== 'running';
      pause.hidden = phase !== 'running';
      hud.dataset.session = phase;
    },
    dispose() { listeners.abort(); hud.remove(); session.remove(); },
  };
}
