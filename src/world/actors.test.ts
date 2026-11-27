import { describe, expect, it } from 'vitest';
import type {
  ActorDefinition,
  ActorSchedule,
  Gear,
  Indicator,
  LessonActorEntry,
} from '../contracts';
import {
  activeActorCount,
  actorBoxes,
  actorPoses,
  actorTimeS,
  createActorWorld,
  rulesForStage,
  stepActors,
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

  it('keeps contact and near-miss results empty and the state frozen', () => {
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
});
