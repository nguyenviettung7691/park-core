import type { InputAction, InputSource, VehicleTelemetry } from '../contracts';
import type { PreviewPhase, ScreenAction } from '../runtime-types';
import { vi } from '../messages';

export interface Hud {
  update(telemetry: VehicleTelemetry | null, source: InputSource): void;
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
    setDriveControls(visible) {
      driveControls = visible;
      controls.hidden = !visible || latest === null;
    },
    setSession(phase) {
      session.hidden = phase === 'closed';
      pause.hidden = phase !== 'running';
    },
    dispose() { listeners.abort(); hud.remove(); session.remove(); },
  };
}
