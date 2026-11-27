import { describe, expect, it } from 'vitest';
import type { LessonActorEntry, StageId, VehicleProfile } from '../contracts';
import { scenarios } from '../lessons/scenarios';
import { profiles } from '../vehicle/profiles';
import { rotate, vehicleFootprint } from '../vehicle/geometry';
import { ambientSchedules, scheduleForMode } from './actor-schedules';
import {
  activeActorCount,
  actorBoxes,
  actorPoses,
  createActorWorld,
  stepActors,
  type ActorWorldState,
  type LearnerState,
} from './actors';
import { collidersForEnvironment, collidersForScenario, prototypeSpawn } from './colliders';
import { orientedRectangle, polygonsOverlap } from './footprint';

const DT = 1 / 120;
const stages: readonly StageId[] = [1, 2, 3, 4, 5];
const vehicles = Object.values(profiles);

function spawnPose(profile: VehicleProfile, stageId: StageId) {
  const spawn = scenarios[stageId].spawnByVehicle[profile.id];
  return {
    positionM: spawn.positionM,
    rotation: [0, Math.sin(spawn.yawRad / 2), 0, Math.cos(spawn.yawRad / 2)] as const,
    yawRad: spawn.yawRad,
  };
}

function parked(profile: VehicleProfile, stageId: StageId): LearnerState {
  const pose = spawnPose(profile, stageId);
  return {
    footprint: vehicleFootprint(pose, profile), headingRad: pose.yawRad, signedSpeedMps: 0,
    gear: 'P', parkingBrake: true, indicator: 'off',
  };
}

/** Steps with a fresh learner object each time (the module keeps the previous one). */
function simulate(
  state: ActorWorldState,
  profile: VehicleProfile,
  stageId: StageId,
  seconds: number,
  visit: (state: ActorWorldState, contactId: string | null) => void,
): ActorWorldState {
  let current = state;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    const result = stepActors(current, { ...parked(profile, stageId) }, DT);
    current = result.state;
    visit(current, result.contactId);
  }
  return current;
}

function lessonWorld(stageId: StageId) {
  const { schedule, rules } = scheduleForMode({ kind: 'lesson', scenario: scenarios[stageId] });
  return createActorWorld(schedule, rules, { forceTriggersAtS: 0 });
}

const boxPolygon = (box: { centerM: readonly [number, number, number];
  halfExtentsM: readonly [number, number, number]; yawRad: number }) =>
  orientedRectangle(box.centerM, box.halfExtentsM[0], box.halfExtentsM[2], box.yawRad);

