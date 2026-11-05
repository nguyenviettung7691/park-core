import { vi } from '../messages';
import type { ScreenAction, SettingsSaveV1 } from '../runtime-types';

export function mountViewSettings(
  root: HTMLElement, initial: SettingsSaveV1, tab: 'view' | 'audio',
  onAction: (action: ScreenAction) => void,
): () => void {
  let settings = { ...initial };
  const listeners = new AbortController();
  const group = document.createElement('div');
  group.id = 'view-controls';
  group.className = 'settings-controls';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', vi.viewSettings);
  function change(patch: Partial<SettingsSaveV1>) {
    settings = { ...settings, ...patch };
    onAction({ type: 'update-settings', settings });
  }
  function field(id: string, text: string, control: HTMLInputElement | HTMLSelectElement) {
    const label = document.createElement('label');
    label.htmlFor = id;
    control.id = id;
    control.name = id;
    label.append(document.createTextNode(text), control);
    group.append(label);
  }
  function checkbox(id: string, text: string, checked: boolean, update: (value: boolean) => void) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => update(input.checked), { signal: listeners.signal });
    field(id, text, input);
  }
  function range(id: string, text: string, value: number, min: number, max: number, step: number,
    update: (value: number) => void) {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
    input.addEventListener('change', () => update(input.valueAsNumber), { signal: listeners.signal });
    field(id, text, input);
  }
  if (tab === 'view') {
    const camera = document.createElement('select');
    for (const [value, text] of [['driver', vi.driverCamera], ['chase', vi.chaseCamera]]) {
      const option = document.createElement('option');
      option.value = value!; option.textContent = text!;
      camera.append(option);
    }
    camera.value = settings.cameraMode;
    camera.addEventListener('change', () => {
      if (camera.value !== 'driver' && camera.value !== 'chase') throw new RangeError('Invalid camera');
      change({ cameraMode: camera.value });
    }, { signal: listeners.signal });
    field('camera-mode', vi.cameraMode, camera);
    checkbox('overhead-view', vi.overheadView, settings.overhead, (overhead) => change({ overhead }));
    checkbox('trajectory-view', vi.trajectoryView, settings.trajectory, (trajectory) => change({ trajectory }));
    range('driver-fov', vi.driverFov, settings.driverFovDeg, 50, 80, 1, (driverFovDeg) => change({ driverFovDeg }));
    const recenter = document.createElement('button');
    recenter.type = 'button'; recenter.id = 'recenter-view'; recenter.textContent = vi.recenterView;
    recenter.addEventListener('click', () => onAction({ type: 'recenter-view' }), { signal: listeners.signal });
    group.append(recenter);
  } else {
    range('volume', vi.warningVolume, settings.volume, 0, 1, 0.05, (volume) => change({ volume }));
    checkbox('mute-audio', vi.muteWarnings, settings.muted, (muted) => change({ muted }));
  }
  root.append(group);
  return () => { listeners.abort(); group.remove(); };
}
