// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ControllerCalibration } from '../contracts';
import { normalizePedal, normalizeSteering, validateCalibration } from './calibration';
import { createInputController, type InputController } from './controller';
import { calibrationForProfile, controllerProfiles, findControllerProfile } from './profiles';
import { testGamepad } from '../test/gamepad';

const wheel = { version: 1, deviceId: 'w', steeringAxis: 0, steeringLeft: -0.6,
  steeringCenter: 0.1, steeringRight: 0.9,
  throttle: { kind: 'axis', index: 1, released: 1, pressed: -1 },
  brake: { kind: 'button', index: 6, released: 0, pressed: 1 },
  reverseButton: 4, driveButton: 5 } as const;

const combined: ControllerCalibration = { ...wheel,
  throttle: { kind: 'axis', index: 2, released: 0, pressed: 1 },
  brake: { kind: 'axis', index: 2, released: 0, pressed: -1 } };

describe('controller profiles', () => {
  it('provides valid device-bound profiles for the supported model list', () => {
    expect(controllerProfiles.map(({ id }) => id).sort()).toEqual([
      '8bitdo-ultimate-2c', 'logitech-g29', 'logitech-g920', 'logitech-g923',
      'thrustmaster-t300-rs-gt', 'xbox-series-x',
    ]);

    for (const { id } of controllerProfiles) {
      const calibration = calibrationForProfile(id, 'device-17');
      expect(calibration.deviceId).toBe('device-17');
      expect(validateCalibration(calibration)).toEqual(calibration);
    }

    expect(calibrationForProfile('xbox-series-x', 'xbox-pad').throttle)
      .toEqual({ kind: 'button', index: 7, released: 0, pressed: 1 });
    expect(calibrationForProfile('logitech-g29', 'wheel').brake)
      .toEqual({ kind: 'axis', index: 2, released: -1, pressed: 1 });
  });

  it('matches named gamepads only with the standard mapping', () => {
    expect(findControllerProfile({
      id: 'Xbox Wireless Controller Series X', mapping: 'standard',
    })?.id).toBe('xbox-series-x');
    expect(findControllerProfile({
      id: '8BitDo Ultimate 2C Wireless Controller', mapping: 'standard',
    })?.id).toBe('8bitdo-ultimate-2c');
    expect(findControllerProfile({
      id: 'Xbox Wireless Controller Series X', mapping: '',
    })).toBeNull();
    expect(findControllerProfile({ id: 'Unknown standard pad', mapping: 'standard' }))
      .toBeNull();
  });

  it('matches candidate wheels by exact model token without adjacent models', () => {
    expect(findControllerProfile({
      id: 'Logitech G29 Driving Force Racing Wheel', mapping: '',
    })?.id).toBe('logitech-g29');
    expect(findControllerProfile({
      id: 'Thrustmaster T300 RS GT', mapping: '',
    })?.id).toBe('thrustmaster-t300-rs-gt');
    expect(findControllerProfile({ id: 'Logitech G27 Racing Wheel', mapping: '' }))
      .toBeNull();
  });
});