describe('actor schedules', () => {
  it('ids are unique and prefixed by kind', () => {
    const all = [
      ...stages.flatMap((stageId) => scenarios[stageId].actors.map(({ actor }) => actor)),
      ...Object.values(ambientSchedules).flatMap((entries) => entries.map(({ actor }) => actor)),
    ];
    const ids = all.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const actor of all) {
      expect(actor.id.startsWith(actor.kind === 'car' ? 'car-' : 'ped-')).toBe(true);
    }
  });

  it('every lesson stage has 1-2 entries', () => {
    for (const stageId of stages) {
      const count = scenarios[stageId].actors.length;
      expect(count, `stage ${stageId}`).toBeGreaterThanOrEqual(1);
      expect(count, `stage ${stageId}`).toBeLessThanOrEqual(2);
    }
  });

  it('uses coach rules for stages 1-2 and realistic otherwise', () => {
    expect(scheduleForMode({ kind: 'lesson', scenario: scenarios[2] }).rules).toBe('coach');
    expect(scheduleForMode({ kind: 'lesson', scenario: scenarios[3] }).rules).toBe('realistic');
    expect(scheduleForMode({ kind: 'sandbox', environmentId: 'garage' }).rules)
      .toBe('realistic');
  });

  for (const profile of vehicles) {
    describe(`vehicle ${profile.id}`, () => {
      it('no more than 2 lesson actors active at once', () => {
        for (const stageId of stages) {
          let peak = 0;
          simulate(lessonWorld(stageId), profile, stageId, 20, (state) => {
            peak = Math.max(peak, activeActorCount(state));
          });
          expect(peak, `stage ${stageId}`).toBeLessThanOrEqual(2);
          expect(peak, `stage ${stageId}`).toBeGreaterThanOrEqual(1);
        }
      });

      it('actors never overlap each other', () => {
        for (const stageId of stages) {
          simulate(lessonWorld(stageId), profile, stageId, 20, (state) => {
            const boxes = actorBoxes(state);
            for (let a = 0; a < boxes.length; a += 1) {
              for (let b = a + 1; b < boxes.length; b += 1) {
                expect(polygonsOverlap(boxPolygon(boxes[a]), boxPolygon(boxes[b])),
                  `stage ${stageId} ${boxes[a].id}/${boxes[b].id}`).toBe(false);
              }
            }
          });
        }
      });

      it('unobstructed lesson actors finish within 15 s of their trigger', () => {
        for (const stageId of stages) {
          let lastActiveS = 0;
          let contact: string | null = null;
          let timeS = 0;
          simulate(lessonWorld(stageId), profile, stageId, 20, (state, contactId) => {
            timeS += DT;
            if (activeActorCount(state) > 0) lastActiveS = timeS;
            contact ??= contactId;
          });
          expect(lastActiveS, `stage ${stageId}`).toBeLessThanOrEqual(15);
          expect(contact, `stage ${stageId}`).toBeNull();
        }
      });

      it('the actor is in its check region at the check moment', () => {
        for (const stageId of stages) {
          const scenario = scenarios[stageId];
          const pose = spawnPose(profile, stageId);
          const eyeLocal = profile.driverEyeLocalM;
          const f = profile.frontWeightFraction, L = profile.wheelbaseM;
          const rearLocalZ = f * L + profile.rearOverhangM;
          scenario.actors.forEach((entry: LessonActorEntry, index) => {
            const checkS = entry.delayS + 1;
            const world = simulate(lessonWorld(stageId), profile, stageId, checkS, () => {});
            const actorPose = actorPoses(world)[index];
            expect(actorPose.visible, `${entry.actor.id} visible`).toBe(true);
            // Learner frame: x right, z backward (vehicle forward is -z).
            const inverse = [0, -pose.rotation[1], 0, pose.rotation[3]] as const;
            const local = rotate(inverse, [
              actorPose.positionM[0] - pose.positionM[0], 0,
              actorPose.positionM[2] - pose.positionM[2],
            ]);
            const label = `stage ${stageId} ${entry.actor.id} local ${local[0].toFixed(2)},${local[2].toFixed(2)}`;
            if (entry.side === 'left') {
              expect(local[0], label).toBeLessThan(-1.0);
              expect(local[2], label).toBeGreaterThan(eyeLocal[2]);
            } else if (entry.side === 'right') {
              expect(local[0], label).toBeGreaterThan(1.0);
              expect(local[2], label).toBeGreaterThan(eyeLocal[2]);
            } else {
              expect(local[2], label).toBeGreaterThan(rearLocalZ);
              expect(local[2] - rearLocalZ, label).toBeLessThanOrEqual(15);
            }
          });
        }
      });
    });
  }

  it('paths start and end outside the driving bounds or behind static colliders', () => {
    for (const stageId of stages) {
      const scenario = scenarios[stageId];
      const bounds = orientedRectangle(scenario.drivingBounds.centerM,
        scenario.drivingBounds.halfWidthM, scenario.drivingBounds.halfLengthM,
        scenario.drivingBounds.headingRad);
      const statics = collidersForEnvironment(scenario.environmentId)
        .filter(({ kind }) => kind === 'obstacle');
      for (const { actor } of scenario.actors) {
        const [sx0, sz0] = actor.path[0];
        const [sx1, sz1] = actor.path[1];
        const start = orientedRectangle([sx0, 0, sz0], actor.halfExtentsM[0],
          actor.halfExtentsM[2], Math.atan2(0 - (sx1 - sx0), 0 - (sz1 - sz0)));
        // End box: place along the final segment.
        const [x0, z0] = actor.path[actor.path.length - 2];
        const [x1, z1] = actor.path[actor.path.length - 1];
        const yawRad = Math.atan2(0 - (x1 - x0), 0 - (z1 - z0));
        const end = orientedRectangle([x1, 0, z1], actor.halfExtentsM[0],
          actor.halfExtentsM[2], yawRad);
        for (const [label, polygon] of [['start', start], ['end', end]] as const) {
          const hidden = !polygonsOverlap(polygon, bounds)
            || statics.some((box) => polygonsOverlap(polygon,
              orientedRectangle(box.centerM, box.halfExtentsM[0], box.halfExtentsM[2], box.yawRad)));
          expect(hidden, `${actor.id} ${label}`).toBe(true);
        }
      }
    }
  });

  it('actors never overlap static colliders or parked lesson cars', () => {
    for (const stageId of stages) {
      // Kerbs are 0.11 m stones that vehicles run alongside; ground is not an obstacle.
      const statics = collidersForScenario(scenarios[stageId])
        .filter(({ kind }) => kind !== 'ground' && kind !== 'curb' && kind !== 'wheel-stop');
      simulate(lessonWorld(stageId), vehicles[0], stageId, 20, (state) => {
        for (const box of actorBoxes(state)) {
          for (const collider of statics) {
            expect(polygonsOverlap(boxPolygon(box),
              orientedRectangle(collider.centerM, collider.halfExtentsM[0],
                collider.halfExtentsM[2], collider.yawRad)),
            `stage ${stageId} ${box.id} vs ${collider.id}`).toBe(false);
          }
        }
      });
    }
  });

  describe('ambient traffic', () => {
    const sandboxWorld = (environmentId: 'garage' | 'roadside') => {
      const { schedule, rules } = scheduleForMode({ kind: 'sandbox', environmentId });
      return createActorWorld(schedule, rules);
    };
    const prototypeLearner = (): LearnerState => ({
      footprint: vehicleFootprint({
        positionM: prototypeSpawn(profiles.sedan).positionM,
        rotation: [0, 0, 0, 1],
      }, profiles.sedan),
      headingRad: 0, signedSpeedMps: 0, gear: 'P', parkingBrake: true, indicator: 'off',
    });

    it('at most 3 active at once over 240 s', () => {
      for (const environmentId of ['garage', 'roadside'] as const) {
        let state = sandboxWorld(environmentId);
        let peak = 0;
        for (let i = 0; i < 240 / DT; i += 1) {
          state = stepActors(state, prototypeLearner(), DT).state;
          peak = Math.max(peak, activeActorCount(state));
        }
        expect(peak, environmentId).toBeLessThanOrEqual(3);
        expect(peak, environmentId).toBeGreaterThanOrEqual(1);
      }
    });

    it('ambient schedule is periodic', () => {
      const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
      for (const environmentId of ['garage', 'roadside'] as const) {
        const periods = ambientSchedules[environmentId].map(({ periodS }) => periodS);
        const lcm = periods.reduce((a, b) => (a * b) / gcd(a, b));
        const sampleAtS = 47;
        const samples: ReturnType<typeof actorPoses>[] = [];
        let state = sandboxWorld(environmentId);
        const first = Math.round(sampleAtS / DT);
        const second = Math.round((sampleAtS + lcm) / DT);
        for (let i = 1; i <= second; i += 1) {
          state = stepActors(state, prototypeLearner(), DT).state;
          if (i === first || i === second) samples.push(actorPoses(state));
        }
        expect(samples[1].length).toBe(samples[0].length);
        samples[0].forEach((pose, index) => {
          const other = samples[1][index];
          expect(other.visible, pose.id).toBe(pose.visible);
          other.positionM.forEach((value, axis) =>
            expect(value, `${pose.id} axis ${axis}`).toBeCloseTo(pose.positionM[axis], 3));
        });
      }
    });
  });
});
