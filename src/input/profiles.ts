import type { ControllerCalibration } from '../contracts';

export type ControllerProfileId =
  | 'xbox-series-x'
  | '8bitdo-ultimate-2c'
  | 'logitech-g29'
  | 'logitech-g920'
  | 'logitech-g923'
  | 'thrustmaster-t300-rs-gt';

type CalibrationTemplate = Omit<ControllerCalibration, 'deviceId'>;
type DeviceIdentity = Pick<Gamepad, 'id' | 'mapping'>;

export interface ControllerProfile {
  readonly id: ControllerProfileId;
  readonly name: string;
  readonly kind: 'gamepad' | 'wheel';
  readonly calibration: CalibrationTemplate;
  matches(device: DeviceIdentity): boolean;
}

function hasTokens(id: string, ...tokens: string[]): boolean {
  const words = id.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? [];
  return tokens.every((token) => {
    const phrase = token.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? [];
    return phrase.length > 0 && words.some((_, index) =>
      phrase.every((word, offset) => words[index + offset] === word));
  });
}

function gamepadCalibration(): CalibrationTemplate {
  return {
    version: 1,
    steeringAxis: 0,
    steeringLeft: -1,
    steeringCenter: 0,
    steeringRight: 1,
    throttle: { kind: 'button', index: 7, released: 0, pressed: 1 },
    brake: { kind: 'button', index: 6, released: 0, pressed: 1 },
    reverseButton: 4,
    driveButton: 5,
  };
}

function wheelCalibration(): CalibrationTemplate {
  return {
    version: 1,
    steeringAxis: 0,
    steeringLeft: -1,
    steeringCenter: 0,
    steeringRight: 1,
    throttle: { kind: 'axis', index: 1, released: -1, pressed: 1 },
    brake: { kind: 'axis', index: 2, released: -1, pressed: 1 },
    reverseButton: 4,
    driveButton: 5,
  };
}

function namedGamepad(
  id: ControllerProfileId,
  name: string,
  tokens: readonly string[],
): ControllerProfile {
  return {
    id,
    name,
    kind: 'gamepad',
    calibration: gamepadCalibration(),
    matches(device) {
      return device.mapping === 'standard' && hasTokens(device.id, ...tokens);
    },
  };
}

function namedWheel(
  id: ControllerProfileId,
  name: string,
  tokens: readonly string[],
): ControllerProfile {
  return {
    id,
    name,
    kind: 'wheel',
    calibration: wheelCalibration(),
    matches(device) {
      return hasTokens(device.id, ...tokens);
    },
  };
}

export const controllerProfiles: readonly ControllerProfile[] = Object.freeze([
  namedGamepad('xbox-series-x', 'Xbox Wireless Controller (Series X)', ['xbox', 'series x']),
  namedGamepad('8bitdo-ultimate-2c', '8BitDo Ultimate 2C Wireless', ['8bitdo', 'ultimate 2c']),
  namedWheel('logitech-g29', 'Logitech G29', ['logitech', 'g29']),
  namedWheel('logitech-g920', 'Logitech G920', ['logitech', 'g920']),
  namedWheel('logitech-g923', 'Logitech G923', ['logitech', 'g923']),
  namedWheel('thrustmaster-t300-rs-gt', 'Thrustmaster T300 RS GT',
    ['thrustmaster', 't300', 'rs', 'gt']),
]);

export function findControllerProfile(device: DeviceIdentity): ControllerProfile | null {
  return controllerProfiles.find((profile) => profile.matches(device)) ?? null;
}

export function calibrationForProfile(
  id: ControllerProfileId, deviceId: string,
): ControllerCalibration {
  const profile = controllerProfiles.find((entry) => entry.id === id);
  if (!profile) throw new RangeError(`Unknown controller profile: ${id}`);
  return {
    ...profile.calibration,
    deviceId,
    throttle: { ...profile.calibration.throttle },
    brake: { ...profile.calibration.brake },
  };
}
