import type { ControllerCalibration, MessageKey, PedalBinding } from '../contracts';
import { normalizePedal, normalizeSteering, validateCalibration } from '../input/calibration';
import { calibrationForProfile, type ControllerProfile } from '../input/profiles';
import { createControllerIllustration, type CalibrationPart } from './controller-illustrations';
import { vi } from '../messages';

const PROFILE_STEPS = [
  { id: 'steering-left', message: 'profileSteeringLeft', kind: 'axis', part: 'steering' },
  { id: 'steering-right', message: 'profileSteeringRight', kind: 'axis', part: 'steering' },
  { id: 'throttle', message: 'profileThrottle', kind: 'axis', part: 'throttle' },
  { id: 'brake', message: 'profileBrake', kind: 'axis', part: 'brake' },
  { id: 'reverse', message: 'profileReverse', kind: 'button', part: 'reverse' },
  { id: 'drive', message: 'profileDrive', kind: 'button', part: 'drive' },
] as const satisfies readonly { readonly id: string; readonly message: MessageKey;
  readonly kind: 'axis' | 'button'; readonly part: CalibrationPart }[];

type ManualSamples = {
  left: number | null;
  center: number | null;
  right: number | null;
  throttleReleased: number | null;
  throttlePressed: number | null;
  brakeReleased: number | null;
  brakePressed: number | null;
  reverse: number | null;
  drive: number | null;
};

const MANUAL_STEPS = [
  { id: 'steering-left', sample: 'left', message: 'manualSteeringLeft', part: 'steering', binding: 'steering' },
  { id: 'steering-center', sample: 'center', message: 'manualSteeringCenter', part: 'steering', binding: 'steering' },
  { id: 'steering-right', sample: 'right', message: 'manualSteeringRight', part: 'steering', binding: 'steering' },
  { id: 'throttle-released', sample: 'throttleReleased', message: 'manualThrottleReleased', part: 'throttle', binding: 'throttle' },
  { id: 'throttle-pressed', sample: 'throttlePressed', message: 'manualThrottlePressed', part: 'throttle', binding: 'throttle' },
  { id: 'brake-released', sample: 'brakeReleased', message: 'manualBrakeReleased', part: 'brake', binding: 'brake' },
  { id: 'brake-pressed', sample: 'brakePressed', message: 'manualBrakePressed', part: 'brake', binding: 'brake' },
  { id: 'reverse', sample: 'reverse', message: 'manualReverse', part: 'reverse', binding: 'reverse' },
  { id: 'drive', sample: 'drive', message: 'manualDrive', part: 'drive', binding: 'drive' },
] as const satisfies readonly { readonly id: string; readonly sample: keyof ManualSamples;
  readonly message: MessageKey; readonly part: CalibrationPart;
  readonly binding: 'steering' | 'throttle' | 'brake' | 'reverse' | 'drive' }[];

type LookButtonKey = 'lookLeftButton' | 'lookRightButton' | 'lookBackButton' | 'recenterButton';

/** Optional steps after the required controls; the stick step is offered on the manual path only. */
const LOOK_BUTTON_STEPS = [
  { id: 'look-left', key: 'lookLeftButton', message: 'lookLeftStep' },
  { id: 'look-right', key: 'lookRightButton', message: 'lookRightStep' },
  { id: 'look-back', key: 'lookBackButton', message: 'lookBackStep' },
  { id: 'recenter', key: 'recenterButton', message: 'recenterStep' },
] as const satisfies readonly { readonly id: string; readonly key: LookButtonKey;
  readonly message: MessageKey }[];
const LOOK_STICK_STEP = { id: 'look-stick' } as const;
type LookStep = typeof LOOK_BUTTON_STEPS[number] | typeof LOOK_STICK_STEP;

const LOOK_BUTTON_PRESSED = 0.5;
const LOOK_AXIS_MOVED = 0.6;
const LOOK_AXIS_NEUTRAL = 0.2;

function emptyManualSamples(): ManualSamples {
  return {
    left: null, center: null, right: null,
    throttleReleased: null, throttlePressed: null,
    brakeReleased: null, brakePressed: null, reverse: null, drive: null,
  };
}

