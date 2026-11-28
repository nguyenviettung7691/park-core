import { describe, expect, it } from 'vitest';
import type { BodyPose, StageId, Vec3Data, VehicleProfile } from '../contracts';
import type { ColliderBox } from '../runtime-types';
import { activeActorCount, createActorWorld, stepActors, type LearnerState } from '../world/actors';
import { scheduleForMode } from '../world/actor-schedules';
import { TYRE_HALF_WIDTH_M } from '../vehicle/tyre-edges';
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
  wheelStops,
  wheelStopTouchingPose,
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
  const startRear = rearAxleCenter(start, profile);
  // End at the earlier (nearer the spawn) of the target centre and any wheel-stop touching pose.
  const ends = [poseAtRegion(scenario.target.region, profile),
    ...wheelStops(scenario).map((stop) => wheelStopTouchingPose(scenario, stop, profile).pose)];
  const distanceFromStart = (pose: BodyPose) => {
    const rear = rearAxleCenter(pose, profile);
    return Math.hypot(rear[0] - startRear[0], rear[2] - startRear[2]);
  };
  const target = ends.reduce((best, pose) =>
    distanceFromStart(pose) < distanceFromStart(best) ? pose : best);
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

/**
 * Plan-view tyre patches FL, FR, RL, RR: wheel centre +/- the tyre's horizontal extent at the stop's
 * top edge along roll (where the tyre first meets that edge), +/- TYRE_HALF_WIDTH_M along the axle.
 */
function tyrePatches(pose: BodyPose, profile: VehicleProfile, edgeHeightM: number):
  readonly (readonly Vec3Data[])[] {
  const f = profile.frontWeightFraction, L = profile.wheelbaseM;
  const reach = Math.sqrt(2 * profile.tireRadiusM * edgeHeightM - edgeHeightM ** 2) - 1e-6;
  const w = TYRE_HALF_WIDTH_M;
  const corners = (x: number, z: number): Vec3Data[] => ([
    [x - w, 0, z - reach], [x + w, 0, z - reach], [x + w, 0, z + reach], [x - w, 0, z + reach],
  ] as const).map((local) => {
    const r = rotate(pose.rotation, local);
    return [pose.positionM[0] + r[0], 0, pose.positionM[2] + r[2]] as Vec3Data;
  });
  const x = profile.trackM / 2;
  return [corners(-x, -(1 - f) * L), corners(x, -(1 - f) * L),
    corners(-x, f * L), corners(x, f * L)];
}

describe('geometric lesson route witnesses', () => {
  it('keeps every stage/profile trace collision-free and within Ackermann curvature', async () => {
    const { scenarios } = requireScenarioModule();
    const collidersForScenario = await requireScenarioColliderComposer();

    for (const stageId of stages) {
      const scenario = scenarios[stageId];
      const all = await collidersForScenario(scenario);
      // Wheel stops sit below both ground clearances: the body envelope passes over them, the
      // tyres must not.
      const colliders = all.filter(({ kind }) => kind !== 'ground' && kind !== 'wheel-stop');
      const stops: readonly ColliderBox[] = all.filter(({ kind }) => kind === 'wheel-stop');
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
          for (const stop of stops) {
            const patches = tyrePatches(pose, profile, stop.centerM[1] + stop.halfExtentsM[1]);
            expect(
              patches.some((patch) => polygonsOverlap(patch, colliderFootprint(stop))),
              `stage ${stageId}/${profile.id} sample ${index} puts a tyre across ${stop.id}`,
            ).toBe(false);
          }
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

describe('timed actor witnesses', () => {
  const DT = 1 / 120;
  const SPEED_MPS = 1;

  for (const stageId of stages) {
    for (const profile of Object.values(profiles)) {
      it(`stage ${stageId} vehicle ${profile.id}: waiting route completes without actor contact`,
        () => {
          const scenario = requireScenarioModule().scenarios[stageId];
          const { schedule, rules } = scheduleForMode({ kind: 'lesson', scenario });
          let world = createActorWorld(schedule, rules);
          const route = routePoses(scenario, profile);
          const triggers = scenario.actors.map((entry) => entry.trigger);
          const wantsMotion = triggers.includes('moving-off') || triggers.includes('first-stop');
          const gear = triggers.includes('reverse-selected') ? 'R'
            : triggers.includes('moving-off') ? 'D' : 'P';
          const indicator = triggers.includes('indicator-right') ? 'right' : 'off';
          let contacts = 0;
          let steps = 0;
          const advance = (pose: BodyPose, signedSpeedMps: number, nextGear: 'R' | 'D' | 'P') => {
            const learner: LearnerState = {
              footprint: vehicleFootprint(pose, profile),
              headingRad: 2 * Math.atan2(pose.rotation[1], pose.rotation[3]),
              signedSpeedMps,
              gear: nextGear,
              parkingBrake: nextGear === 'P',
              indicator,
            };
            const result = stepActors(world, learner, DT);
            world = result.state;
            steps += 1;
            if (result.contactId !== null) contacts += 1;
          };

          // Triggers: motion for 0.5 s then a stop (first-stop lands at t = 1 s), then hold.
          for (let i = 0; i < 0.5 / DT; i += 1) {
            advance(route[0], wantsMotion ? SPEED_MPS : 0, gear);
          }
          // Triggers land by t = 1 s and entries appear after their delay, so the hold cannot end earlier.
          const minHoldS = 1.1 + Math.max(...scenario.actors.map((entry) => entry.delayS));
          while ((activeActorCount(world) > 0 || steps * DT < minHoldS)
            && steps * DT <= 15 + DT) {
            advance(route[0], 0, gear);
          }
          expect(activeActorCount(world), 'hold ends with no active actor').toBe(0);
          expect(steps * DT, 'hold duration').toBeLessThanOrEqual(15);

          const forwardSign = (index: number) => {
            const a = route[Math.max(index - 1, 0)].positionM;
            const b = route[Math.min(index + 1, route.length - 1)].positionM;
            const f = rotate(route[index].rotation, [0, 0, -1]);
            return Math.sign((b[0] - a[0]) * f[0] + (b[2] - a[2]) * f[2]) || 1;
          };
          let carry = 0;
          route.forEach((pose, index) => {
            if (index === 0) return;
            const sign = forwardSign(index);
            const stepsPerPose = routeSpacingM / (SPEED_MPS * DT) + carry;
            const count = Math.max(1, Math.round(stepsPerPose));
            carry = stepsPerPose - count;
            for (let i = 0; i < count; i += 1) {
              advance(pose, sign * SPEED_MPS, sign > 0 ? 'D' : 'R');
            }
          });
          expect(contacts).toBe(0);
        });
    }
  }
});
