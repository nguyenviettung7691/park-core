import { Group, Object3D } from 'three';
import { expect, it, vi } from 'vitest';
import type { BodyPose, VehicleTelemetry } from '../contracts';
import type { PhysicsSnapshot, SceneAssets } from '../runtime-types';
import {
  INDICATOR_FLASH_HZ, PARKING_LEVER_RAD, PEDAL_TRAVEL_RAD, SPEEDOMETER_MAX_KMH, createAssetScene,
  exteriorLampState, indicatorLit, speedometerAngleRad,
} from './asset-scene';

const identity: BodyPose = {
  positionM: [0, 0, 0],
  rotation: [0, 0, 0, 1],
};

function snapshot(pose: BodyPose, wheelPoses: readonly [BodyPose, BodyPose, BodyPose, BodyPose]): PhysicsSnapshot {
  const telemetry: VehicleTelemetry = {
    simulationTimeS: 0,
    vehicleId: 'sedan',
    pose,
    headingRad: 0,
    signedSpeedMps: 0,
    totalSpeedMps: 0,
    angularSpeedRadps: 0,
    steeringWheelRad: 0,
    frontWheelAnglesRad: [0, 0],
    gear: 'P',
    parkingBrake: false,
    indicator: 'off',
    brake: 0,
  };
  return { telemetry, wheelPoses };
}

it('composes loaded groups, converts wheel world poses into vehicle space, and releases assets once', () => {
  const environment = new Group();
  const vehicle = new Group();
  const wheels = [new Object3D(), new Object3D(), new Object3D(), new Object3D()] as const;
  vehicle.add(...wheels);
  const disposeAssets = vi.fn();
  const assets: SceneAssets = {
    environment,
    vehicle,
    wheelNodes: wheels,
    anchors: {
      driverEyeLocalM: [0, 1, 0],
      mirrors: {
        rear: { positionM: [0, 1, 0], rotation: [0, 0, 0, 1] },
        left: { positionM: [0, 1, 0], rotation: [0, 0, 0, 1] },
        right: { positionM: [0, 1, 0], rotation: [0, 0, 0, 1] },
      },
    },
    dispose: disposeAssets,
  };
  const sceneContent = createAssetScene(assets);
  const vehiclePose: BodyPose = {
    positionM: [5, 0, 2],
    rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
  };
  const wheelPose: BodyPose = {
    positionM: [6, 0, 2],
    rotation: [0, 0, 0, 1],
  };
  const previous = snapshot(identity, [identity, identity, identity, identity]);
  const current = snapshot(vehiclePose, [wheelPose, identity, identity, identity]);

  expect(sceneContent.scene.children).toEqual([environment, vehicle]);
  sceneContent.apply({ previous, current, alpha: 1 });
  expect(vehicle.position.toArray()).toEqual([5, 0, 2]);
  expect(wheels[0].position.x).toBeCloseTo(0);
  expect(wheels[0].position.z).toBeCloseTo(1);
  expect(wheels[0].quaternion.y).toBeCloseTo(-Math.SQRT1_2);
  expect(wheels[0].quaternion.w).toBeCloseTo(Math.SQRT1_2);

  sceneContent.dispose();
  sceneContent.dispose();
  expect(disposeAssets).toHaveBeenCalledOnce();
  expect(sceneContent.scene.children).toHaveLength(0);
});

function cockpitAssets() {
  const vehicle = new Group();
  const names = ['SteeringWheelPivot', 'SpeedometerNeedle', 'IndicatorLeftLamp',
    'IndicatorRightLamp', 'ParkingBrakeLamp', 'BrakePedal', 'AcceleratorPedal', 'ParkingBrakeLever'];
  for (const name of names) {
    const node = new Object3D();
    node.name = name;
    vehicle.add(node);
  }
  const wheels = [new Object3D(), new Object3D(), new Object3D(), new Object3D()] as const;
  vehicle.add(...wheels);
  const pose = { positionM: [0, 1, 0], rotation: [0, 0, 0, 1] } as const;
  const assets: SceneAssets = { environment: new Group(), vehicle, wheelNodes: wheels,
    anchors: { driverEyeLocalM: [0, 1, 0], mirrors: { rear: pose, left: pose, right: pose } },
    dispose: () => {} };
  return { assets, node: (name: string) => vehicle.getObjectByName(name)! };
}

function telemetryFrame(overrides: Partial<VehicleTelemetry>): PhysicsSnapshot {
  const base = snapshot(identity, [identity, identity, identity, identity]);
  return { ...base, telemetry: { ...base.telemetry, ...overrides } };
}