describe('calibration', () => {
  it('maps inverted axis pedals and asymmetric steering', () => {
    expect(normalizePedal(1, wheel.throttle)).toBe(0);
    expect(normalizePedal(-1, wheel.throttle)).toBe(1);
    expect(normalizePedal(0, wheel.throttle)).toBeCloseTo(0.5, 6);
    expect(normalizeSteering(-0.25, wheel)).toBeCloseTo(0.4898, 3);
    expect(normalizeSteering(0.1, wheel)).toBe(0);
    expect(normalizeSteering(0.5, wheel)).toBeCloseTo(-0.4898, 3);
    expect(normalizeSteering(-0.6, wheel)).toBeCloseTo(1, 6);
    expect(normalizeSteering(0.1 + 0.7 * 0.015, wheel)).toBe(0);
  });

  it('handles either raw ordering of the steering endpoints', () => {
    const flipped = { ...wheel, steeringLeft: 0.9, steeringRight: -0.6 };
    expect(normalizeSteering(0.5, flipped)).toBeCloseTo(0.4898, 3);
    expect(normalizeSteering(-0.25, flipped)).toBeCloseTo(-0.4898, 3);
  });

  it('rejects unsafe samples visibly', () => {
    expect(() => normalizePedal(Number.NaN, wheel.brake)).toThrow(RangeError);
    expect(() => normalizePedal(Infinity, wheel.brake)).toThrow(RangeError);
    expect(() => normalizePedal(1.01, wheel.brake)).toThrow(RangeError);
    expect(() => normalizeSteering(1.5, wheel)).toThrow(RangeError);
    expect(() => normalizeSteering(Number.NaN, wheel)).toThrow(RangeError);
  });

  it('accepts a valid calibration and a shared-axis combined-pedal layout', () => {
    expect(validateCalibration(wheel)).toEqual(wheel);
    expect(validateCalibration(combined)).toEqual(combined);
    expect(validateCalibration(JSON.parse(JSON.stringify(wheel)))).toEqual(wheel);
  });

  const bad: [string, unknown][] = [
    ['null', null], ['string', 'x'], ['array', []], ['empty object', {}],
    ['wrong version', { ...wheel, version: 2 }],
    ['numeric device id', { ...wheel, deviceId: 7 }],
    ['empty device id', { ...wheel, deviceId: '' }],
    ['missing brake', { ...wheel, brake: undefined }],
    ['centre at endpoint', { ...wheel, steeringCenter: -0.6 }],
    ['centre outside span', { ...wheel, steeringCenter: 0.95 }],
    ['NaN endpoint', { ...wheel, steeringRight: Number.NaN }],
    ['endpoint above 1', { ...wheel, steeringRight: 1.2 }],
    ['string endpoint', { ...wheel, steeringLeft: '-0.6' }],
    ['fractional steering axis', { ...wheel, steeringAxis: 1.5 }],
    ['negative axis', { ...wheel, steeringAxis: -1 }],
    ['axis 64', { ...wheel, steeringAxis: 64 }],
    ['same reverse and drive', { ...wheel, driveButton: 4 }],
    ['button 64', { ...wheel, reverseButton: 64 }],
    ['unknown pedal kind', { ...wheel, brake: { ...wheel.brake, kind: 'pad' } }],
    ['pedal span too small', { ...wheel, brake: { ...wheel.brake, pressed: 0.05 } }],
    ['pedal pin out of range', { ...wheel, throttle: { ...wheel.throttle, pressed: -1.5 } }],
    ['button pedal below 0', { ...wheel, brake: { ...wheel.brake, released: -0.5 } }],
    ['pedal index fractional', { ...wheel, brake: { ...wheel.brake, index: 6.5 } }],
  ];
  it.each(bad)('rejects malformed calibration: %s', (_name, value) => {
    expect(validateCalibration(value)).toBeNull();
  });
});

interface World { pads: (Gamepad | null)[] }
const targets: HTMLElement[] = [];
let controllers: InputController[] = [];

function makePad(over: { id?: string; connected?: boolean; axes?: number[];
  buttons?: number[]; index?: number } = {}): Gamepad {
  const axes = over.axes ?? [0.1, 1, 0, 0];
  const buttons = (over.buttons ?? [0, 0, 0, 0, 0, 0, 0, 0]).map((value) =>
    ({ value, pressed: value > 0.5, touched: value > 0 }));
  return { ...testGamepad(), id: over.id ?? 'w', index: over.index ?? 0,
    connected: over.connected ?? true, axes, buttons, mapping: '' };
}

function setup(pad: Gamepad | null = makePad()) {
  const target = document.createElement('div');
  target.tabIndex = 0;
  const field = document.createElement('input');
  target.append(field);
  document.body.append(target);
  targets.push(target);
  target.focus();
  const world: World = { pads: [pad] };
  const getGamepads = vi.fn((): (Gamepad | null)[] => world.pads);
  const controller = createInputController(target, getGamepads);
  controllers.push(controller);
  return { target, field, world, getGamepads, controller };
}

function key(el: EventTarget, type: 'keydown' | 'keyup', code: string,
  init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  return event;
}

function gamepadController(pad: Gamepad | null = makePad()) {
  const ctx = setup(pad);
  ctx.controller.selectSource('gamepad', 0);
  ctx.controller.setCalibration(wheel);
  return ctx;
}

