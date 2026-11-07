import { vi } from '../messages';
import type { ScreenAction, SettingsSaveV1 } from '../runtime-types';
import {
  applyGraphicsPreset,
  DEFAULT_GRAPHICS_CAPABILITIES,
  getGraphicsOptions,
  updateGraphicsSettings,
  type GraphicsOptions,
  type GraphicsPreset,
  type GraphicsSettings,
} from '../views/graphics-settings';

interface MountedGraphicsSettings {
  setDisabled(disabled: boolean): void;
  dispose(): void;
}

export interface MountedViewSettings {
  setGraphicsDisabled(disabled: boolean): void;
  dispose(): void;
}

function mountGraphicsSettings(
  root: HTMLElement,
  initial: SettingsSaveV1,
  onAction: (action: ScreenAction) => void,
  disabled: boolean,
): MountedGraphicsSettings {
  let settings = { ...initial };
  const listeners = new AbortController();
  const group = document.createElement('div');
  group.id = 'graphics-controls';
  group.className = 'settings-controls';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', vi.graphicsSettings);
  const capabilities = DEFAULT_GRAPHICS_CAPABILITIES;
  const options: GraphicsOptions = getGraphicsOptions(capabilities);

  function field(id: string, text: string, control: HTMLInputElement | HTMLSelectElement) {
    const label = document.createElement('label');
    label.htmlFor = id;
    control.id = id;
    control.name = id;
    label.append(document.createTextNode(text), control);
    group.append(label);
  }
  function select(
    id: string,
    text: string,
    choices: readonly { readonly value: string; readonly label: string; readonly disabled?: boolean }[],
    value: string,
    update: (value: string) => void,
  ) {
    const control = document.createElement('select');
    for (const choice of choices) {
      const option = document.createElement('option');
      option.value = choice.value;
      option.textContent = choice.label;
      option.disabled = choice.disabled ?? false;
      control.append(option);
    }
    control.value = value;
    control.disabled = disabled;
    control.addEventListener('change', () => update(control.value), { signal: listeners.signal });
    field(id, text, control);
    return control;
  }
  function syncControls() {
    preset.value = settings.preset;
    scale.value = String(settings.resolutionScale);
    frameRate.value = String(settings.frameRateCap);
    antialias.checked = settings.antialias;
    mirror.value = settings.mirrorQuality;
    overhead.value = settings.overheadQuality;
  }
  function saveGraphics(graphics: GraphicsSettings) {
    settings = { ...settings, ...graphics };
    syncControls();
    onAction({ type: 'update-settings', settings });
  }
  function changeGraphics(patch: Partial<Omit<GraphicsSettings, 'preset'>>) {
    saveGraphics(updateGraphicsSettings(settings, patch, capabilities));
  }

  const preset = select('graphics-preset', vi.graphicsPreset, [
    { value: 'custom', label: vi.graphicsPresetCustom, disabled: true },
    { value: 'high', label: vi.graphicsPresetHigh },
    { value: 'balanced', label: vi.graphicsPresetBalanced },
    { value: 'performance', label: vi.graphicsPresetPerformance },
  ], settings.preset, (value) => {
    if (value === 'high' || value === 'balanced' || value === 'performance') {
      saveGraphics(applyGraphicsPreset(value as Exclude<GraphicsPreset, 'custom'>, capabilities));
    } else syncControls();
  });
  const scale = select('resolution-scale', vi.renderScale,
    options.resolutionScales.map((value) => ({
      value: String(value), label: `${Math.round(value * 100)}%`,
    })),
    String(settings.resolutionScale),
    (value) => {
      const next = options.resolutionScales.find((candidate) => String(candidate) === value);
      if (next !== undefined) changeGraphics({ resolutionScale: next });
      else syncControls();
    });
  const frameRate = select('frame-rate-cap', vi.frameRateCap,
    options.frameRateCaps.map((value) => ({
      value: String(value),
      label: value === 'display' ? vi.displaySync : `${value} FPS`,
    })),
    String(settings.frameRateCap),
    (value) => {
      const next = options.frameRateCaps.find((candidate) => String(candidate) === value);
      if (next !== undefined) changeGraphics({ frameRateCap: next });
      else syncControls();
    });
  const antialias = document.createElement('input');
  antialias.type = 'checkbox';
  antialias.checked = settings.antialias;
  antialias.disabled = disabled || !options.antialiasSupported;
  antialias.addEventListener('change', () => changeGraphics({ antialias: antialias.checked }), {
    signal: listeners.signal,
  });
  field('anti-aliasing', vi.antialiasing, antialias);
  const qualityChoices = (values: GraphicsOptions['mirrorQualities']) => values.map((value) => ({
    value,
    label: value === 'high' ? vi.graphicsHigh : vi.graphicsLow,
  }));
  const mirror = select('mirror-quality', vi.mirrorQuality, qualityChoices(options.mirrorQualities),
    settings.mirrorQuality, (value) => {
      if (value === 'high' || value === 'low') changeGraphics({ mirrorQuality: value });
      else syncControls();
    });
  const overhead = select(
    'overhead-quality',
    vi.overheadQuality,
    qualityChoices(options.overheadQualities),
    settings.overheadQuality,
    (value) => {
      if (value === 'high' || value === 'low') changeGraphics({ overheadQuality: value });
      else syncControls();
    },
  );
  const benchmarkRoot = document.createElement('div');
  benchmarkRoot.id = 'graphics-benchmark-root';
  benchmarkRoot.hidden = true;
  const benchmarkToggle = document.createElement('button');
  benchmarkToggle.id = 'graphics-benchmark-toggle';
  benchmarkToggle.type = 'button';
  benchmarkToggle.textContent = vi.graphicsBenchmarkTitle;
  benchmarkToggle.disabled = disabled;
  benchmarkToggle.setAttribute('aria-controls', benchmarkRoot.id);
  benchmarkToggle.setAttribute('aria-expanded', 'false');
  benchmarkToggle.addEventListener('click', () => {
    benchmarkRoot.hidden = !benchmarkRoot.hidden;
    benchmarkToggle.setAttribute('aria-expanded', String(!benchmarkRoot.hidden));
  }, { signal: listeners.signal });
  group.append(benchmarkToggle, benchmarkRoot);
  root.append(group);
  const controls: { disabled: boolean }[] = [
    preset, scale, frameRate, antialias, mirror, overhead, benchmarkToggle,
  ];
  function setDisabled(value: boolean) {
    for (const control of controls) control.disabled = disabled || value;
  }
  syncControls();
  return {
    setDisabled,
    dispose() { listeners.abort(); group.remove(); },
  };
}

export function mountViewSettings(
  root: HTMLElement, initial: SettingsSaveV1, tab: 'view' | 'audio',
  onAction: (action: ScreenAction) => void,
  options: { readonly graphicsDisabled?: boolean } = {},
): MountedViewSettings {
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
  const graphics = tab === 'view'
    ? mountGraphicsSettings(root, initial, onAction, options.graphicsDisabled ?? false)
    : undefined;
  return {
    setGraphicsDisabled(disabled) { graphics?.setDisabled(disabled); },
    dispose() {
      listeners.abort();
      group.remove();
      graphics?.dispose();
    },
  };
}
