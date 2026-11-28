import { describe, expect, it } from 'vitest';
import type {
  ActorDefinition,
  ActorSchedule,
  Gear,
  Indicator,
  LessonActorEntry,
  Vec3Data,
} from '../contracts';
import {
  activeActorCount,
  actorBoxes,
  actorPoses,
  actorTimeS,
  createActorWorld,
  rulesForStage,
  stepActors,
  ACCEL_MPS2,
  BLOCKED_WAIT_S,
  CAR_DECEL_MPS2,
  LESSON_LIFETIME_S,
  NEAR_MISS_REARM_S,
  type ActorWorldState,
  type LearnerState,
} from './actors';

const DT = 1 / 120;

function actor(id: string, path: ActorDefinition['path'], cruiseMps = 1.4): ActorDefinition {
  return {
    id, kind: 'pedestrian', halfExtentsM: [0.25, 0.9, 0.2], path, cruiseMps,
    detour: { kind: 'turn-back' },
  };
}

function entry(
  trigger: LessonActorEntry['trigger'],
  overrides: Partial<LessonActorEntry> & { path?: ActorDefinition['path']; cruiseMps?: number } = {},
): LessonActorEntry {
  const { path = [[0, 0], [10, 0]], cruiseMps, ...rest } = overrides;
  return {
    actor: actor('walker', path, cruiseMps), trigger, delayS: 0,
    checkMoment: 'moving-off', side: 'left', ...rest,
  };
}

const lesson = (...entries: LessonActorEntry[]): ActorSchedule => ({ kind: 'lesson', entries });

function learner(overrides: Partial<{
  gear: Gear; parkingBrake: boolean; speed: number; indicator: Indicator;
}> = {}): LearnerState {
  const { gear = 'P', parkingBrake = true, speed = 0, indicator = 'off' } = overrides;
  return {
    footprint: [[99, 0, 99], [101, 0, 99], [101, 0, 101], [99, 0, 101]],
    headingRad: 0, signedSpeedMps: speed, gear, parkingBrake, indicator,
  };
}

function run(state: ActorWorldState, input: LearnerState, steps: number): ActorWorldState {
  let current = state;
  for (let i = 0; i < steps; i += 1) current = stepActors(current, input, DT).state;
  return current;
}