afterEach(() => {
  controllers.forEach((c) => c.dispose());
  controllers = [];
  targets.splice(0).forEach((t) => t.remove());
});

describe('keyboard source', () => {
  it('cancels steering and reports a normalized frame without querying gamepads', () => {
    const { target, controller, getGamepads } = setup();
    key(target, 'keydown', 'KeyW');
    key(target, 'keydown', 'KeyA');
    key(target, 'keydown', 'KeyD');
    expect(controller.poll()).toEqual({
      frame: { source: 'keyboard', throttle: 1, brake: 0, steering: 0 },
      actions: [], issue: null });
    key(target, 'keyup', 'KeyD');
    key(target, 'keyup', 'KeyW');
    key(target, 'keydown', 'ArrowDown');
    expect(controller.poll().frame).toEqual(
      { source: 'keyboard', throttle: 0, brake: 1, steering: 1 });
    expect(getGamepads).not.toHaveBeenCalled();
  });

  it('emits one toggle for held Space, gear requests and prevents default only for driving keys', () => {
    const { target, controller } = setup();
    expect(key(target, 'keydown', 'Space').defaultPrevented).toBe(true);
    key(target, 'keydown', 'Space', { repeat: true });
    key(target, 'keydown', 'Digit2');
    expect(key(target, 'keydown', 'KeyZ').defaultPrevented).toBe(false);
    expect(key(target, 'keydown', 'Escape').defaultPrevented).toBe(false);
    expect(controller.poll().actions).toEqual([
      { type: 'toggle-parking-brake' }, { type: 'request-gear', gear: 'R' }]);
    expect(controller.poll().actions).toEqual([]);
  });

  it('carries the desired indicator from internal intent', () => {
    const { target, controller } = setup();
    key(target, 'keydown', 'KeyQ');
    key(target, 'keyup', 'KeyQ');
    key(target, 'keydown', 'KeyQ');
    key(target, 'keyup', 'KeyQ');
    key(target, 'keydown', 'KeyQ');
    key(target, 'keydown', 'KeyE');
    expect(controller.poll().actions).toEqual([
      { type: 'set-indicator', indicator: 'left' },
      { type: 'set-indicator', indicator: 'off' },
      { type: 'set-indicator', indicator: 'left' },
      { type: 'set-indicator', indicator: 'right' }]);
    controller.enqueue({ type: 'set-indicator', indicator: 'right' });
    key(target, 'keydown', 'KeyE');
    expect(controller.poll().actions).toEqual([
      { type: 'set-indicator', indicator: 'right' },
      { type: 'set-indicator', indicator: 'off' }]);
  });

  it('keeps indicator intent across clear()', () => {
    const { target, controller } = setup();
    key(target, 'keydown', 'KeyQ');
    controller.clear();
    key(target, 'keydown', 'KeyQ');
    expect(controller.poll().actions).toEqual([{ type: 'set-indicator', indicator: 'off' }]);
  });

  it('ignores editable targets and modified shortcuts', () => {
    const { target, field, controller } = setup();
    const typed = key(field, 'keydown', 'KeyW');
    expect(typed.defaultPrevented).toBe(false);
    key(field, 'keydown', 'Space');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    target.append(editable);
    key(editable, 'keydown', 'KeyW');
    expect(key(target, 'keydown', 'KeyW', { ctrlKey: true }).defaultPrevented).toBe(false);
    key(target, 'keydown', 'Digit4', { metaKey: true });
    key(target, 'keydown', 'KeyQ', { altKey: true });
    expect(controller.poll()).toEqual({
      frame: { source: 'keyboard', throttle: 0, brake: 0, steering: 0 },
      actions: [], issue: null });
  });

  it('releases a tracked key even if its keyup carries a modifier or is typed in a field', () => {
    const { target, field, controller } = setup();
    key(target, 'keydown', 'KeyW');
    key(target, 'keyup', 'KeyW', { ctrlKey: true });
    expect(controller.poll().frame.throttle).toBe(0);
    expect(controller.checkNeutral()).toBeNull();
    key(target, 'keydown', 'KeyS');
    key(field, 'keyup', 'KeyS');
    expect(controller.checkNeutral()).toBeNull();
  });

  it('reports focus loss without a frame when the canvas is not focused', () => {
    const { target, controller } = setup();
    key(target, 'keydown', 'KeyW');
    target.blur();
    target.dispatchEvent(new Event('blur'));
    expect(controller.poll()).toEqual({
      frame: { source: 'keyboard', throttle: 0, brake: 0, steering: 0 },
      actions: [], issue: 'keyboardFocusLost' });
    const bare = document.createElement('div');
    bare.tabIndex = 0;
    document.body.append(bare);
    targets.push(bare);
    const own = createInputController(bare, () => []);
    controllers.push(own);
    expect(own.poll().issue).toBe('keyboardFocusLost');
  });

  it('suppresses a key held across blur until release or a fresh press', () => {
    const { target, controller } = setup();
    key(target, 'keydown', 'KeyW');
    controller.enqueue({ type: 'help' });
    target.dispatchEvent(new Event('blur'));
    target.focus();
    expect(controller.poll().issue).toBe('keyboardFocusLost');
    expect(controller.poll()).toEqual({
      frame: { source: 'keyboard', throttle: 0, brake: 0, steering: 0 },
      actions: [], issue: null });
    key(target, 'keydown', 'KeyW', { repeat: true });
    expect(controller.poll().frame.throttle).toBe(0);
    expect(controller.checkNeutral()).toBe('keysNotReleased');
    key(target, 'keyup', 'KeyW');
    expect(controller.checkNeutral()).toBeNull();

    key(target, 'keydown', 'KeyW');
    target.dispatchEvent(new Event('blur'));
    target.focus();
    expect(controller.checkNeutral()).toBe('keysNotReleased');
    expect(controller.poll().issue).toBe('keyboardFocusLost');
    key(target, 'keydown', 'KeyW');
    expect(controller.poll().frame.throttle).toBe(1);
  });

  it('neutralizes a suppressed key released while another DOM control or the document has focus', () => {
    const { target, controller } = setup();
    const resume = document.createElement('button');
    document.body.append(resume);
    targets.push(resume);
    key(target, 'keydown', 'KeyW');
    key(target, 'keydown', 'KeyS');
    key(target, 'keydown', 'KeyA');
    target.dispatchEvent(new Event('blur'));
    resume.focus();
    expect(controller.poll().issue).toBe('keyboardFocusLost');
    expect(controller.checkNeutral()).toBe('keysNotReleased');
    expect(key(resume, 'keyup', 'KeyW').defaultPrevented).toBe(false);
    key(document, 'keyup', 'KeyS', { shiftKey: true });
    expect(controller.checkNeutral()).toBe('keysNotReleased');
    key(resume, 'keyup', 'KeyA', { ctrlKey: true });
    expect(controller.checkNeutral()).toBeNull();
  });

  it('never activates driving from keys pressed outside the canvas', () => {
    const { controller } = setup();
    const resume = document.createElement('button');
    document.body.append(resume);
    targets.push(resume);
    expect(key(resume, 'keydown', 'KeyW').defaultPrevented).toBe(false);
    key(resume, 'keydown', 'Space');
    resume.dispatchEvent(new Event('blur'));
    expect(controller.checkNeutral()).toBeNull();
    expect(controller.poll().actions).toEqual([]);
  });

  it('recovers a key released outside the window without replaying held-key repeats', () => {
    const { target, controller } = setup();
    key(target, 'keydown', 'KeyW');
    target.dispatchEvent(new Event('blur'));
    controller.clear();
    window.dispatchEvent(new Event('blur'));
    expect(controller.checkNeutral()).toBe('keysNotReleased');
    window.dispatchEvent(new Event('focus'));
    expect(controller.checkNeutral()).toBeNull();
    key(target, 'keydown', 'KeyW', { repeat: true });
    expect(controller.poll()).toEqual({
      frame: { source: 'keyboard', throttle: 0, brake: 0, steering: 0 },
      actions: [], issue: null });
    key(target, 'keydown', 'KeyW');
    expect(controller.poll().frame.throttle).toBe(1);
  });

  it('does not clear suppression in clear() and drops the queue', () => {
    const { target, controller } = setup();
    key(target, 'keydown', 'KeyS');
    controller.enqueue({ type: 'toggle-parking-brake' });
    controller.clear();
    controller.clear();
    expect(controller.checkNeutral()).toBe('keysNotReleased');
    expect(controller.poll()).toEqual({
      frame: { source: 'keyboard', throttle: 0, brake: 0, steering: 0 },
      actions: [], issue: null });
    key(target, 'keyup', 'KeyS');
    expect(controller.checkNeutral()).toBeNull();
  });

  it('does not let a reset queue repeat old actions', () => {
    const { controller } = setup();
    controller.enqueue({ type: 'request-gear', gear: 'D' });
    controller.clear();
    expect(controller.poll().actions).toEqual([]);
  });
});

