import type {
  ControllerCalibration, Gear, InputAction, InputFrame, InputSource, Indicator, MessageKey,
} from '../contracts';
import type { InputPoll } from '../runtime-types';
import { normalizePedal, normalizeSteering, validateCalibration } from './calibration';

export interface InputController {
  poll(): InputPoll;
  enqueue(action: InputAction): void;
  selectSource(source: InputSource, index?: number): void;
  setCalibration(value: ControllerCalibration): void;
  clear(): void;
  checkNeutral(): MessageKey | null;
  dispose(): void;
}

const NEUTRAL_PEDAL = 0.02;
const MAX_GAMEPAD_INDEX = 63;

type Movement = 'throttle' | 'brake' | 'left' | 'right';
const movementKeys: Readonly<Record<string, Movement>> = {
  KeyW: 'throttle', ArrowUp: 'throttle', KeyS: 'brake', ArrowDown: 'brake',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};
const gearKeys: Readonly<Record<string, Gear>> = {
  Digit1: 'P', Digit2: 'R', Digit3: 'N', Digit4: 'D',
};
const indicatorKeys: Readonly<Record<string, Exclude<Indicator, 'off'>>> = {
  KeyQ: 'left', KeyE: 'right',
};

type GamepadRead =
  | { readonly issue: MessageKey }
  | { readonly issue: null; readonly frame: InputFrame;
      readonly reverse: boolean; readonly drive: boolean; readonly parkingBrake: boolean };