it('drives the named cockpit controls from interpolated telemetry', () => {
  const { assets, node } = cockpitAssets();
  const sceneContent = createAssetScene(assets);
  for (const lamp of ['IndicatorLeftLamp', 'IndicatorRightLamp', 'ParkingBrakeLamp']) {
    expect(node(lamp).visible, lamp).toBe(false);
  }
  const previous = telemetryFrame({ steeringWheelRad: 0, signedSpeedMps: 0, brake: 0, throttle: 0 });
  const current = telemetryFrame({ steeringWheelRad: 2, signedSpeedMps: -10 / 3.6 * 2,
    brake: 1, throttle: 0.5, parkingBrake: true, indicator: 'left', simulationTimeS: 0.1 });
  sceneContent.apply({ previous, current, alpha: 0.5 });
  expect(node('SteeringWheelPivot').rotation.z).toBeCloseTo(1);
  // 10 km/h reverse at alpha 0.5 of 20 km/h: |speed| drives the dial.
  expect(node('SpeedometerNeedle').rotation.z).toBeCloseTo(speedometerAngleRad(10 / 3.6));
  expect(speedometerAngleRad(0)).toBeCloseTo(2 * Math.PI / 3);
  expect(speedometerAngleRad(SPEEDOMETER_MAX_KMH / 3.6 * 2)).toBeCloseTo(-2 * Math.PI / 3);
  expect(node('BrakePedal').rotation.x).toBeCloseTo(PEDAL_TRAVEL_RAD * 0.5);
  expect(node('AcceleratorPedal').rotation.x).toBeCloseTo(PEDAL_TRAVEL_RAD * 0.25);
  expect(node('ParkingBrakeLamp').visible).toBe(true);
  expect(node('ParkingBrakeLever').rotation.x).toBeCloseTo(PARKING_LEVER_RAD);
  expect(node('IndicatorLeftLamp').visible).toBe(true);
  expect(node('IndicatorRightLamp').visible).toBe(false);
});

it('flashes indicator lamps at 1.5 Hz on simulation time and tolerates missing throttle', () => {
  const { assets, node } = cockpitAssets();
  const sceneContent = createAssetScene(assets);
  const states = [0, 0.2, 0.34, 0.5, 0.67].map((simulationTimeS) => {
    const frame = telemetryFrame({ indicator: 'right', simulationTimeS });
    sceneContent.apply({ previous: frame, current: frame, alpha: 1 });
    return node('IndicatorRightLamp').visible;
  });
  expect(states).toEqual([true, true, false, false, true]);
  expect(INDICATOR_FLASH_HZ).toBe(1.5);
  const { throttle: _unused, ...withoutThrottle } = telemetryFrame({}).telemetry;
  const frame = { ...telemetryFrame({}), telemetry: withoutThrottle };
  sceneContent.apply({ previous: frame, current: frame, alpha: 1 });
  expect(node('AcceleratorPedal').rotation.x).toBe(0);
  expect(node('ParkingBrakeLever').rotation.x).toBe(0);
});

const lampNodes = ['BrakeLampsLit', 'ReverseLampsLit', 'TurnSignalLeftLit', 'TurnSignalRightLit'];

it('derives exterior lamp state from telemetry', () => {
  const at = (overrides: Partial<VehicleTelemetry>) => telemetryFrame(overrides).telemetry;
  expect(exteriorLampState(at({ brake: 0.05 })).brake).toBe(false);
  expect(exteriorLampState(at({ brake: 0.06 })).brake).toBe(true);
  expect(exteriorLampState(at({ gear: 'R' })).reverse).toBe(true);
  for (const gear of ['P', 'N', 'D'] as const) {
    expect(exteriorLampState(at({ gear })).reverse).toBe(false);
  }
  for (const simulationTimeS of [0.1, 0.4]) {
    const t = at({ indicator: 'left', simulationTimeS });
    expect(exteriorLampState(t).left).toBe(indicatorLit(t, 'left'));
    expect(exteriorLampState(t).right).toBe(false);
  }
  expect(exteriorLampState(at({ indicator: 'right', simulationTimeS: 0.1 })).right).toBe(true);
});

it('toggles the exterior lit lamp nodes from current telemetry and tolerates their absence', () => {
  const { assets, node } = cockpitAssets();
  for (const name of lampNodes) {
    const lamp = new Object3D();
    lamp.name = name;
    assets.vehicle.add(lamp);
  }
  const sceneContent = createAssetScene(assets);
  for (const name of lampNodes) expect(node(name).visible, name).toBe(false);
  const frame = telemetryFrame({ brake: 0.5, gear: 'R', indicator: 'left', simulationTimeS: 0.1 });
  sceneContent.apply({ previous: telemetryFrame({}), current: frame, alpha: 0.5 });
  expect(node('BrakeLampsLit').visible).toBe(true);
  expect(node('ReverseLampsLit').visible).toBe(true);
  expect(node('TurnSignalLeftLit').visible).toBe(true);
  expect(node('TurnSignalRightLit').visible).toBe(false);
  const idle = telemetryFrame({});
  sceneContent.apply({ previous: idle, current: idle, alpha: 1 });
  for (const name of lampNodes) expect(node(name).visible, name).toBe(false);
  const bare = cockpitAssets();
  const bareScene = createAssetScene(bare.assets);
  expect(() => bareScene.apply({ previous: frame, current: frame, alpha: 1 })).not.toThrow();
});