describe('shared discrete learner controls', () => {
  it('emits one acknowledge-step per non-repeat F press in keyboard mode', () => {
    const { target, controller } = setup();
    expect(key(target, 'keydown', 'KeyF').defaultPrevented).toBe(true);
    key(target, 'keydown', 'KeyF', { repeat: true });
    expect(controller.poll().actions).toEqual([{ type: 'acknowledge-step' }]);
    expect(controller.poll().actions).toEqual([]);
  });

  it('accepts F, Digit1, Space and E in calibrated gamepad mode without keyboard movement', () => {
    const { target, controller, world } = gamepadController();
    world.pads = [makePad({ axes: [-0.25, 0, 0, 0] })];
    key(target, 'keydown', 'KeyW');
    key(target, 'keydown', 'KeyF');
    key(target, 'keydown', 'Digit1');
    key(target, 'keydown', 'Space');
    key(target, 'keydown', 'KeyE');
    const poll = controller.poll();
    expect(poll.actions).toEqual([
      { type: 'acknowledge-step' }, { type: 'request-gear', gear: 'P' },
      { type: 'toggle-parking-brake' }, { type: 'set-indicator', indicator: 'right' }]);
    expect(poll.frame.source).toBe('gamepad');
    expect(poll.frame.throttle).toBeCloseTo(0.5, 6);
    expect(poll.frame.steering).toBeCloseTo(0.4898, 3);
  });

  it.each(['keyboard', 'gamepad'] as const)(
    'ignores modified, repeated, editable and unfocused discrete keys in %s mode', (mode) => {
      const { target, field, controller } = mode === 'keyboard' ? setup() : gamepadController();
      key(target, 'keydown', 'KeyF', { ctrlKey: true });
      key(target, 'keydown', 'Digit1', { repeat: true });
      key(field, 'keydown', 'KeyF');
      key(field, 'keydown', 'KeyE');
      field.focus();
      key(target, 'keydown', 'KeyF');
      key(target, 'keydown', 'Space');
      target.focus();
      expect(controller.poll().actions).toEqual([]);
    });
});

