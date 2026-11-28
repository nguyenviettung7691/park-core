import { describe, expect, it } from 'vitest';
import type { LessonActorEntry, StageId, VehicleProfile } from '../contracts';
import { scenarios } from '../lessons/scenarios';
import { profiles } from '../vehicle/profiles';
import { rotate, vehicleFootprint } from '../vehicle/geometry';
import {
  ambientSchedules, car, pedestrian, ROADSIDE_CAR_MPS, scheduleForMode, turnBackDetour,
} from './actor-schedules';
import {
  activeActorCount,
  actorBoxes,
  actorPoses,
  createActorWorld,
  stepActors,
  BLOCKED_WAIT_S,
  HELD_BY_LEARNER_MAX_S,
  MAX_AMBIENT_ACTIVE,
  sensorBoxes,
  type ActorWorldState,
  type LearnerState,
} from './actors';
import { collidersForEnvironment, collidersForScenario, prototypeSpawn } from './colliders';
import { orientedRectangle, polygonsOverlap } from './footprint';

const DT = 1 / 120;
/** Kerb checks use the wheel footprint of a car, not its body box (bodies overhang a kerb). */
const CAR_WHEEL_HALF_WIDTH_M = 0.78;
const CAR_WHEEL_HALF_LENGTH_M = 1.7;
const DETOUR_MIN_TRANSITION_M = 2;
const DETOUR_MAX_YAW_RAD = Math.PI / 9;
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

  type Collider = ReturnType<typeof collidersForEnvironment>[number];
  const colliderPolygon = (collider: Collider) =>
    orientedRectangle(collider.centerM, collider.halfExtentsM[0], collider.halfExtentsM[2],
      collider.yawRad);
  /** True when the actor's body hits an obstacle or (cars: wheels only) a kerb. */
  const hitsStatic = (
    colliders: readonly Collider[],
    kind: 'pedestrian' | 'car',
    centerM: readonly [number, number, number],
    halfExtentsM: readonly [number, number, number],
    yawRad: number,
  ): string | null => {
    const body = orientedRectangle(centerM, halfExtentsM[0], halfExtentsM[2], yawRad);
    const wheels = orientedRectangle(centerM, CAR_WHEEL_HALF_WIDTH_M, CAR_WHEEL_HALF_LENGTH_M,
      yawRad);
    for (const collider of colliders) {
      if (collider.kind === 'obstacle' && polygonsOverlap(body, colliderPolygon(collider))) {
        return collider.id;
      }
      if (kind === 'car' && collider.kind === 'curb'
        && polygonsOverlap(wheels, colliderPolygon(collider))) return collider.id;
    }
    return null;
  };

  it('actors never overlap static colliders or parked lesson cars (cars also avoid kerbs)', () => {
    for (const stageId of stages) {
      const colliders = collidersForScenario(scenarios[stageId]);
      for (const profile of vehicles) {
        simulate(lessonWorld(stageId), profile, stageId, 20, (state) => {
          const kinds = new Map(scenarios[stageId].actors.map(({ actor }) => [actor.id, actor.kind]));
          for (const box of actorBoxes(state)) {
            expect(hitsStatic(colliders, kinds.get(box.id)!, box.centerM, box.halfExtentsM,
              box.yawRad), `stage ${stageId}/${profile.id} ${box.id}`).toBeNull();
          }
        });
      }
    }
  });

  it('detour paths never overlap static colliders (cars also avoid kerbs)', () => {
    const yawOf = (from: readonly [number, number], to: readonly [number, number]) =>
      Math.atan2(0 - (to[0] - from[0]), 0 - (to[1] - from[1]));
    const entries = [
      ...stages.flatMap((stageId) => scenarios[stageId].actors.map((entry) => ({
        actor: entry.actor, environmentId: scenarios[stageId].environmentId,
        colliders: collidersForScenario(scenarios[stageId]),
      }))),
      ...(['garage', 'roadside'] as const).flatMap((environmentId) =>
        ambientSchedules[environmentId].map(({ actor }) => ({
          actor, environmentId, colliders: collidersForEnvironment(environmentId),
        }))),
    ];
    for (const { actor, colliders } of entries) {
      if (actor.id === 'car-stage5-behind') continue;
      const check = (centre: readonly [number, number], yawRad: number, label: string) => {
        expect(hitsStatic(colliders, actor.kind, [centre[0], 0, centre[1]], actor.halfExtentsM,
          yawRad), `${actor.id} ${label}`).toBeNull();
      };
      if (actor.detour.kind === 'turn-back') {
        // The reversed path covers the same ground as the scheduled path (the actor's box is symmetric).
        for (let i = 1; i < actor.path.length; i += 1) {
          const yaw = yawOf(actor.path[i - 1], actor.path[i]);
          for (let t = 0; t <= 1; t += 0.05) {
            check([actor.path[i - 1][0] + (actor.path[i][0] - actor.path[i - 1][0]) * t,
              actor.path[i - 1][1] + (actor.path[i][1] - actor.path[i - 1][1]) * t], yaw, 'turn-back');
          }
        }
        continue;
      }
      // Offset detour: blocked at any distance d, it moves to the left of travel (lateralM),
      // joining the shifted path after a max(2, |lateral| / tan 20 deg) transition (as in actors.ts).
      const [[x0, z0], [x1, z1]] = [actor.path[0], actor.path[actor.path.length - 1]];
      const length = Math.hypot(x1 - x0, z1 - z0);
      const yaw = yawOf([x0, z0], [x1, z1]);
      const dir = [(x1 - x0) / length, (z1 - z0) / length] as const;
      const left = [dir[1], -dir[0]] as const;
      const lateral = actor.detour.lateralM;
      const at = (d: number, side: number): [number, number] =>
        [x0 + dir[0] * d + left[0] * side, z0 + dir[1] * d + left[1] * side];
      for (let d = 0; d <= length; d += 0.5) {
        const transitionM = Math.max(DETOUR_MIN_TRANSITION_M,
          Math.abs(lateral) / Math.tan(DETOUR_MAX_YAW_RAD));
        const join = Math.min(d + transitionM, length);
        const from = at(d, 0);
        const to = at(join, lateral);
        const transitionYaw = yawOf(from, to);
        for (let t = 0; t <= 1; t += 0.05) {
          check([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t],
            transitionYaw, `offset transition from d=${d}`);
        }
        for (let e = join; e <= length; e += 0.5) check(at(e, lateral), yaw, `offset d=${e}`);
      }
    }
  });

  it('the stage 5 car yields behind the learner, waits, then leaves without contact', () => {
    for (const profile of vehicles) {
      let blockedS = 0;
      let lastActiveS = 0;
      let timeS = 0;
      simulate(lessonWorld(5), profile, 5, 20, (state, contactId) => {
        timeS += DT;
        expect(contactId).toBeNull();
        const box = actorBoxes(state).find(({ id }) => id === 'car-stage5-behind');
        if (!box) return;
        lastActiveS = timeS;
        if (state.cursors[0].speedMps === 0 && state.cursors[0].detour === null) blockedS += DT;
      });
      expect(blockedS, `${profile.id} yields`).toBeGreaterThanOrEqual(BLOCKED_WAIT_S - 0.1);
      expect(lastActiveS, `${profile.id} gone in time`).toBeLessThanOrEqual(15);
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

    it('ambient actors never overlap each other over a full cycle with a stationary learner', () => {
      const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
      for (const profile of vehicles) {
        for (const environmentId of ['garage', 'roadside'] as const) {
          const lcm = ambientSchedules[environmentId].map(({ periodS }) => periodS)
            .reduce((a, b) => (a * b) / gcd(a, b));
          const learner = (): LearnerState => ({
            footprint: vehicleFootprint({
              positionM: prototypeSpawn(profile).positionM, rotation: [0, 0, 0, 1],
            }, profile),
            headingRad: 0, signedSpeedMps: 0, gear: 'P', parkingBrake: true, indicator: 'off',
          });
          let state = sandboxWorld(environmentId);
          for (let i = 0; i < lcm / DT; i += 1) {
            state = stepActors(state, learner(), DT).state;
            const boxes = actorBoxes(state);
            for (let a = 0; a < boxes.length; a += 1) {
              for (let b = a + 1; b < boxes.length; b += 1) {
                if (polygonsOverlap(boxPolygon(boxes[a]), boxPolygon(boxes[b]))) {
                  throw new Error(`${profile.id}/${environmentId} ${boxes[a].id}/${boxes[b].id}`
                    + ` overlap at ${(i * DT).toFixed(2)} s`);
                }
              }
            }
          }
        }
      }
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

    const poseLearner = (profile: VehicleProfile, x: number, z: number, yawRad = 0): LearnerState => ({
      footprint: vehicleFootprint({
        positionM: [x, 0, z], rotation: [0, Math.sin(yawRad / 2), 0, Math.cos(yawRad / 2)],
      }, profile),
      headingRad: yawRad, signedSpeedMps: 0, gear: 'P', parkingBrake: true, indicator: 'off',
    });

    it('a learner parked at the right kerb never makes an ambient car vanish or alarm for long', () => {
      const CYCLE_S = 20;
      const NEAR_M = 6;
      for (const profile of vehicles) {
        for (const x of [2.9, 2.0]) {
          let state = sandboxWorld('roadside');
          const lastAt = new Map<string, readonly [number, number]>();
          const sensorS = new Map<string, number>();
          const seconds = 100;
          for (let i = 0; i < seconds / DT; i += 1) {
            const learner = poseLearner(profile, x, 0);
            const before = state;
            const result = stepActors(state, learner, DT);
            state = result.state;
            expect(result.contactId, `${profile.id} x=${x}`).toBeNull();
            state.cursors.forEach((cursor, index) => {
              const id = state.schedule.entries[index].actor.id;
              if (cursor.finished && !before.cursors[index].finished
                && before.cursors[index].activeSinceS !== null) {
                const at = lastAt.get(id)!;
                expect(Math.hypot(at[0] - x, at[1]),
                  `${profile.id} x=${x} ${id} vanished near learner at ${(i * DT).toFixed(2)} s`)
                  .toBeGreaterThan(NEAR_M);
              }
            });
            actorBoxes(state).forEach((box) => lastAt.set(box.id, [box.centerM[0], box.centerM[2]]));
            sensorBoxes(state, learner)
              .filter((box) => box.id.startsWith('car-')
                && Math.hypot(box.centerM[0] - x, box.centerM[2]) <= NEAR_M)
              .forEach((box) => sensorS.set(box.id, (sensorS.get(box.id) ?? 0) + DT));
          }
          for (const [id, total] of sensorS) {
            expect(total, `${profile.id} x=${x} ${id} near-sensor time`)
              .toBeLessThanOrEqual((seconds / CYCLE_S) * (BLOCKED_WAIT_S + 1));
          }
        }
      }
    }, 60_000);

    it('a blocking learner never lifts the visible ambient actors above the cap or into each other', () => {
      expect(MAX_AMBIENT_ACTIVE).toBe(3);
      
      const poses: readonly (readonly [number, number])[] = [
        [-2.2, -8], [-2.9, -8], [2.9, 0], [-2.2, 0],
      ];
      for (const profile of vehicles) {
        for (const environmentId of ['roadside', 'garage'] as const) {
          const spawn = prototypeSpawn(profile).positionM;
          const candidates = [...poses, [spawn[0], spawn[2]] as const];
          for (const [x, z] of candidates) {
            let state = sandboxWorld(environmentId);
            let peak = 0;
            for (let i = 0; i < 240 / DT; i += 1) {
              state = stepActors(state, poseLearner(profile, x, z), DT).state;
              peak = Math.max(peak, activeActorCount(state));
              if (i % 12 !== 0) continue;
              const boxes = actorBoxes(state);
              for (let a = 0; a < boxes.length; a += 1) {
                for (let b = a + 1; b < boxes.length; b += 1) {
                  expect(polygonsOverlap(boxPolygon(boxes[a]), boxPolygon(boxes[b])),
                    `${profile.id}/${environmentId}@(${x},${z}) ${boxes[a].id}/${boxes[b].id}`
                    + ` at ${(i * DT).toFixed(2)} s`).toBe(false);
                }
              }
            }
            expect(peak, `${profile.id}/${environmentId}@(${x},${z})`)
              .toBeLessThanOrEqual(MAX_AMBIENT_ACTIVE);
          }
        }
      }
    }, 60_000);

    it('a stationary learner anywhere on a pose grid causes no contact, overlap or fourth actor', () => {
      for (const profile of vehicles) {
        for (const environmentId of ['roadside', 'garage'] as const) {
          for (const x of [-6, -2.2, 0, 2.2, 6]) {
            for (const z of [-8, -1, 0, 8]) {
              let state = sandboxWorld(environmentId);
              for (let i = 0; i < 120 / DT; i += 1) {
                const result = stepActors(state, poseLearner(profile, x, z), DT);
                state = result.state;
                const label = `${profile.id}/${environmentId}@(${x},${z}) at ${(i * DT).toFixed(2)} s`;
                expect(result.contactId, label).toBeNull();
                expect(activeActorCount(state), label).toBeLessThanOrEqual(MAX_AMBIENT_ACTIVE);
                if (i % 12 !== 0) continue;
                const boxes = actorBoxes(state);
                for (let a = 0; a < boxes.length; a += 1) {
                  for (let b = a + 1; b < boxes.length; b += 1) {
                    expect(polygonsOverlap(boxPolygon(boxes[a]), boxPolygon(boxes[b])),
                      `${label} ${boxes[a].id}/${boxes[b].id}`).toBe(false);
                  }
                }
              }
            }
          }
        }
      }
    }, 300_000);

    it('a learner that parks across the garage aisle and then drives away never makes actors overlap', () => {
      const away = (profile: VehicleProfile) => poseLearner(profile, 60, 60);
      for (const profile of vehicles) {
        const here = poseLearner(profile, -1, -1);
        for (let leaveS = 100; leaveS <= 106 + 1e-9; leaveS += 0.25) {
          let state = sandboxWorld('garage');
          const label = `${profile.id} leave ${leaveS.toFixed(2)} s`;
          for (let i = 0; i < 124 / DT; i += 1) {
            const timeS = (i + 1) * DT;
            const learner = timeS >= 90 && timeS < leaveS ? here : away(profile);
            const result = stepActors(state, { ...learner }, DT);
            state = result.state;
            expect(result.contactId, `${label} at ${timeS.toFixed(2)} s`).toBeNull();
            const boxes = actorBoxes(state);
            for (let a = 0; a < boxes.length; a += 1) {
              for (let b = a + 1; b < boxes.length; b += 1) {
                if (polygonsOverlap(boxPolygon(boxes[a]), boxPolygon(boxes[b]))) {
                  throw new Error(`${label} ${boxes[a].id}/${boxes[b].id} overlap at ${timeS.toFixed(2)} s`);
                }
              }
            }
          }
          // Both garage actors last appeared at 95 s and 100 s (next at 125 s and 140 s); both are done by 124 s.
          expect(state.cursors.map((cursor) => cursor.finished), label).toEqual([true, true]);
        }
      }
    }, 120_000);

    /** Runs the garage or roadside world with a scripted learner; returns when car `carId` detours. */
    const holdRun = (environmentId: 'garage' | 'roadside', carId: string, seconds: number,
      learnerAt: (timeS: number) => LearnerState) => {
      const index = ambientSchedules[environmentId].findIndex(({ actor }) => actor.id === carId);
      let state = sandboxWorld(environmentId);
      let heldAtS: number | null = null;
      let detourAtS: number | null = null;
      let contacts = 0;
      for (let i = 0; i < seconds / DT && detourAtS === null; i += 1) {
        const timeS = (i + 1) * DT;
        const result = stepActors(state, learnerAt(timeS), DT);
        state = result.state;
        if (result.contactId !== null) contacts += 1;
        const cursor = state.cursors[index];
        if (cursor.activeSinceS !== null && cursor.speedMps < 0.05) heldAtS ??= timeS;
        if (cursor.detour !== null) detourAtS = timeS;
      }
      return { heldAtS, detourAtS, contacts };
    };
    const moving = (learner: LearnerState, speed: number): LearnerState =>
      ({ ...learner, signedSpeedMps: speed, gear: 'D', parkingBrake: false });
    /** Triangle wave between 0 and 2 * amplitude at the given speed. */
    const rock = (timeS: number, amplitudeM: number, speed: number) => {
      const periodS = (4 * amplitudeM) / speed;
      const phase = (timeS % periodS) / periodS;
      return 2 * amplitudeM * (phase < 0.5 ? 2 * phase : 2 - 2 * phase);
    };

    it('a learner creeping in place in a car lane holds the car at most HELD_BY_LEARNER_MAX_S', () => {
      expect(HELD_BY_LEARNER_MAX_S).toBe(10);
      for (const speed of [0.25, 0.5]) {
        const { heldAtS, detourAtS, contacts } = holdRun('roadside', 'car-roadside-a', 40,
          () => moving(poseLearner(profiles.sedan, -2.35, 0), speed));
        expect(contacts, `${speed} m/s`).toBe(0);
        expect(heldAtS, `${speed} m/s`).not.toBeNull();
        expect(detourAtS, `${speed} m/s`).not.toBeNull();
        expect(detourAtS! - heldAtS!, `${speed} m/s`).toBeLessThanOrEqual(HELD_BY_LEARNER_MAX_S + DT);
      }
    });

    it('a learner rocking in front of a car holds it at most HELD_BY_LEARNER_MAX_S', () => {
      for (const [amplitudeM, speed] of [[0.4, 0.5], [0.4, 1.0], [1.2, 1.0], [1.2, 1.5], [3, 1.5]] as const) {
        const label = `+-${amplitudeM} m at ${speed} m/s`;
        // Garage: the car drives +x along z = -1; the learner straddles its lane at x = 0 and rocks
        // back and forth across it (z centre -1 - a .. -1 + a), so the corridor never clears.
        const { heldAtS, detourAtS, contacts } = holdRun('garage', 'car-garage-ambient', 60,
          (timeS) => moving(poseLearner(profiles.sedan, 0,
            -1 - amplitudeM + rock(timeS, amplitudeM, speed)), speed));
        expect(contacts, label).toBe(0);
        expect(heldAtS, label).not.toBeNull();
        expect(detourAtS, label).not.toBeNull();
        expect(detourAtS! - heldAtS!, label).toBeLessThanOrEqual(HELD_BY_LEARNER_MAX_S + DT);
      }
    });

    it('a learner slowly crossing the garage aisle is waited for (no early detour)', () => {
      for (const speed of [0.3, 0.5]) { // above the 0.2 m/s "stopped" threshold
        // Rear already in the lane at z = -3.5 (x = 0), reversing +z from 18 s (heading 0 faces -z);
        // clears the lane (z centre beyond about 2 m) long after the car arrives at about 22 s.
        const startZ = -3.5;
        const zAt = (timeS: number) => (timeS < 18 ? startZ : startZ + (timeS - 18) * speed);
        const { heldAtS, detourAtS, contacts } = holdRun('garage', 'car-garage-ambient', 60,
          (timeS) => moving(poseLearner(profiles.sedan, 0, zAt(timeS)), -speed));
        const label = `${speed} m/s`;
        expect(contacts, label).toBe(0);
        expect(heldAtS, label).not.toBeNull();
        if (detourAtS !== null) {
          expect(detourAtS - heldAtS!, label).toBeGreaterThanOrEqual(HELD_BY_LEARNER_MAX_S - DT - 1e-6);
        }
      }
    });

    it('an ambient actor does not start into a learner parked on its first stretch', () => {
      const cases = [
        { environmentId: 'garage', x: -9, z: -1, actorId: 'car-garage-ambient', leaveS: 30 },
        { environmentId: 'roadside', x: -2, z: 12, actorId: 'car-roadside-a', leaveS: 15 },
      ] as const;
      for (const profile of vehicles) {
        for (const { environmentId, x, z, actorId, leaveS } of cases) {
          const label = `${profile.id}/${environmentId}@(${x},${z})`;
          const index = ambientSchedules[environmentId].findIndex(({ actor }) => actor.id === actorId);
          let state = sandboxWorld(environmentId);
          let startedAtS: number | null = null;
          for (let i = 0; i < (leaveS + 15) / DT; i += 1) {
            const timeS = (i + 1) * DT;
            const learner = timeS < leaveS ? poseLearner(profile, x, z) : poseLearner(profile, 60, 60);
            const result = stepActors(state, learner, DT);
            state = result.state;
            expect(result.contactId, `${label} at ${timeS.toFixed(2)} s`).toBeNull();
            const cursor = state.cursors[index];
            if (cursor.activeSinceS !== null) startedAtS ??= cursor.activeSinceS;
          }
          expect(startedAtS, label).not.toBeNull();
          expect(startedAtS!, label).toBeGreaterThanOrEqual(leaveS - 1e-6);
          expect(startedAtS!, label).toBeLessThanOrEqual(leaveS + 2 * DT);
        }
      }
    });

    it('a deferred ambient start never restarts a visible actor (no teleport, no overlap)', () => {
      type Case = { environmentId: 'garage' | 'roadside'; x: number; z: number; leaveS: number;
        speed?: number; seconds: number };
      const cases: Case[] = [
        ...[15, 20, 25, 30, 32].map((leaveS) => ({
          environmentId: 'garage' as const, x: -6, z: 12, leaveS, seconds: 80 })),
        { environmentId: 'roadside', x: -2.35, z: 16, leaveS: 20, seconds: 60 },
        // A learner holding car-roadside-a in its lane (creeping in place) across period boundaries.
        { environmentId: 'roadside', x: -2.35, z: 0, leaveS: 70, speed: 0.5, seconds: 80 },
      ];
      for (const { environmentId, x, z, leaveS, speed = 0, seconds } of cases) {
        const label = `${environmentId}@(${x},${z}) leave ${leaveS} s`;
        const entries = ambientSchedules[environmentId];
        let state = sandboxWorld(environmentId);
        let before = actorPoses(state);
        for (let i = 0; i < seconds / DT; i += 1) {
          const timeS = (i + 1) * DT;
          const learner = timeS < leaveS
            ? { ...poseLearner(profiles.sedan, x, z), signedSpeedMps: speed }
            : poseLearner(profiles.sedan, 60, 60);
          state = stepActors(state, learner, DT).state;
          const poses = actorPoses(state);
          poses.forEach((pose, index) => {
            if (!pose.visible || !before[index].visible) return;
            const movedM = Math.hypot(pose.positionM[0] - before[index].positionM[0],
              pose.positionM[2] - before[index].positionM[2]);
            expect(movedM, `${label} ${pose.id} at ${timeS.toFixed(2)} s`)
              .toBeLessThanOrEqual(entries[index].actor.cruiseMps * DT + 1e-6);
          });
          before = poses;
          const boxes = actorBoxes(state);
          for (let a = 0; a < boxes.length; a += 1) {
            for (let b = a + 1; b < boxes.length; b += 1) {
              expect(polygonsOverlap(boxPolygon(boxes[a]), boxPolygon(boxes[b])),
                `${label} ${boxes[a].id}/${boxes[b].id} at ${timeS.toFixed(2)} s`).toBe(false);
            }
          }
        }
      }
    }, 60_000);

    it('a learner wandering the garage never makes a detouring actor drive through another', () => {
      // Deterministic LCG; every 3 s the learner either holds still or picks a new random velocity.
      let seed = 1;
      const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let run = 0; run < 150; run += 1) {
        let state = sandboxWorld('garage');
        let x = -10 + random() * 20, z = -3 + random() * 6, vx = 0, vz = 0;
        const yawRad = random() < 0.5 ? 0 : Math.PI / 2;
        for (let i = 0; i < 150 / DT; i += 1) {
          if (i % (120 * 3) === 0) {
            const hold = random() < 0.5;
            vx = hold ? 0 : (random() - 0.5) * 3;
            vz = hold ? 0 : (random() - 0.5) * 1.5;
          }
          x = Math.max(-12, Math.min(12, x + vx * DT));
          z = Math.max(-5, Math.min(5, z + vz * DT));
          const learner = { ...poseLearner(profiles.sedan, x, z, yawRad),
            signedSpeedMps: Math.hypot(vx, vz), gear: 'D' as const, parkingBrake: false };
          state = stepActors(state, learner, DT).state;
          const boxes = actorBoxes(state);
          if (boxes.length === 2 && polygonsOverlap(boxPolygon(boxes[0]), boxPolygon(boxes[1]))) {
            throw new Error(`run ${run} ${boxes[0].id}/${boxes[1].id} overlap at ${((i + 1) * DT).toFixed(2)} s`);
          }
        }
      }
    }, 120_000);

    it('actors on crossing paths yield to each other and both finish', () => {
      const far = poseLearner(profiles.sedan, 50, 50);
      const walker = pedestrian('ped-cross', [[0, -10], [0, 10]], turnBackDetour);
      const driver = car('car-cross', [[-10, 0], [10, 0]], ROADSIDE_CAR_MPS, turnBackDetour);
      const orders = [
        [{ actor: walker, startS: 0, periodS: 1000 }, { actor: driver, startS: 5, periodS: 1000 }],
        [{ actor: driver, startS: 5, periodS: 1000 }, { actor: walker, startS: 0, periodS: 1000 }],
        [{ actor: driver, startS: 0, periodS: 1000 }, { actor: walker, startS: 0, periodS: 1000 }],
      ];
      for (const entries of orders) {
        let state = createActorWorld({ kind: 'ambient', entries }, 'realistic');
        for (let i = 0; i < 60 / DT; i += 1) {
          state = stepActors(state, { ...far }, DT).state;
          const boxes = actorBoxes(state);
          if (boxes.length === 2) {
            expect(polygonsOverlap(boxPolygon(boxes[0]), boxPolygon(boxes[1])),
              `${entries[0].actor.id} first at ${(i * DT).toFixed(2)} s`).toBe(false);
          }
        }
        expect(state.cursors.map((cursor) => cursor.finished), entries[0].actor.id)
          .toEqual([true, true]);
      }
    }, 60_000);

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
