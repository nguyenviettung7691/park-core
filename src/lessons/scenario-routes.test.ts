import { describe, expect, it } from 'vitest';
import type { BodyPose, StageId, Vec3Data, VehicleProfile } from '../contracts';
import { profiles } from '../vehicle/profiles';
import { rearAxleCenter, rotate, vehicleFootprint } from '../vehicle/geometry';
import {
  colliderFootprint,
  footprintInsideRegion,
  pointInRegion,
  poseAtRegion,
  poseFromSpawn,
  polygonsOverlap,
  requireScenarioColliderComposer,
  requireScenarioModule,
} from './scenario-test-utils';

const routeRadiusM = 5;
const routeSpacingM = 0.04;
const stages: readonly StageId[] = [1, 2, 3, 4, 5];

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function poseFromRearAxle(
  rear: Vec3Data,
  yawRad: number,
  profile: VehicleProfile,
): BodyPose {
  const rotation = [0, Math.sin(yawRad / 2), 0, Math.cos(yawRad / 2)] as const;
  const forward = rotate(rotation, [0, 0, -1]);
  const axleOffset = profile.frontWeightFraction * profile.wheelbaseM;
  return {
    positionM: [
      rear[0] + forward[0] * axleOffset,
      profile.centerOfMassHeightM,
      rear[2] + forward[2] * axleOffset,
    ],
    rotation,
  };
}

function routePoses(scenario: ReturnType<typeof requireScenarioModule>['scenarios'][StageId],
  profile: VehicleProfile): readonly BodyPose[] {
  const start = poseFromSpawn(scenario.spawnByVehicle[profile.id]);
  const target = poseAtRegion(scenario.target.region, profile);
  const startRear = rearAxleCenter(start, profile);
  const targetRear = rearAxleCenter(target, profile);
  const lateralM = targetRear[0] - startRear[0];

  if (Math.abs(lateralM) < 0.01) {
    const distance = Math.hypot(targetRear[0] - startRear[0], targetRear[2] - startRear[2]);
    const samples = Math.ceil(distance / routeSpacingM);
    return Array.from({ length: samples + 1 }, (_, index) => {
      const fraction = index / samples;
      return poseFromRearAxle([
        startRear[0] + (targetRear[0] - startRear[0]) * fraction,
        startRear[1] + (targetRear[1] - startRear[1]) * fraction,
        startRear[2] + (targetRear[2] - startRear[2]) * fraction,
      ], scenario.target.region.headingRad, profile);
    });
  }

  const turnRad = Math.acos(1 - Math.abs(lateralM) / (2 * routeRadiusM));
  const arcLengthM = routeRadiusM * turnRad;
  const direction = Math.sign(lateralM);
  const rear = [...startRear] as [number, number, number];
  let yaw = scenario.spawnByVehicle[profile.id].yawRad;
  const poses: BodyPose[] = [start];

  for (const curvature of [direction / routeRadiusM, -direction / routeRadiusM]) {
    const count = Math.ceil(arcLengthM / routeSpacingM);
    for (let index = 0; index < count; index += 1) {
      const oldYaw = yaw;
      const deltaYaw = curvature * Math.min(routeSpacingM, arcLengthM - index * routeSpacingM);
      yaw += deltaYaw;
      rear[0] += (Math.cos(oldYaw) - Math.cos(yaw)) / curvature;
      rear[2] += (Math.sin(yaw) - Math.sin(oldYaw)) / curvature;
      poses.push(poseFromRearAxle(rear, yaw, profile));
    }
  }
  return poses;
}

describe('geometric lesson route witnesses', () => {
  it('keeps every stage/profile trace collision-free and within Ackermann curvature', async () => {
    const { scenarios } = requireScenarioModule();
    const collidersForScenario = await requireScenarioColliderComposer();

    for (const stageId of stages) {
      const scenario = scenarios[stageId];
      const colliders = (await collidersForScenario(scenario))
        .filter(({ kind }) => kind !== 'ground');
      for (const profile of Object.values(profiles)) {
        const route = routePoses(scenario, profile);
        const setup = scenario.regions.setup;
        const minimumRadiusM = profile.wheelbaseM
          / Math.tan(profile.steeringWheelLockRad / profile.steeringRatio);
        let touchedSetup = false;

        for (let index = 0; index < route.length; index += 1) {
          const pose = route[index];
          const envelope = vehicleFootprint(pose, profile);
          expect(
            footprintInsideRegion(envelope, scenario.drivingBounds),
            `stage ${stageId}/${profile.id} sample ${index} at ${pose.positionM.join(',')} yaw=${2 * Math.atan2(pose.rotation[1], pose.rotation[3])} exceeds driving bounds`,
          ).toBe(true);
          expect(
            colliders.some((box) => polygonsOverlap(envelope, colliderFootprint(box))),
            `stage ${stageId}/${profile.id} sample ${index} intersects a collider`,
          ).toBe(false);
          if (pointInRegion(pose.positionM, setup)) touchedSetup = true;

          if (index === 0) continue;
          const previous = route[index - 1];
          const previousRear = rearAxleCenter(previous, profile);
          const currentRear = rearAxleCenter(pose, profile);
          const travelM = Math.hypot(
            currentRear[0] - previousRear[0],
            currentRear[2] - previousRear[2],
          );
          const headingChangeRad = Math.abs(wrapAngle(
            2 * Math.atan2(pose.rotation[1], pose.rotation[3])
            - 2 * Math.atan2(previous.rotation[1], previous.rotation[3]),
          ));
          expect(travelM).toBeLessThanOrEqual(0.1);
          expect(headingChangeRad).toBeLessThanOrEqual(Math.PI / 180 + 1e-8);
          if (headingChangeRad > 1e-8) {
            expect(travelM / headingChangeRad + 0.01).toBeGreaterThanOrEqual(minimumRadiusM);
          }
        }

        expect(touchedSetup).toBe(true);
        expect(footprintInsideRegion(
          vehicleFootprint(route[route.length - 1], profile),
          scenario.target.region,
          0.05,
        )).toBe(true);
      }
    }
  });
});
