import type { AppState, InputSource } from '../contracts';
import { vi } from '../messages';
import type { ScreenAction, ScreenContext, ShellView } from '../runtime-types';
export { mountCalibration } from './calibration';

export interface InputSetup {
  readonly source: InputSource;
  readonly index: number | null;
  readonly devices: readonly { readonly index: number; readonly id: string }[];
  readonly ready: boolean;
}

export function mountScreen(
  root: HTMLElement,
  state: AppState,
  context: ScreenContext,
  onAction: (action: ScreenAction) => void,
  view?: ShellView,
  input?: InputSetup,
): () => void {
  const screen = document.createElement('main');
  const preview = view?.preview ?? 'closed';
  screen.className = preview === 'running' ? 'preview-shell panel' : 'screen panel';
  if (preview === 'paused') screen.classList.add('preview-paused');
  const listeners = new AbortController();

  function text(tag: 'h1' | 'p', value: string) {
    const element = document.createElement(tag);
    element.textContent = value;
    screen.append(element);
    return element;
  }

  function button(label: string, handler: () => void) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.addEventListener('click', handler, { signal: listeners.signal });
    screen.append(element);
    return element;
  }

  function inputControls() {
    if (!input) return;
    function select(
      name: string, labelText: string, options: readonly (readonly [string, string])[],
      value: string, onChange: (value: string) => void,
    ) {
      const label = document.createElement('label');
      label.textContent = labelText;
      const node = document.createElement('select');
      node.id = name;
      label.htmlFor = name;
      for (const [key, text] of options) {
        const option = document.createElement('option');
        option.value = key; option.textContent = text;
        node.append(option);
      }
      node.value = value;
      node.addEventListener('change', () => onChange(node.value), { signal: listeners.signal });
      screen.append(label, node);
    }
    select('input-source', vi.inputSource, [['keyboard', vi.keyboard], ['gamepad', vi.gamepad]],
      input.source, (source) => {
        if (source !== 'keyboard' && source !== 'gamepad') throw new RangeError('Invalid input source');
        onAction({ type: 'select-input', source, gamepadIndex: input.index });
      });
    if (input.source === 'gamepad') {
      text('p', vi.deviceHelp);
      select('input-device', vi.device,
        [['', vi.controllerDisconnected], ...input.devices.map((device) =>
          [String(device.index), device.id] as const)], input.index === null ? '' : String(input.index),
        (value) => onAction({
          type: 'select-input', source: 'gamepad', gamepadIndex: value === '' ? null : Number(value),
        }));
      button(vi.discoverDevices, () => onAction({
        type: 'select-input', source: 'gamepad', gamepadIndex: input.index,
      }));
      if (!input.ready) text('p', vi.controllerNeedsSetup);
      const setup = button(vi.calibrate, () => onAction({ type: 'open-calibration' }));
      setup.id = 'calibrate-device';
      setup.disabled = input.index === null;
    }
  }

  if (state.kind === 'error') {
    text('h1', vi.appTitle);
    text('p', vi[state.messageKey]).setAttribute('role', 'alert');
    if (state.retryable) {
      if (state.messageKey === 'webglContextLost') {
        button(vi.reload, () => window.location.reload());
      } else button(vi.retry, () => onAction({ type: 'retry' }));
    }
    button(vi.closePreview, () => onAction({ type: 'menu' }));
  } else if (state.kind !== 'menu') {
    throw new Error(`Screen not implemented in Phase 2: ${state.kind}`);
  } else if (preview !== 'closed') {
    const controls = document.createElement('div');
    controls.className = 'preview-controls';
    const badge = text('h1', vi.previewBadge);
    if (preview === 'running') badge.className = 'preview-badge';
    text('p', context.selectedVehicleId === 'sedan' ? vi.sedan : vi.cuv);
    text('p', preview === 'paused' ? vi.pausedNotice : vi.previewNotice);
    if (preview === 'paused') {
      if (view?.pauseReason === 'contact') text('p', vi.contactStop);
      else {
        const resume = button(vi.resumePreview, () => onAction({ type: 'resume' }));
        controls.append(resume);
        resume.disabled = input ? !input.ready : false;
        inputControls();
        text('p', vi.controlsHelp);
      }
    }
    screen.append(controls);
  } else {
    text('h1', vi.appTitle);
    text('p', vi.menuTitle);
    text('p', vi.menuNotice);
    const label = document.createElement('label');
    label.htmlFor = 'vehicle';
    label.textContent = vi.vehicleLabel;
    const select = document.createElement('select');
    select.id = 'vehicle';
    for (const id of ['sedan', 'cuv'] as const) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = vi[id];
      select.append(option);
    }
    select.value = context.selectedVehicleId;
    select.addEventListener('change', () => {
      if (select.value !== 'sedan' && select.value !== 'cuv') {
        throw new RangeError('Invalid vehicle selection');
      }
      onAction({ type: 'select-vehicle', vehicleId: select.value });
    }, { signal: listeners.signal });
    screen.append(label, select);
    inputControls();
    text('p', vi.controlsHelp);
    button(vi.openPreview, () => onAction({ type: 'open-preview' })).disabled = input ? !input.ready : false;
  }
  root.append(screen);
  if (preview !== 'running') screen.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  return () => {
    listeners.abort();
    screen.remove();
  };
}