function isEditable(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  if (target.closest('input, select, textarea') !== null) return true;
  return target instanceof HTMLElement && target.isContentEditable
    || target.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

export function createInputController(
  target: HTMLElement,
  getGamepads: () => readonly (Gamepad | null)[],
): InputController {
  const abort = new AbortController();
  let disposed = false;
  let source: InputSource = 'keyboard';
  let gamepadIndex = 0;
  let calibration: ControllerCalibration | null = null;
  let calibrationInvalid = false;
  let queue: InputAction[] = [];
  let indicatorIntent: Indicator = 'off';
  let pendingIssue: MessageKey | null = null;
  const held = new Set<string>();
  const suppressed = new Set<string>();
  let gamepadEdges: { reverse: boolean; drive: boolean; parkingBrake: boolean } | null = null;

  const zeroFrame = (): InputFrame =>
    ({ source, throttle: 0, brake: 0, steering: 0 });
  const fail = (issue: MessageKey): InputPoll => {
    queue = [];
    gamepadEdges = null;
    return { frame: zeroFrame(), actions: [], issue };
  };

  function clearState(): void {
    queue = [];
    pendingIssue = null;
    gamepadEdges = null;
    for (const code of held) suppressed.add(code);
    held.clear();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (disposed || isEditable(event.target)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const { code } = event;
    const movement = movementKeys[code];
    if (movement !== undefined) {
      if (source !== 'keyboard') {
        // Track physical state so a later switch to keyboard can suppress it.
        if (!event.repeat) held.add(code);
        return;
      }
      event.preventDefault();
      if (!event.repeat) {
        suppressed.delete(code);
        held.add(code);
      }
      return;
    }
    if (target.ownerDocument.activeElement !== target) return;
    const gear = gearKeys[code];
    const indicator = indicatorKeys[code];
    if (code !== 'Space' && code !== 'KeyF' && gear === undefined && indicator === undefined) return;
    event.preventDefault();
    if (event.repeat) return;
    if (code === 'KeyF') {
      enqueue({ type: 'acknowledge-step' });
    } else if (code === 'Space') {
      enqueue({ type: 'toggle-parking-brake' });
    } else if (gear !== undefined) {
      enqueue({ type: 'request-gear', gear });
    } else if (indicator !== undefined) {
      enqueue({ type: 'set-indicator', indicator: indicatorIntent === indicator ? 'off' : indicator });
    }
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (disposed) return;
    held.delete(event.code);
    suppressed.delete(event.code);
  }

  function onBlur(): void {
    if (disposed || source !== 'keyboard') return;
    pendingIssue = 'keyboardFocusLost';
    queue = [];
    for (const code of held) suppressed.add(code);
    held.clear();
  }

  target.addEventListener('keydown', onKeyDown, { signal: abort.signal });
  // Keyup anywhere only neutralizes tracked keys; it never activates or intercepts controls.
  target.addEventListener('keyup', onKeyUp, { signal: abort.signal });
  target.ownerDocument.addEventListener('keyup', onKeyUp, { signal: abort.signal });
  target.addEventListener('blur', onBlur, { signal: abort.signal });
  target.ownerDocument.defaultView?.addEventListener('focus', () => {
    // Keyup may have gone to another app; repeats still cannot reactivate a held key.
    suppressed.clear();
  }, { signal: abort.signal });

  function enqueue(action: InputAction): void {
    if (disposed) return;
    if (action.type === 'set-indicator') indicatorIntent = action.indicator;
    queue.push(action);
  }

  function readGamepad(): GamepadRead {
    if (calibrationInvalid) return { issue: 'invalidCalibration' };
    if (calibration === null) return { issue: 'controllerNeedsSetup' };
    if (!Number.isInteger(gamepadIndex) || gamepadIndex < 0 || gamepadIndex > MAX_GAMEPAD_INDEX) {
      return { issue: 'controllerInvalid' };
    }
    let pads: readonly (Gamepad | null)[];
    try {
      pads = getGamepads();
    } catch {
      return { issue: 'controllerUnavailable' };
    }
    const pad = pads[gamepadIndex];
    if (!pad || !pad.connected) return { issue: 'controllerDisconnected' };
    if (pad.id !== calibration.deviceId) return { issue: 'controllerReplaced' };
    const cal = calibration;
    const axes = pad.axes;
    const padButtons = pad.buttons;
    const pedalRaw = (binding: ControllerCalibration['throttle']): number | undefined =>
      binding.kind === 'axis' ? axes[binding.index] : padButtons[binding.index]?.value;
    const steeringRaw = axes[cal.steeringAxis];
    const throttleRaw = pedalRaw(cal.throttle);
    const brakeRaw = pedalRaw(cal.brake);
    const reverse = padButtons[cal.reverseButton];
    const drive = padButtons[cal.driveButton];
    const parkingBrake = padButtons[0];
    if (steeringRaw === undefined || throttleRaw === undefined || brakeRaw === undefined
      || reverse === undefined || drive === undefined || parkingBrake === undefined) {
      return { issue: 'controllerControlsMissing' };
    }
    try {
      const frame: InputFrame = {
        source: 'gamepad',
        steering: normalizeSteering(steeringRaw, cal),
        throttle: normalizePedal(throttleRaw, cal.throttle),
        brake: normalizePedal(brakeRaw, cal.brake),
      };
      return {
        issue: null,
        frame,
        reverse: reverse.pressed === true,
        drive: drive.pressed === true,
        parkingBrake: parkingBrake.pressed === true,
      };
    } catch (error) {
      if (error instanceof RangeError) return { issue: 'controllerInvalid' };
      throw error;
    }
  }

  function poll(): InputPoll {
    if (disposed) return fail('controllerUnavailable');
    if (source === 'keyboard') {
      const unfocused = target.ownerDocument.activeElement !== target;
      if (pendingIssue !== null || unfocused) {
        pendingIssue = null;
        return fail('keyboardFocusLost');
      }
      const active = (movement: Movement): number =>
        [...held].some((code) => movementKeys[code] === movement) ? 1 : 0;
      const frame: InputFrame = { source, throttle: active('throttle'), brake: active('brake'),
        steering: active('left') - active('right') };
      const actions = queue;
      queue = [];
      return { frame, actions, issue: null };
    }
    const read = readGamepad();
    if (read.issue !== null) return fail(read.issue);
    const actions = queue;
    queue = [];
    if (gamepadEdges !== null) {
      if (read.reverse && !gamepadEdges.reverse) actions.push({ type: 'request-gear', gear: 'R' });
      if (read.drive && !gamepadEdges.drive) actions.push({ type: 'request-gear', gear: 'D' });
      if (read.parkingBrake && !gamepadEdges.parkingBrake) {
        actions.push({ type: 'toggle-parking-brake' });
      }
    }
    gamepadEdges = {
      reverse: read.reverse, drive: read.drive, parkingBrake: read.parkingBrake,
    };
    return { frame: read.frame, actions, issue: null };
  }

  function checkNeutral(): MessageKey | null {
    if (disposed) return 'controllerUnavailable';
    if (source === 'keyboard') {
      return held.size > 0 || suppressed.size > 0 ? 'keysNotReleased' : null;
    }
    const read = readGamepad();
    if (read.issue !== null) return read.issue;
    return read.frame.throttle > NEUTRAL_PEDAL || read.frame.brake > NEUTRAL_PEDAL
      ? 'pedalsNotReleased' : null;
  }

  return {
    poll,
    enqueue,
    selectSource(next, index) {
      if (disposed) return;
      source = next;
      gamepadIndex = index ?? 0;
      clearState();
    },
    setCalibration(value) {
      if (disposed) return;
      const valid = validateCalibration(value);
      calibration = valid;
      calibrationInvalid = valid === null;
      gamepadEdges = null;
    },
    clear() {
      if (!disposed) clearState();
    },
    checkNeutral,
    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      queue = [];
      held.clear();
      suppressed.clear();
      gamepadEdges = null;
      pendingIssue = null;
    },
  };
}
