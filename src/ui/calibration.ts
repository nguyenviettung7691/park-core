import type { ControllerCalibration, MessageKey, PedalBinding } from '../contracts';
import { validateCalibration } from '../input/calibration';
import { vi } from '../messages';

export function mountCalibration(
  root: HTMLElement, selectedIndex: number,
  getGamepads: () => readonly (Gamepad | null)[],
  onComplete: (value: ControllerCalibration) => void, onCancel: () => void,
): () => void {
  const previousFocus = document.activeElement;
  const listeners = new AbortController();
  const screen = document.createElement('main');
  screen.className = 'screen panel calibration';
  screen.setAttribute('role', 'dialog');
  screen.setAttribute('aria-modal', 'true');
  screen.setAttribute('aria-label', vi.calibrationTitle);
  const title = document.createElement('h1');
  title.textContent = vi.calibrationTitle;
  const help = document.createElement('p');
  help.textContent = vi.calibrationHelp;
  const error = document.createElement('p');
  error.setAttribute('role', 'alert');
  const monitor = document.createElement('pre');
  monitor.setAttribute('aria-label', vi.rawValues);
  screen.append(title, help, error, monitor);
  root.append(screen);
  let disposed = false;
  let frame: number | null = null;
  let deviceId: string | null = null;
  let pad: Gamepad | null = null;
  let issue: MessageKey | null = null;
  let steeringAxis = 0;
  let left: number | null = null;
  let center: number | null = null;
  let right: number | null = null;
  let reverseButton = 4;
  let driveButton = 5;
  let reverseVerified = false;
  let driveVerified = false;
  interface PedalDraft { kind: PedalBinding['kind']; index: number; released: number | null; pressed: number | null }
  const throttle: PedalDraft = { kind: 'button', index: 7, released: null, pressed: null };
  const brake: PedalDraft = { kind: 'button', index: 6, released: null, pressed: null };
  const captures: HTMLButtonElement[] = [];
  function button(label: string, handler: () => void) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.addEventListener('click', handler, { signal: listeners.signal });
    screen.append(element);
    return element;
  }
  function numberField(label: string, value: number, change: (index: number) => void) {
    const element = document.createElement('input');
    element.type = 'number';
    element.min = '0'; element.max = '63'; element.step = '1';
    element.value = String(value);
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    wrapper.append(element);
    screen.append(wrapper);
    element.addEventListener('change', () => {
      change(element.valueAsNumber);
      refresh();
    }, { signal: listeners.signal });
    return element;
  }
  function invalidate() {
    left = center = right = null;
    throttle.released = throttle.pressed = brake.released = brake.pressed = null;
    reverseVerified = driveVerified = false;
    captures.forEach((element) => element.setAttribute('aria-pressed', 'false'));
  }
  function sample() {
    let next: Gamepad | null;
    try { next = getGamepads()[selectedIndex] ?? null; }
    catch {
      pad = null; issue = 'controllerUnavailable'; invalidate(); return;
    }
    if (!next?.connected) {
      pad = null; issue = 'controllerDisconnected'; invalidate(); return;
    }
    if (deviceId !== null && next.id !== deviceId) {
      invalidate();
      issue = 'controllerReplaced';
      deviceId = next.id;
      pad = next;
      return;
    }
    deviceId = next.id;
    if (!next.axes.every((value) => Number.isFinite(value) && Math.abs(value) <= 1) ||
        !next.buttons.every((value) => Number.isFinite(value.value) && value.value >= 0 && value.value <= 1)) {
      pad = null; issue = 'controllerInvalid'; invalidate(); return;
    }
    pad = next;
    issue = null;
  }
  function capture(label: string, read: (value: Gamepad) => number | null, store: (value: number) => void) {
    const element = button(label, () => {
      sample();
      const value = pad && !issue ? read(pad) : null;
      if (value === null || !Number.isFinite(value)) {
        issue ??= 'controllerControlsMissing';
      } else {
        store(value);
        element.setAttribute('aria-pressed', 'true');
      }
      refresh();
    });
    element.setAttribute('aria-pressed', 'false');
    captures.push(element);
  }
  numberField(vi.steeringAxis, 0, (index) => {
    steeringAxis = index;
    left = center = right = null;
    captures.slice(0, 3).forEach((element) => element.setAttribute('aria-pressed', 'false'));
  });
  capture(vi.steeringLeft, (value) => value.axes[steeringAxis] ?? null, (value) => { left = value; });
  capture(vi.steeringCenter, (value) => value.axes[steeringAxis] ?? null, (value) => { center = value; });
  capture(vi.steeringRight, (value) => value.axes[steeringAxis] ?? null, (value) => { right = value; });
  function pedalFields(label: string, draft: PedalDraft) {
    const kind = document.createElement('select');
    for (const [value, text] of [['axis', vi.axis], ['button', vi.button]]) {
      const option = document.createElement('option');
      option.value = value!; option.textContent = text!;
      kind.append(option);
    }
    kind.value = draft.kind;
    const wrapper = document.createElement('label');
    wrapper.textContent = `${label} — ${vi.bindingKind}`;
    wrapper.append(kind);
    screen.append(wrapper);
    const captureStart = captures.length;
    function clearPedal() {
      draft.released = draft.pressed = null;
      captures.slice(captureStart, captureStart + 2)
        .forEach((element) => element.setAttribute('aria-pressed', 'false'));
    }
    kind.addEventListener('change', () => {
      if (kind.value !== 'axis' && kind.value !== 'button') throw new RangeError('Invalid pedal kind');
      draft.kind = kind.value;
      clearPedal(); refresh();
    }, { signal: listeners.signal });
    numberField(`${label} — ${vi.bindingIndex}`, draft.index, (index) => {
      draft.index = index; clearPedal();
    });
    function raw(value: Gamepad) {
      return draft.kind === 'axis' ? value.axes[draft.index] ?? null :
        value.buttons[draft.index]?.value ?? null;
    }
    capture(`${label} — ${vi.released}`, raw, (value) => { draft.released = value; });
    capture(`${label} — ${vi.pressed}`, raw, (value) => { draft.pressed = value; });
  }
  pedalFields(vi.throttle, throttle);
  pedalFields(vi.brake, brake);
  numberField(vi.reverseButton, reverseButton, (index) => {
    reverseButton = index; reverseVerified = false;
    captures[7]?.setAttribute('aria-pressed', 'false');
  });
  capture(vi.verifyReverse, (value) => (value.buttons[reverseButton]?.value ?? 0) > 0.5 ? 1 : null,
    () => { reverseVerified = true; });
  numberField(vi.driveButton, driveButton, (index) => {
    driveButton = index; driveVerified = false;
    captures[8]?.setAttribute('aria-pressed', 'false');
  });
  capture(vi.verifyDrive, (value) => (value.buttons[driveButton]?.value ?? 0) > 0.5 ? 1 : null,
    () => { driveVerified = true; });
  function captured() {
    return reverseVerified && driveVerified &&
      [left, center, right, throttle.released, throttle.pressed, brake.released, brake.pressed]
        .every((value) => value !== null);
  }
  function calibration(): ControllerCalibration | null {
    if (issue || !pad || !captured()) return null;
    return validateCalibration({
      version: 1, deviceId, steeringAxis, steeringLeft: left, steeringCenter: center,
      steeringRight: right, throttle: { ...throttle }, brake: { ...brake }, reverseButton, driveButton,
    });
  }
  const save = button(vi.saveCalibration, () => {
    sample();
    const value = calibration();
    if (!value) { issue ??= 'invalidCalibration'; refresh(); return; }
    onComplete(value);
  });
  button(vi.cancel, onCancel);
  function refresh() {
    const value = calibration();
    const message = issue ?? (captured() && value === null ? 'invalidCalibration' : null);
    error.textContent = message ? vi[message] : '';
    save.disabled = value === null;
    captures.forEach((element) => { element.disabled = pad === null || issue !== null; });
  }
  function tick() {
    if (disposed) return;
    sample();
    monitor.textContent = pad ? `${pad.id}\n` +
      pad.axes.map((value, index) => `${vi.axis} ${index}: ${value.toFixed(3)}`).join(' · ') + '\n' +
      pad.buttons.map((value, index) => `${vi.button} ${index}: ${value.value.toFixed(3)}`).join(' · ') : '';
    refresh();
    frame = window.requestAnimationFrame(tick);
  }
  function onDisconnected(event: GamepadEvent) {
    if (event.gamepad.index !== selectedIndex) return;
    pad = null; issue = 'controllerDisconnected'; invalidate(); refresh();
  }
  window.addEventListener('gamepaddisconnected', onDisconnected, { signal: listeners.signal });
  screen.addEventListener('keydown', (event) => {
    if (event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
  }, { signal: listeners.signal });
  sample();
  refresh();
  frame = window.requestAnimationFrame(tick);
  screen.querySelector('input')?.focus();
  return () => {
    if (disposed) return;
    disposed = true;
    if (frame !== null) window.cancelAnimationFrame(frame);
    listeners.abort();
    screen.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  };
}