describe('gamepad source', () => {
  it('reads only the selected calibrated pad and ignores keyboard', () => {
    const { target, controller, world, getGamepads } = gamepadController();
    world.pads = [makePad({ axes: [-0.25, 0, 0, 0], buttons: [0, 0, 0, 0, 0, 0, 0.5, 0] }),
      makePad({ id: 'other' })];
    key(target, 'keydown', 'KeyW');
    key(target, 'keydown', 'KeyQ');
    const poll = controller.poll();
    expect(getGamepads).toHaveBeenCalledTimes(1);
    expect(poll.issue).toBeNull();
    expect(poll.actions).toEqual([{ type: 'set-indicator', indicator: 'left' }]);
    expect(poll.frame.source).toBe('gamepad');
    expect(poll.frame.steering).toBeCloseTo(0.4898, 3);
    expect(poll.frame.throttle).toBeCloseTo(0.5, 6);
    expect(poll.frame.brake).toBe(0.5);
  });

  it('toggles the parking brake on a gamepad button press edge', () => {
    const { controller, world } = gamepadController();
    world.pads = [makePad()];
    expect(controller.poll().actions).toEqual([]);
    world.pads = [makePad({ buttons: [1, 0, 0, 0, 0, 0, 0, 0] })];
    expect(controller.poll().actions).toEqual([{ type: 'toggle-parking-brake' }]);
    expect(controller.poll().actions).toEqual([]);
    world.pads = [makePad()];
    controller.poll();
    world.pads = [makePad({ buttons: [1, 0, 0, 0, 0, 0, 0, 0] })];
    expect(controller.poll().actions).toEqual([{ type: 'toggle-parking-brake' }]);
  });

  it('keeps gamepad state when the canvas blurs to a HUD control', () => {
    const { target, controller } = gamepadController();
    controller.enqueue({ type: 'toggle-parking-brake' });
    target.dispatchEvent(new Event('blur'));
    document.body.focus();
    expect(controller.poll()).toEqual({
      frame: { source: 'gamepad', throttle: 0, brake: 0, steering: 0 },
      actions: [{ type: 'toggle-parking-brake' }], issue: null });
  });

  const zero = { source: 'gamepad', throttle: 0, brake: 0, steering: 0 };
  it('requires setup before any read', () => {
    const { controller, getGamepads } = setup();
    controller.selectSource('gamepad', 0);
    expect(controller.poll()).toEqual({ frame: zero, actions: [], issue: 'controllerNeedsSetup' });
    expect(controller.checkNeutral()).toBe('controllerNeedsSetup');
    expect(getGamepads).not.toHaveBeenCalled();
  });

  it('reports an invalid calibration instead of driving', () => {
    const { controller } = setup();
    controller.selectSource('gamepad', 0);
    controller.setCalibration({ ...wheel, driveButton: 4 });
    expect(controller.poll().issue).toBe('invalidCalibration');
  });

  it.each([-1, 1.5, 64, Number.NaN])('treats gamepad index %s as invalid', (index) => {
    const { controller, getGamepads } = setup();
    controller.selectSource('gamepad', index);
    controller.setCalibration(wheel);
    expect(controller.poll()).toEqual({ frame: zero, actions: [], issue: 'controllerInvalid' });
    expect(getGamepads).not.toHaveBeenCalled();
  });

  it('maps each failure to its specific issue with zero frame and no keyboard fallback', () => {
    const { target, controller, world, getGamepads } = gamepadController();
    key(target, 'keydown', 'KeyW');
    const cases: [string, () => void, string][] = [
      ['absent', () => { world.pads = []; }, 'controllerDisconnected'],
      ['null slot', () => { world.pads = [null]; }, 'controllerDisconnected'],
      ['disconnected', () => { world.pads = [makePad({ connected: false })]; },
        'controllerDisconnected'],
      ['replaced', () => { world.pads = [makePad({ id: 'other' })]; }, 'controllerReplaced'],
      ['wrong slot, same id', () => { world.pads = [null, makePad({ index: 1 })]; },
        'controllerDisconnected'],
      ['provider throws', () => { getGamepads.mockImplementationOnce(() => { throw new Error('x'); }); },
        'controllerUnavailable'],
      ['NaN steering', () => { world.pads = [makePad({ axes: [Number.NaN, 1] })]; },
        'controllerInvalid'],
      ['Infinity button', () => { world.pads = [makePad({ buttons: [0, 0, 0, 0, 0, 0, Infinity, 0] })]; },
        'controllerInvalid'],
      ['out-of-range axis', () => { world.pads = [makePad({ axes: [0.1, 1.5] })]; },
        'controllerInvalid'],
      ['missing steering axis', () => { world.pads = [makePad({ axes: [] })]; },
        'controllerControlsMissing'],
      ['missing pedal axis', () => { world.pads = [makePad({ axes: [0.1] })]; },
        'controllerControlsMissing'],
      ['missing brake button', () => { world.pads = [makePad({ buttons: [0, 0, 0] })]; },
        'controllerControlsMissing'],
      ['short button list', () => { world.pads = [makePad({ buttons: [0, 0, 0, 0, 0] })]; },
        'controllerControlsMissing'],
    ];
    for (const [name, arrange, issue] of cases) {
      world.pads = [makePad()];
      arrange();
      controller.enqueue({ type: 'help' });
      expect(controller.poll(), name).toEqual({ frame: zero, actions: [], issue });
      world.pads = [makePad()];
      expect(controller.poll(), name).toMatchObject({ issue: null });
    }
  });

  it('reports pad faults from checkNeutral', () => {
    const { controller, world } = gamepadController();
    world.pads = [];
    expect(controller.checkNeutral()).toBe('controllerDisconnected');
    world.pads = [makePad({ id: 'z' })];
    expect(controller.checkNeutral()).toBe('controllerReplaced');
    world.pads = [makePad({ axes: [Number.NaN, 1] })];
    expect(controller.checkNeutral()).toBe('controllerInvalid');
  });

  it('checkNeutral reads live pedals, with 0.02 still neutral', () => {
    const { controller, world } = gamepadController();
    world.pads = [makePad({ buttons: [0, 0, 0, 0, 0, 0, 0.03, 0] })];
    expect(controller.checkNeutral()).toBe('pedalsNotReleased');
    world.pads = [makePad({ buttons: [0, 0, 0, 0, 0, 0, 0.02, 0] })];
    expect(controller.checkNeutral()).toBeNull();
    world.pads = [makePad({ axes: [0.1, 0.9] })];
    expect(controller.checkNeutral()).toBe('pedalsNotReleased');
    world.pads = [makePad()];
    expect(controller.checkNeutral()).toBeNull();
  });

  it('emits R/D only on a rising edge and treats an initially held shoulder as held', () => {
    const { controller, world } = gamepadController(makePad({ buttons: [0, 0, 0, 0, 1, 0, 0, 0] }));
    expect(controller.poll().actions).toEqual([]);
    expect(controller.poll().actions).toEqual([]);
    world.pads = [makePad()];
    expect(controller.poll().actions).toEqual([]);
    world.pads = [makePad({ buttons: [0, 0, 0, 0, 1, 0, 0, 0] })];
    expect(controller.poll().actions).toEqual([{ type: 'request-gear', gear: 'R' }]);
    expect(controller.poll().actions).toEqual([]);
    world.pads = [makePad({ buttons: [0, 0, 0, 0, 0, 1, 0, 0] })];
    expect(controller.poll().actions).toEqual([{ type: 'request-gear', gear: 'D' }]);
  });

  it('does not turn a shoulder held through a fault or clear into an edge', () => {
    const { controller, world } = gamepadController();
    controller.poll();
    world.pads = [];
    expect(controller.poll().issue).toBe('controllerDisconnected');
    world.pads = [makePad({ buttons: [0, 0, 0, 0, 0, 1, 0, 0] })];
    expect(controller.poll().actions).toEqual([]);
    controller.clear();
    expect(controller.poll().actions).toEqual([]);
    world.pads = [makePad()];
    controller.poll();
    world.pads = [makePad({ buttons: [0, 0, 0, 0, 0, 1, 0, 0] })];
    expect(controller.poll().actions).toEqual([{ type: 'request-gear', gear: 'D' }]);
  });

  it('selectSource clears queued actions and switching back to keyboard suppresses held keys', () => {
    const { target, controller } = setup();
    controller.enqueue({ type: 'toggle-parking-brake' });
    controller.selectSource('gamepad', 0);
    controller.selectSource('keyboard');
    expect(controller.poll().actions).toEqual([]);
    controller.selectSource('gamepad', 0);
    key(target, 'keydown', 'KeyW');
    controller.selectSource('keyboard');
    expect(controller.checkNeutral()).toBe('keysNotReleased');
    expect(controller.poll().frame.throttle).toBe(0);
  });
});

describe('dispose', () => {
  it('is idempotent and makes later events unable to mutate input', () => {
    const { target, controller } = setup();
    key(target, 'keydown', 'KeyW');
    controller.enqueue({ type: 'help' });
    controller.dispose();
    controller.dispose();
    key(target, 'keydown', 'KeyW');
    key(target, 'keydown', 'Space');
    target.dispatchEvent(new Event('blur'));
    controller.enqueue({ type: 'pause' });
    controller.selectSource('keyboard');
    controller.setCalibration(wheel);
    controller.clear();
    expect(controller.poll()).toEqual({
      frame: { source: 'keyboard', throttle: 0, brake: 0, steering: 0 },
      actions: [], issue: 'controllerUnavailable' });
    expect(controller.checkNeutral()).toBe('controllerUnavailable');
  });
});