export function mountCalibration(
  root: HTMLElement, selectedIndex: number,
  getGamepads: () => readonly (Gamepad | null)[],
  onComplete: (value: ControllerCalibration) => void, onCancel: () => void,
  profile?: ControllerProfile,
): () => void {
  const previousFocus = document.activeElement;
  const listeners = new AbortController();
  const screen = document.createElement('main');
  screen.className = 'screen panel calibration';
  screen.setAttribute('role', 'dialog');
  screen.setAttribute('aria-modal', 'true');
  screen.setAttribute('aria-label', vi.calibrationTitle);
  let manualMode = !profile;
  let manualKind: 'wheel' | 'gamepad' = profile?.kind ?? 'gamepad';
  const title = document.createElement('h1');
  title.textContent = vi.calibrationTitle;
  const help = document.createElement('p');
  help.textContent = manualMode ? vi.calibrationHelp : vi.profileVerificationHelp;
  const error = document.createElement('p');
  error.setAttribute('role', 'alert');
  const monitor = document.createElement('pre');
  monitor.setAttribute('aria-label', vi.rawValues);
  const diagnostics = document.createElement('details');
  const diagnosticLabel = document.createElement('summary');
  diagnosticLabel.textContent = vi.rawValues;
  diagnostics.append(diagnosticLabel, monitor);
  const device = document.createElement('p');
  device.dataset.calibrationDevice = '';
  const progress = document.createElement('p');
  progress.dataset.captureProgress = '';
  progress.setAttribute('role', 'status');
  const illustration = document.createElement('figure');
  illustration.dataset.controllerIllustration = '';
  const instruction = document.createElement('p');
  instruction.dataset.calibrationStep = '';
  instruction.tabIndex = -1;
  instruction.setAttribute('aria-live', 'polite');
  const manualControls = document.createElement('div');
  manualControls.dataset.manualControls = '';
  const kindLabel = document.createElement('label');
  kindLabel.textContent = vi.calibrationIllustrationType;
  const kindSelect = document.createElement('select');
  kindSelect.dataset.illustrationKind = '';
  for (const [value, text] of [['gamepad', vi.gamepadIllustration], ['wheel', vi.wheelIllustration]]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    kindSelect.append(option);
  }
  kindSelect.value = manualKind;
  kindLabel.append(kindSelect);
  screen.append(title, help, device, error, progress);
  if (!profile) screen.append(kindLabel);
  screen.append(illustration, instruction, manualControls);
  root.append(screen);
  let disposed = false;
  let frame: number | null = null;
  let deviceId: string | null = null;
  let pad: Gamepad | null = null;
  let issue: MessageKey | null = null;
  const template = profile?.calibration;
  let steeringAxis = template?.steeringAxis ?? 0;
  let reverseButton = template?.reverseButton ?? 4;
  let driveButton = template?.driveButton ?? 5;
  let profileIndex = 0;
  let manualIndex = 0;
  let manualSamples = emptyManualSamples();
  let renderedStep: string | null = null;
  let renderedIllustration = '';
  let movementFrames = 0;
  let awaitingRelease = false;
  let profileReady = false;
  let profileBlocked = false;
  let lookIndex = 0;
  let lookButtons: Partial<Record<LookButtonKey, number>> = {};
  let lookStickX: number | null = null;
  let lookStick: { xAxis: number; yAxis: number } | null = null;
  /** Look capture waits for every button (or stick) to be at rest before taking a new press. */
  let lookArmed = false;
  let lookAxisBaseline: number[] | null = null;
  let lookRejection: MessageKey | null = null;
  interface PedalDraft { kind: PedalBinding['kind']; index: number; released: number | null; pressed: number | null }
  const throttle: PedalDraft = {
    kind: template?.throttle.kind ?? 'button', index: template?.throttle.index ?? 7,
    released: null, pressed: null,
  };
  const brake: PedalDraft = {
    kind: template?.brake.kind ?? 'button', index: template?.brake.index ?? 6,
    released: null, pressed: null,
  };
  function group(label: string, parent: HTMLElement = manualControls) {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = label;
    fieldset.append(legend);
    parent.append(fieldset);
    return fieldset;
  }
  function button(label: string, handler: () => void, parent: HTMLElement = screen) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.addEventListener('click', handler, { signal: listeners.signal });
    parent.append(element);
    return element;
  }
  function numberField(label: string, value: number, change: (index: number) => void, parent: HTMLElement) {
    const element = document.createElement('input');
    element.type = 'number';
    element.min = '0'; element.max = '63'; element.step = '1';
    element.value = String(value);
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    wrapper.append(element);
    parent.append(wrapper);
    element.addEventListener('change', () => {
      change(element.valueAsNumber);
      refresh();
    }, { signal: listeners.signal });
    return element;
  }
  function resetLook() {
    lookIndex = 0;
    lookButtons = {};
    lookStickX = null;
    lookStick = null;
    lookArmed = false;
    lookAxisBaseline = null;
    lookRejection = null;
  }
  function invalidate() {
    resetLook();
    manualSamples = emptyManualSamples();
    throttle.released = throttle.pressed = brake.released = brake.pressed = null;
    profileIndex = 0;
    manualIndex = 0;
    renderedStep = null;
    movementFrames = 0;
    awaitingRelease = false;
    profileReady = false;
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
      if (profile && !manualMode) profileBlocked = true;
      return;
    }
    if (profileBlocked) {
      pad = next; issue = 'controllerReplaced'; return;
    }
    deviceId = next.id;
    const axes = Array.from({ length: next.axes.length }, (_, index) => next.axes[index]);
    const buttons = Array.from({ length: next.buttons.length }, (_, index) => next.buttons[index]);
    if (!axes.every((value) => value !== undefined && Number.isFinite(value) && Math.abs(value) <= 1) ||
        !buttons.every((value) => value !== undefined && Number.isFinite(value.value) &&
          value.value >= 0 && value.value <= 1)) {
      pad = null; issue = 'controllerInvalid'; invalidate(); return;
    }
    pad = next;
    issue = null;
  }
  function clearManual() {
    resetLook();
    manualSamples = emptyManualSamples();
    throttle.released = throttle.pressed = brake.released = brake.pressed = null;
    manualIndex = 0;
    renderedStep = null;
  }
  function pedalFields(label: string, draft: PedalDraft) {
    const fieldset = group(label);
    const kind = document.createElement('select');
    for (const [value, text] of [['axis', vi.axis], ['button', vi.button]]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      kind.append(option);
    }
    kind.value = draft.kind;
    const wrapper = document.createElement('label');
    wrapper.textContent = `${label} — ${vi.bindingKind}`;
    wrapper.append(kind);
    fieldset.append(wrapper);
    kind.addEventListener('change', () => {
      if (kind.value !== 'axis' && kind.value !== 'button') {
        throw new RangeError('Invalid pedal kind');
      }
      draft.kind = kind.value;
      clearManual();
      refresh();
    }, { signal: listeners.signal });
    numberField(`${label} — ${vi.bindingIndex}`, draft.index, (index) => {
      draft.index = index;
      clearManual();
    }, fieldset);
  }
  function renderManualControls() {
    if (!manualMode) return;
    const step = MANUAL_STEPS[manualIndex];
    const stepId = step?.id ?? 'complete';
    if (renderedStep === stepId) return;
    renderedStep = stepId;
    manualControls.replaceChildren();
    if (!step) return;
    switch (step.binding) {
      case 'steering': {
        const fieldset = group(vi.steeringGroup);
        numberField(vi.steeringAxis, steeringAxis, (index) => {
          steeringAxis = index;
          clearManual();
        }, fieldset);
        break;
      }
      case 'throttle':
        pedalFields(vi.throttle, throttle);
        break;
      case 'brake':
        pedalFields(vi.brake, brake);
        break;
      case 'reverse': {
        const fieldset = group(vi.gearsGroup);
        numberField(vi.reverseButton, reverseButton, (index) => {
          reverseButton = index;
          clearManual();
        }, fieldset);
        break;
      }
      case 'drive': {
        const fieldset = group(vi.gearsGroup);
        numberField(vi.driveButton, driveButton, (index) => {
          driveButton = index;
          clearManual();
        }, fieldset);
        break;
      }
    }
  }
  function readManualValue(step: typeof MANUAL_STEPS[number], value: Gamepad): number | null {
    if (step.binding === 'steering') return value.axes[steeringAxis] ?? null;
    if (step.binding === 'throttle' || step.binding === 'brake') {
      const binding = step.binding === 'throttle' ? throttle : brake;
      return binding.kind === 'axis' ? value.axes[binding.index] ?? null
        : value.buttons[binding.index]?.value ?? null;
    }
    const buttonIndex = step.binding === 'reverse' ? reverseButton : driveButton;
    return (value.buttons[buttonIndex]?.value ?? 0) > 0.5 ? 1 : null;
  }
  function captureManualStep() {
    if (!manualMode) return;
    if (manualIndex === MANUAL_STEPS.length) {
      clearManual();
      issue = null;
      refresh();
      manualCapture.focus();
      return;
    }
    sample();
    const step = MANUAL_STEPS[manualIndex];
    const value = step && pad && !issue ? readManualValue(step, pad) : null;
    if (value === null || !Number.isFinite(value)) {
      issue ??= 'controllerControlsMissing';
      refresh();
      return;
    }
    manualSamples[step.sample] = value;
    manualIndex++;
    renderedStep = null;
    refresh();
    if (manualIndex === MANUAL_STEPS.length) {
      if (currentLookStep()) skip.focus();
      else if (save.disabled) manualCapture.focus();
      else save.focus();
    }
  }
  function selectManual() {
    if (!profile) return;
    manualMode = true;
    manualKind = profile.kind;
    profileBlocked = false;
    clearManual();
    issue = null;
    refresh();
    manualCapture.focus();
  }
  if (!profile) {
    kindSelect.addEventListener('change', () => {
      if (kindSelect.value !== 'wheel' && kindSelect.value !== 'gamepad') {
        throw new RangeError('Invalid illustration kind');
      }
      manualKind = kindSelect.value;
      refresh();
    }, { signal: listeners.signal });
  }
  const manualCapture = button(vi.captureCalibrationStep, captureManualStep);
  manualCapture.dataset.calibrationCapture = '';
  manualCapture.className = 'primary-action';
  const skip = button(vi.skipLookStep, skipLookStep);
  skip.dataset.lookSkip = '';
  skip.className = 'quiet-action';
  if (profile) {
    const fallback = button(vi.useManualCalibration, selectManual);
    fallback.dataset.manualFallback = '';
    fallback.className = 'quiet-action';
  }
  function captured() {
    return manualMode ? manualIndex === MANUAL_STEPS.length
      : profileIndex === PROFILE_STEPS.length;
  }
  function readProfileValue(): number | null {
    if (!profile || !pad || !deviceId) return null;
    const calibration = calibrationForProfile(profile.id, deviceId);
    const step = PROFILE_STEPS[profileIndex];
    if (!step) return null;
    if (step.kind === 'button') {
      const index = step.id === 'reverse' ? calibration.reverseButton : calibration.driveButton;
      const input = pad.buttons[index];
      return input ? Number(input.pressed) : null;
    }
    if (step.id === 'steering-left' || step.id === 'steering-right') {
      const raw = pad.axes[calibration.steeringAxis];
      return raw === undefined ? null : normalizeSteering(raw, calibration);
    }
    const binding = step.id === 'throttle' ? calibration.throttle : calibration.brake;
    const raw = binding.kind === 'axis' ? pad.axes[binding.index] :
      pad.buttons[binding.index]?.value;
    return raw === undefined ? null : normalizePedal(raw, binding);
  }
  function updateProfileCheck() {
    if (manualMode || !profile || !pad || issue || profileBlocked ||
        profileIndex >= PROFILE_STEPS.length) return;
    const step = PROFILE_STEPS[profileIndex];
    let value: number | null;
    try { value = readProfileValue(); }
    catch (error) {
      if (!(error instanceof RangeError)) throw error;
      issue = 'controllerInvalid';
      invalidate();
      return;
    }
    if (value === null) {
      issue = 'controllerControlsMissing';
      invalidate();
      return;
    }
    if (!profileReady) {
      if (Math.abs(value) <= 0.10) profileReady = true;
      return;
    }
    if (awaitingRelease) {
      if (Math.abs(value) <= 0.10) {
        profileIndex++;
        awaitingRelease = false;
        profileReady = false;
      }
      return;
    }
    const moved = step.id === 'steering-left' ? value >= 0.35
      : step.id === 'steering-right' ? value <= -0.35
        : step.kind === 'button' ? value >= 0.5 : value >= 0.35;
    movementFrames = moved ? movementFrames + 1 : 0;
    if (movementFrames >= 3) {
      awaitingRelease = true;
      movementFrames = 0;
    }
  }
  function baseCalibration(): ControllerCalibration | null {
    if (issue || !pad || !deviceId) return null;
    if (!manualMode && profile) {
      if (profileIndex !== PROFILE_STEPS.length || awaitingRelease) return null;
      return validateCalibration(calibrationForProfile(profile.id, deviceId));
    }
    if (!captured()) return null;
    return validateCalibration({
      version: 2, deviceId, steeringAxis,
      steeringLeft: manualSamples.left, steeringCenter: manualSamples.center,
      steeringRight: manualSamples.right,
      throttle: { ...throttle, released: manualSamples.throttleReleased,
        pressed: manualSamples.throttlePressed },
      brake: { ...brake, released: manualSamples.brakeReleased, pressed: manualSamples.brakePressed },
      reverseButton, driveButton,
    });
  }
  function calibration(): ControllerCalibration | null {
    const base = baseCalibration();
    if (!base) return null;
    if (Object.keys(lookButtons).length === 0 && !lookStick) return base;
    return validateCalibration({ ...base, ...lookButtons, ...(lookStick ? { lookStick } : {}) });
  }
  function lookSteps(): readonly LookStep[] {
    return manualMode ? [...LOOK_BUTTON_STEPS, LOOK_STICK_STEP] : LOOK_BUTTON_STEPS;
  }
  /** The optional look step being captured, or null before the required controls are done or after the last one. */
  function currentLookStep(): LookStep | null {
    if (!captured() || (!manualMode && awaitingRelease) || baseCalibration() === null) return null;
    return lookSteps()[lookIndex] ?? null;
  }
  function lookComplete() {
    return captured() && lookIndex >= lookSteps().length;
  }
  function advanceLook() {
    lookIndex++;
    lookArmed = false;
    lookAxisBaseline = null;
    lookRejection = null;
    if (lookIndex >= lookSteps().length) {
      refresh();
      if (!save.disabled) save.focus();
    }
  }
  function skipLookStep() {
    if (!currentLookStep()) return;
    lookStickX = null;
    advanceLook();
    refresh();
  }
  function lookButtonConflict(index: number, base: ControllerCalibration): MessageKey | null {
    if (index === 0) return 'lookButtonParkingBrake';
    const used = new Set<number>([base.reverseButton, base.driveButton, ...Object.values(lookButtons)]);
    for (const pedal of [base.throttle, base.brake]) if (pedal.kind === 'button') used.add(pedal.index);
    return used.has(index) ? 'lookButtonInUse' : null;
  }
  function updateLookCheck() {
    const step = currentLookStep();
    const base = baseCalibration();
    if (!step || !pad || !base) return;
    if (step.id === 'look-stick') { updateLookStickCheck(pad, base); return; }
    const pressed = pad.buttons.findIndex((input) => input.value >= LOOK_BUTTON_PRESSED);
    if (!lookArmed) {
      if (pressed === -1) lookArmed = true;
      return;
    }
    if (pressed === -1) return;
    lookArmed = false;
    lookRejection = lookButtonConflict(pressed, base);
    if (lookRejection) return;
    lookButtons = { ...lookButtons, [step.key]: pressed };
    advanceLook();
  }
  function updateLookStickCheck(value: Gamepad, base: ControllerCalibration) {
    const axes = Array.from({ length: value.axes.length }, (_, index) => value.axes[index] ?? 0);
    if (!lookAxisBaseline || lookAxisBaseline.length !== axes.length) {
      lookAxisBaseline = axes;
      return;
    }
    const baseline = lookAxisBaseline;
    const deltas = axes.map((axis, index) => Math.abs(axis - (baseline[index] ?? 0)));
    if (!lookArmed) {
      if (deltas.every((delta) => delta <= LOOK_AXIS_NEUTRAL)) lookArmed = true;
      return;
    }
    let moved = -1;
    deltas.forEach((delta, index) => {
      if (index === lookStickX || delta < LOOK_AXIS_MOVED) return;
      if (moved === -1 || delta > deltas[moved]!) moved = index;
    });
    if (moved === -1) return;
    lookArmed = false;
    const reserved = new Set<number>([base.steeringAxis]);
    for (const pedal of [base.throttle, base.brake]) if (pedal.kind === 'axis') reserved.add(pedal.index);
    if (reserved.has(moved)) { lookRejection = 'lookAxisInUse'; return; }
    lookRejection = null;
    if (lookStickX === null) { lookStickX = moved; return; }
    lookStick = { xAxis: lookStickX, yAxis: moved };
    lookStickX = null;
    advanceLook();
  }
  const save = button(vi.saveCalibration, () => {
    sample();
    const value = calibration();
    if (!value) { issue ??= 'invalidCalibration'; refresh(); return; }
    onComplete(value);
  });
  save.className = 'primary-action';
  button(vi.cancel, onCancel);
  screen.append(diagnostics);
  function setText(node: HTMLElement, value: string) {
    if (node.textContent !== value) node.textContent = value;
  }
  function refresh() {
    const value = calibration();
    const message = issue ?? lookRejection ??
      (captured() && value === null ? 'invalidCalibration' : null);
    const lookStep = currentLookStep();
    setText(error, message ? vi[message] : '');
    setText(device, deviceId ?? vi.controllerDisconnected);
    const activeProfile = !manualMode && profile;
    const completed = manualMode ? manualIndex : profileIndex;
    setText(progress, `${vi.capturedProgress}: ${completed} / ${
      manualMode ? MANUAL_STEPS.length : PROFILE_STEPS.length
    }`);
    help.textContent = manualMode ? vi.calibrationHelp : vi.profileVerificationHelp;
    if (manualMode) {
      const step = MANUAL_STEPS[manualIndex];
      setText(instruction, step ? vi[step.message] : lookInstruction(lookStep)
        ?? vi.manualCalibrationComplete);
      instruction.dataset.calibrationStep = step?.id ?? lookStep?.id ?? 'complete';
      const restart = !step && captured() && value === null;
      manualCapture.hidden = !step && !restart;
      manualCapture.textContent = restart ? vi.restartCalibration : vi.captureCalibrationStep;
      manualCapture.disabled = pad === null || issue !== null;
      kindLabel.hidden = Boolean(profile);
      renderManualControls();
      if (step) renderIllustration(manualKind, step.part);
      else renderIllustration(manualKind, 'steering');
    } else if (activeProfile) {
      const step = PROFILE_STEPS[profileIndex];
      setText(instruction, profileIndex >= PROFILE_STEPS.length
        ? lookInstruction(lookStep) ?? vi.profileVerificationComplete
        : awaitingRelease ? vi.profileRelease : vi[step.message]);
      if (profileIndex < PROFILE_STEPS.length) {
        instruction.dataset.calibrationStep = step.id;
        renderIllustration(profile.kind, step.part);
      } else {
        instruction.dataset.calibrationStep = lookStep?.id ?? 'complete';
        renderIllustration(profile.kind, 'steering');
      }
      manualCapture.hidden = true;
      kindLabel.hidden = true;
      renderManualControls();
    }
    const fallback = screen.querySelector<HTMLButtonElement>('[data-manual-fallback]');
    if (fallback) fallback.hidden = manualMode;
    skip.hidden = lookStep === null;
    illustration.hidden = lookStep !== null;
    save.disabled = value === null;
    manualCapture.disabled = manualCapture.disabled || pad === null || issue !== null;
    if (save.disabled && document.activeElement === save) instruction.focus();
    if (manualCapture.disabled && document.activeElement === manualCapture) instruction.focus();
    if (skip.hidden && document.activeElement === skip) instruction.focus();
  }
  function lookInstruction(step: LookStep | null): string | null {
    if (!step) return lookComplete() && calibration() !== null ? vi.lookSetupComplete : null;
    if (step.id !== 'look-stick') return vi[step.message];
    return lookStickX === null ? vi.lookStickHorizontal : vi.lookStickVertical;
  }
  function renderIllustration(kind: 'wheel' | 'gamepad', part: CalibrationPart) {
    const key = `${kind}:${part}`;
    if (renderedIllustration === key) return;
    illustration.replaceChildren(createControllerIllustration(kind, part));
    renderedIllustration = key;
  }
  function tick() {
    if (disposed) return;
    sample();
    updateProfileCheck();
    updateLookCheck();
    if (diagnostics.open) monitor.textContent = pad ? `${pad.id}\n` +
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
    if (event.key === 'Tab') {
      const focusable = [...screen.querySelectorAll<HTMLElement>(
        'button:not(:disabled):not([hidden]), input:not([hidden]), select:not([hidden]), summary',
      )];
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    }
  }, { signal: listeners.signal });
  sample();
  refresh();
  frame = window.requestAnimationFrame(tick);
  if (manualMode && !manualCapture.disabled) manualCapture.focus();
  else instruction.focus();
  return () => {
    if (disposed) return;
    disposed = true;
    if (frame !== null) window.cancelAnimationFrame(frame);
    listeners.abort();
    screen.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  };
}
