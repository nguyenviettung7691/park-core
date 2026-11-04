import { Group, Object3D } from 'three';
import { expect, it, vi } from 'vitest';
import type { BodyPose, VehicleTelemetry } from '../contracts';
import type { PhysicsSnapshot, SceneAssets } from '../runtime-types';
import { createAssetScene } from './asset-scene';

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