describe('scripted actors', () => {
  it('untriggered lesson actors are hidden', () => {
    const world = createActorWorld(lesson(entry('moving-off'), entry('first-stop')), 'coach');
    expect(actorPoses(world).every((pose) => !pose.visible)).toBe(true);
    expect(activeActorCount(world)).toBe(0);
    expect(activeActorCount(run(world, learner(), 240))).toBe(0);
  });

  it('moving-off fires once gear D or R, brake released and |speed| > 0.2', () => {
    let world = createActorWorld(lesson(entry('moving-off', { path: [[3, 4], [9, 4]] })), 'coach');
    world = run(world, learner({ gear: 'D', parkingBrake: true, speed: 1 }), 10);
    expect(activeActorCount(world)).toBe(0);
    world = run(world, learner({ gear: 'N', parkingBrake: false, speed: 1 }), 10);
    expect(activeActorCount(world)).toBe(0);
    world = run(world, learner({ gear: 'D', parkingBrake: false, speed: 0.1 }), 10);
    expect(activeActorCount(world)).toBe(0);
    world = stepActors(world, learner({ gear: 'D', parkingBrake: false, speed: 1 }), DT).state;
    expect(activeActorCount(world)).toBe(1);
    const pose = actorPoses(world)[0];
    expect(pose.visible).toBe(true);
    expect(pose.positionM[0]).toBeCloseTo(3, 9);
    expect(pose.positionM[2]).toBeCloseTo(4, 9);
    expect(pose.positionM[1]).toBeCloseTo(0.9, 9);
  });

  it('moving-off also fires in reverse', () => {
    const world = stepActors(
      createActorWorld(lesson(entry('moving-off')), 'coach'),
      learner({ gear: 'R', parkingBrake: false, speed: -0.5 }), DT,
    ).state;
    expect(activeActorCount(world)).toBe(1);
  });

  it('trigger fires at most once', () => {
    const quick = { path: [[0, 0], [0.5, 0]] as ActorDefinition['path'], cruiseMps: 5 };
    const check = (trigger: LessonActorEntry['trigger'], on: LearnerState, off: LearnerState) => {
      let world = createActorWorld(lesson(entry(trigger, quick)), 'coach');
      let seenActive = false;
      let finished = false;
      for (const input of [on, off, on]) {
        for (let i = 0; i < 60; i += 1) {
          world = stepActors(world, input, DT).state;
          const count = activeActorCount(world);
          if (finished) expect(count, `${trigger} re-fired`).toBe(0);
          else if (count === 1) seenActive = true;
          else if (seenActive) finished = true;
        }
      }
      expect(seenActive).toBe(true);
      expect(finished).toBe(true);
    };
    check('reverse-selected', learner({ gear: 'R' }), learner({ gear: 'D' }));
    check('indicator-right', learner({ indicator: 'right' }), learner());
    check('indicator-left', learner({ indicator: 'left' }), learner());
  });

  it('first-stop needs prior motion', () => {
    const still = run(createActorWorld(lesson(entry('first-stop')), 'coach'), learner(), 600);
    expect(activeActorCount(still)).toBe(0);

    let world = createActorWorld(lesson(entry('first-stop')), 'coach');
    world = run(world, learner({ gear: 'D', parkingBrake: false, speed: 1 }), 120);
    expect(activeActorCount(world)).toBe(0);
    world = run(world, learner({ gear: 'D', parkingBrake: false, speed: 0.1 }), 50);
    expect(activeActorCount(world)).toBe(0);
    world = run(world, learner({ gear: 'D', parkingBrake: false, speed: 0.1 }), 10);
    expect(activeActorCount(world)).toBe(1);
  });

  it('delay is honoured on simulation time', () => {
    let world = createActorWorld(lesson(entry('reverse-selected', { delayS: 1.5 })), 'coach');
    world = stepActors(world, learner({ gear: 'R' }), DT).state;
    const triggerS = actorTimeS(world);
    const input = learner({ gear: 'R' });
    while (actorTimeS(world) < triggerS + 1.49 - 1e-9) world = stepActors(world, input, DT).state;
    expect(actorPoses(world)[0].visible).toBe(false);
    while (actorTimeS(world) < triggerS + 1.5 - 1e-9) world = stepActors(world, input, DT).state;
    expect(actorTimeS(world)).toBeCloseTo(triggerS + 1.5, 6);
    expect(actorPoses(world)[0].visible).toBe(true);
  });

  it('follows the polyline at cruise speed', () => {
    let world = createActorWorld(
      lesson(entry('moving-off', { path: [[0, 0], [10, 0], [10, 10]], cruiseMps: 1.4 })),
      'coach',
    );
    world = stepActors(world, learner({ gear: 'D', parkingBrake: false, speed: 1 }), DT).state;
    const first = actorPoses(world)[0];
    expect(first.yawRad).toBeCloseTo(Math.atan2(-1, 0), 9); // along +x
    world = run(world, learner({ gear: 'D', parkingBrake: false, speed: 1 }), 1200);
    const pose = actorPoses(world)[0];
    expect(pose.visible).toBe(true);
    expect(Math.abs(pose.positionM[0] - 10)).toBeLessThan(0.02);
    expect(Math.abs(pose.positionM[2] - 4)).toBeLessThan(0.02);
    expect(pose.yawRad).toBeCloseTo(Math.PI, 9); // local -z faces +z
    expect(Math.abs(pose.strideM - 14)).toBeLessThan(0.02);
    const [box] = actorBoxes(world);
    expect(box.centerM).toEqual(pose.positionM);
    expect(box.yawRad).toBe(pose.yawRad);
  });

  it('finishes at the path end and hides', () => {
    let world = createActorWorld(
      lesson(entry('moving-off', { path: [[0, 0], [2, 0]], cruiseMps: 1 })), 'coach',
    );
    const input = learner({ gear: 'D', parkingBrake: false, speed: 1 });
    world = run(world, input, 200);
    expect(activeActorCount(world)).toBe(1);
    world = run(world, input, 60);
    expect(activeActorCount(world)).toBe(0);
    expect(actorPoses(world)[0].visible).toBe(false);
    expect(actorBoxes(world)).toEqual([]);
    expect(activeActorCount(run(world, input, 600))).toBe(0);
  });

  it('forceTriggersAtS treats every lesson trigger as fired at that time', () => {
    const world = createActorWorld(
      lesson(entry('first-stop'), entry('indicator-left', { delayS: 1 })), 'coach',
      { forceTriggersAtS: 2 },
    );
    expect(activeActorCount(world)).toBe(0);
    let current = run(world, learner(), 240);
    expect(actorPoses(current).map((pose) => pose.visible)).toEqual([true, false]);
    current = run(current, learner(), 120);
    expect(actorPoses(current).map((pose) => pose.visible)).toEqual([true, true]);
  });

  it('ambient entries start at startS and repeat each periodS', () => {
    const schedule: ActorSchedule = {
      kind: 'ambient',
      entries: [{ actor: actor('passer', [[0, 0], [2, 0]], 1), startS: 5, periodS: 30 }],
    };
    let world = createActorWorld(schedule, 'realistic');
    const input = learner();
    const visibleAt = (timeS: number) => {
      while (actorTimeS(world) < timeS - 1e-9) world = stepActors(world, input, DT).state;
      return actorPoses(world)[0].visible;
    };
    expect(visibleAt(4.9)).toBe(false);
    expect(visibleAt(5.01)).toBe(true);
    expect(visibleAt(10)).toBe(false);
    expect(visibleAt(34.9)).toBe(false);
    expect(visibleAt(35.01)).toBe(true);
    expect(visibleAt(40)).toBe(false);
  });

  it('same inputs give identical state', () => {
    const schedule = lesson(
      entry('moving-off', { path: [[0, 0], [5, 0], [5, 5]] }),
      entry('indicator-right', { delayS: 0.7 }),
    );
    const script = (step: number): LearnerState => learner({
      gear: step < 100 ? 'P' : step < 1500 ? 'D' : 'R',
      parkingBrake: step < 100,
      speed: step < 100 ? 0 : step % 400 < 200 ? 1 : 0,
      indicator: step > 700 && step < 900 ? 'right' : 'off',
    });
    const record = () => {
      let world = createActorWorld(schedule, 'coach');
      const frames: unknown[] = [];
      for (let step = 0; step < 3000; step += 1) {
        world = stepActors(world, script(step), DT).state;
        frames.push(actorPoses(world));
      }
      return frames;
    };
    expect(record()).toEqual(record());
  });

  it('reports no contact or near miss for a distant learner and freezes state', () => {
    const world = createActorWorld(lesson(entry('moving-off')), 'coach');
    const result = stepActors(world, learner(), DT);
    expect(result.contactId).toBeNull();
    expect(result.nearMissIds).toEqual([]);
    expect(Object.isFrozen(result.state)).toBe(true);
  });

  it('maps stages to rule sets', () => {
    expect([1, 2, 3, 4, 5].map((id) => rulesForStage(id as 1 | 2 | 3 | 4 | 5)))
      .toEqual(['coach', 'coach', 'realistic', 'realistic', 'realistic']);
  });

  describe('yield, contact and detours', () => {
    const CAR_SPEED = 20 / 3.6;

    function car(id: string, path: ActorDefinition['path']): ActorDefinition {
      return {
        id, kind: 'car', halfExtentsM: [0.9, 0.7, 2.2], path, cruiseMps: CAR_SPEED,
        detour: { kind: 'turn-back' },
      };
    }

    const forced = (definition: ActorDefinition): ActorSchedule => lesson({
      actor: definition, trigger: 'moving-off', delayS: 0, checkMoment: 'moving-off', side: 'left',
    });

    function rectangle(minX: number, maxX: number, minZ: number, maxZ: number, speed = 0) {
      return {
        footprint: [[minX, 0, minZ], [maxX, 0, minZ], [maxX, 0, maxZ], [minX, 0, maxZ]],
        headingRad: 0, signedSpeedMps: speed, gear: 'D' as Gear, parkingBrake: false,
        indicator: 'off' as Indicator,
      } satisfies LearnerState;
    }

    const start = (definition: ActorDefinition, rules: 'coach' | 'realistic') => createActorWorld(
      forced(definition), rules, { forceTriggersAtS: 0 },
    );
    const speedOf = (world: ActorWorldState) => world.cursors[0].speedMps;
    const distanceOf = (world: ActorWorldState) => world.cursors[0].distanceM;

    it('realistic car brakes at 6 m/s²', () => {
      let world = start(car('car-a', [[0, 0], [0, -80]]), 'realistic');
      // Learner box across the path, near edge 10 m ahead of the origin.
      const blocker = rectangle(-3, 3, -13, -10);
      let braked = 0;
      let previous = speedOf(world);
      for (let i = 0; i < 300; i += 1) {
        const result = stepActors(world, blocker, DT);
        world = result.state;
        expect(result.contactId).toBeNull();
        if (actorPoses(world)[0].braking && previous > 0.06) {
          expect(previous - speedOf(world)).toBeCloseTo(CAR_DECEL_MPS2 * DT, 9);
          braked += 1;
        }
        previous = speedOf(world);
      }
      expect(braked).toBeGreaterThan(50);
      expect(speedOf(world)).toBe(0);
    });

    it('realistic rules allow a late cut-in', () => {
      let world = start(car('car-a', [[0, 0], [0, -80]]), 'realistic');
      world = run(world, learner(), 60);
      const front = actorBoxes(world)[0].centerM[2] - 2.2;
      const cutIn = rectangle(-3, 3, front - 3, front - 1);
      let contact: string | null = null;
      for (let i = 0; i < 60 && contact === null; i += 1) {
        const result = stepActors(world, cutIn, DT);
        world = result.state;
        contact = result.contactId;
      }
      expect(contact).toBe('car-a');
    });

    it('coach rules never let actor motion cause contact', () => {
      let world = start(car('car-a', [[0, 0], [0, -80]]), 'coach');
      world = run(world, learner(), 60);
      const front = actorBoxes(world)[0].centerM[2] - 2.2;
      const cutIn = rectangle(-3, 3, front - 3, front - 1);
      let held = false;
      let heldAt = 0;
      for (let i = 0; i < 240; i += 1) {
        const result = stepActors(world, cutIn, DT);
        world = result.state;
        expect(result.contactId).toBeNull();
        if (held) expect(distanceOf(world)).toBe(heldAt);
        else if (speedOf(world) === 0) { held = true; heldAt = distanceOf(world); }
      }
      expect(held).toBe(true);
    });

    it('coach rules: learner driving into a stopped pedestrian is a contact', () => {
      let world = start(actor('ped-1', [[0, 0], [10, 0]]), 'coach');
      const wall = rectangle(4, 6, -1, 1);
      for (let i = 0; i < 480; i += 1) {
        const result = stepActors(world, wall, DT);
        world = result.state;
        expect(result.contactId).toBeNull();
      }
      expect(speedOf(world)).toBe(0);
      const front = actorBoxes(world)[0].centerM[0] + 0.2;
      const driven = stepActors(world, rectangle(front - 0.4, front + 2, -1, 1, 1), DT);
      expect(driven.contactId).toBe('ped-1');
    });

    it('near miss emitted once per encounter, only when the learner was moving', () => {
      let world = start(actor('ped-1', [[0, 0], [10, 0]]), 'realistic');
      const emitted: string[] = [];
      let minX = 8;
      for (let i = 0; i < 600; i += 1) {
        if (i < 420) minX -= 1 * DT;
        const result = stepActors(world, rectangle(minX, minX + 1.5, -1, 1, i < 420 ? 1 : 0), DT);
        world = result.state;
        emitted.push(...result.nearMissIds);
      }
      expect(emitted).toEqual(['ped-1']);

      let still = start(actor('ped-1', [[0, 0], [10, 0]]), 'realistic');
      const quiet: string[] = [];
      for (let i = 0; i < 240; i += 1) {
        const result = stepActors(still, rectangle(1, 2.5, -1, 1), DT);
        still = result.state;
        quiet.push(...result.nearMissIds);
      }
      expect(quiet).toEqual([]);
    });

    describe('near-miss latch per encounter', () => {
      /** Learner moving at 1 m/s either in the actor's corridor or well clear of it. */
      const blockedLearner = () => rectangle(0.8, 2.3, -1, 1, 1);
      const clearLearner = () => rectangle(0.8, 2.3, 20, 22, 1);
      const phase = (world: ActorWorldState, input: () => LearnerState, seconds: number,
        emitted: string[]): ActorWorldState => {
        let current = world;
        for (let i = 0; i < Math.round(seconds / DT); i += 1) {
          const result = stepActors(current, input(), DT);
          current = result.state;
          emitted.push(...result.nearMissIds);
        }
        return current;
      };

      it('braking flicker inside one encounter records one near miss', () => {
        let world = start(actor('ped-1', [[0, 0], [30, 0]]), 'realistic');
        const emitted: string[] = [];
        world = phase(world, blockedLearner, 0.5, emitted);
        world = phase(world, clearLearner, 0.3, emitted);
        world = phase(world, blockedLearner, 0.5, emitted);
        world = phase(world, clearLearner, 0.3, emitted);
        phase(world, blockedLearner, 0.5, emitted);
        expect(emitted).toEqual(['ped-1']);
      });

      it('re-arms after the corridor has been clear for NEAR_MISS_REARM_S', () => {
        let world = start(actor('ped-1', [[0, 0], [30, 0]]), 'realistic');
        const emitted: string[] = [];
        world = phase(world, blockedLearner, 0.5, emitted);
        world = phase(world, clearLearner, NEAR_MISS_REARM_S + 0.05, emitted);
        phase(world, blockedLearner, 0.5, emitted);
        expect(emitted).toEqual(['ped-1', 'ped-1']);
      });
    });

    const detours: readonly [string, ActorDefinition['detour']][] = [
      ['turn-back', { kind: 'turn-back' }],
      ['offset', { kind: 'offset', lateralM: 4 }],
    ];
    it.each(detours)('stationary blocker → 3 s wait → %s detour', (name, detour) => {
      let world = start({ ...actor('ped-1', [[0, 0], [30, 0]], 2), detour }, 'realistic');
      const blocker = rectangle(4, 5, 0.2, 0.6);
      let stoppedStep = -1;
      let switchStep = -1;
      const after: Vec3Data[] = [];
      for (let step = 1; step <= 1800 && activeActorCount(world) === 1; step += 1) {
        const result = stepActors(world, blocker, DT);
        world = result.state;
        expect(result.contactId).toBeNull();
        if (stoppedStep < 0 && speedOf(world) < 0.05) stoppedStep = step;
        if (switchStep < 0 && world.cursors[0].detour !== null) switchStep = step;
        if (switchStep >= 0 && activeActorCount(world) === 1) after.push(actorPoses(world)[0].positionM);
      }
      expect(stoppedStep).toBeGreaterThan(0);
      expect(Math.abs(switchStep - stoppedStep - BLOCKED_WAIT_S / DT)).toBeLessThanOrEqual(1);
      expect(activeActorCount(world)).toBe(0);
      expect(after.length).toBeGreaterThan(10);
      const startX = after[0][0];
      if (name === 'turn-back') {
        expect(after[after.length - 1][0]).toBeLessThan(startX - 1);
        expect(after.every((p, i) => i === 0 || p[0] <= after[i - 1][0] + 1e-9)).toBe(true);
        expect(after.every((p) => Math.abs(p[2]) < 1e-9)).toBe(true);
      } else {
        // Left of +x travel is -z: the path ends 4 m to the left.
        const minZ = Math.min(...after.map((p) => p[2]));
        expect(minZ).toBeCloseTo(-4, 1);
        expect(after.every((p) => p[2] <= 1e-9)).toBe(true);
        // Ramps over 4 / tan(20 deg) = 10.99 m, never yawing more than 20 degrees.
        const transitionM = 4 / Math.tan(Math.PI / 9);
        const ramp = after.filter((p) => p[0] < startX + transitionM - 1e-6);
        expect(ramp.some((p) => p[2] < -0.5 && p[2] > -3.5)).toBe(true);
        expect(ramp.every((p) => p[2] > -4 + 1e-6)).toBe(true);
        const settled = after.filter((p) => p[0] > startX + transitionM + 1e-6);
        expect(settled.length).toBeGreaterThan(5);
        for (const p of settled) expect(p[2]).toBeCloseTo(-4, 6);
        for (let i = 1; i < after.length; i += 1) {
          const dx = after[i][0] - after[i - 1][0];
          const dz = after[i][2] - after[i - 1][2];
          if (Math.hypot(dx, dz) > 1e-9) {
            expect(Math.abs(Math.atan2(dz, dx))).toBeLessThanOrEqual(Math.PI / 9 + 1e-6);
          }
        }
      }
    });

    it('a small offset still side-steps over the 2 m minimum transition', () => {
      const detour = { kind: 'offset', lateralM: 0.5 } as const;
      let world = start({ ...actor('ped-1', [[0, 0], [30, 0]], 2), detour }, 'realistic');
      const blocker = rectangle(4, 5, 0.2, 0.6);
      const after: Vec3Data[] = [];
      for (let step = 1; step <= 1800 && activeActorCount(world) === 1; step += 1) {
        world = stepActors(world, blocker, DT).state;
        if (world.cursors[0].detour !== null && activeActorCount(world) === 1) {
          after.push(actorPoses(world)[0].positionM);
        }
      }
      const startX = after[0][0];
      expect(Math.min(...after.map((p) => p[2]))).toBeCloseTo(-0.5, 6);
      for (const p of after.filter((q) => q[0] > startX + 2 + 1e-6)) expect(p[2]).toBeCloseTo(-0.5, 6);
      expect(after.some((p) => p[0] < startX + 2 - 0.1 && p[2] < -0.1 && p[2] > -0.45)).toBe(true);
    });

    it('blocking both path and detour finishes the actor through the detour-blocked rule', () => {
      const detour = { kind: 'offset', lateralM: 2 } as const;
      let world = start({ ...actor('ped-1', [[0, 0], [10, 0]]), detour }, 'realistic');
      const wide = rectangle(4, 5, -6, 6);
      let goneAtS = -1;
      for (let step = 1; step <= 120 * 20; step += 1) {
        const result = stepActors(world, wide, DT);
        world = result.state;
        expect(result.contactId).toBeNull();
        if (goneAtS < 0 && activeActorCount(world) === 0) goneAtS = actorTimeS(world);
      }
      expect(goneAtS).toBeGreaterThan(2 * BLOCKED_WAIT_S);
      expect(goneAtS).toBeLessThan(LESSON_LIFETIME_S - 3);
    });

    it('the 15 s lifetime cap clears an actor a creeping learner keeps braking', () => {
      // Learner at 0.3 m/s is never stationary, so only the cap can end the encounter.
      let world = start(actor('ped-1', [[0, 0], [10, 0]]), 'realistic');
      let goneAtS = -1;
      for (let step = 1; step <= 120 * 20; step += 1) {
        const result = stepActors(world, rectangle(4, 5, -6, 6, 0.3), DT);
        world = result.state;
        expect(result.contactId).toBeNull();
        if (goneAtS < 0 && activeActorCount(world) === 0) goneAtS = actorTimeS(world);
      }
      expect(Math.abs(goneAtS - LESSON_LIFETIME_S)).toBeLessThanOrEqual(DT + 1e-9);
    });

    it('an ambient actor that detoured starts its next cycle on the scheduled path', () => {
      const schedule: ActorSchedule = {
        kind: 'ambient',
        entries: [{ actor: actor('ped-1', [[0, 0], [10, 0]]), startS: 0, periodS: 20 }],
      };
      let world = createActorWorld(schedule, 'realistic');
      const blocker = rectangle(4, 5, -0.3, 0.3);
      let detoured = false;
      while (actorTimeS(world) < 19.9) {
        world = stepActors(world, blocker, DT).state;
        if (world.cursors[0].detour !== null) detoured = true;
      }
      expect(detoured).toBe(true);
      expect(activeActorCount(world)).toBe(0);
      while (actorTimeS(world) < 20.02) world = stepActors(world, rectangle(50, 51, 50, 51), DT).state;
      const cursor = world.cursors[0];
      expect(cursor.cycle).toBe(1);
      expect(cursor.detour).toBeNull();
      expect(cursor.blockedS).toBe(0);
      expect(cursor.strideBaseM).toBe(0);
      expect(cursor.braking).toBe(false);
      const pose = actorPoses(world)[0];
      expect(pose.visible).toBe(true);
      expect(pose.positionM[0]).toBeGreaterThan(0);
      expect(pose.positionM[0]).toBeLessThan(0.1);
      expect(pose.positionM[2]).toBe(0);
      expect(pose.strideM).toBeCloseTo(pose.positionM[0], 9);
    });

    it('braking flag mirrors deceleration', () => {
      let world = start(car('car-a', [[0, 0], [0, -200]]), 'realistic');
      const blocker = rectangle(-3, 3, -13, -10);
      const far = learner();
      let previous = speedOf(world);
      let sawBraking = false;
      let sawRecovery = false;
      for (let i = 0; i < 480; i += 1) {
        const present = i < 240;
        world = stepActors(world, present ? blocker : far, DT).state;
        const { braking } = actorPoses(world)[0];
        const speed = speedOf(world);
        if (braking) {
          sawBraking = true;
          expect(speed).toBeLessThanOrEqual(previous);
        } else if (speed < CAR_SPEED - 1e-9) {
          sawRecovery = true;
          expect(speed - previous).toBeCloseTo(ACCEL_MPS2.car * DT, 9);
        }
        previous = speed;
      }
      expect(sawBraking && sawRecovery).toBe(true);
    });
  });
});
