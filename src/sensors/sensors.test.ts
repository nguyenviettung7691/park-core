import * as CANNON from 'cannon-es';
import { describe, expect, it } from 'vitest';
import type { SensorId } from '../contracts';
import { profiles } from '../vehicle/profiles';
import { classifyDistance, createSensors, wheelStopBodies } from './proximity';
import { scenarios } from '../lessons/scenarios';
import { wheelStops, wheelStopTouchingPose } from '../lessons/scenario-test-utils';
import { addColliderBoxes, collidersForScenario, createWorld } from '../world/colliders';
import { createVehicleRig } from '../vehicle/rig';
import { rayBoxDistance } from './actor-rays';
import type { ActorBox, LearnerState } from '../world/actors';
import { createActorWorld, sensorBoxes } from '../world/actors';
import { vehicleFootprint } from '../vehicle/geometry';
import type { ActorSchedule } from '../contracts';

const profile = profiles.sedan;
const frontIds: readonly SensorId[] = [
  'front-left-outer', 'front-left', 'front-center', 'front-right', 'front-right-outer',
];
const rearIds: readonly SensorId[] = [
  'rear-left-outer', 'rear-left', 'rear-center', 'rear-right', 'rear-right-outer',
];

function makeWorld() {
  return new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
}

function addBox(
  world: CANNON.World, position: readonly [number, number, number],
  halfExtents: readonly [number, number, number], solid = true,
) {
  const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
  body.addShape(new CANNON.Box(new CANNON.Vec3(...halfExtents)));
  body.position.set(...position);
  body.collisionResponse = solid;
  world.addBody(body);
  return body;
}

function addLearner(world: CANNON.World) {
  const body = new CANNON.Body({ mass: 1200 });
  body.addShape(new CANNON.Box(new CANNON.Vec3(0.9, 0.725, 2.3)));
  body.position.set(0, profile.centerOfMassHeightM, 0);
  world.addBody(body);
  return body;
}

describe('proximity distance classification', () => {
  it.each([
    [null, 'red', 'clear'],
    [2.51, 'clear', 'clear'],
    [2.5, 'clear', 'green'],
    [1.2, 'green', 'yellow'],
    [0.6, 'yellow', 'red'],
    [0.3, 'red', 'stop'],
    [0, 'clear', 'stop'],
  ] as const)('classifies %s m immediately as %s', (distanceM, _previous, expected) => {
    expect(classifyDistance(distanceM, _previous)).toBe(expected);
  });

  it.each([
    [2.55, 'green', 'green'], [2.551, 'green', 'clear'],
    [1.25, 'yellow', 'yellow'], [1.251, 'yellow', 'green'],
    [0.65, 'red', 'red'], [0.651, 'red', 'yellow'],
    [0.35, 'stop', 'stop'], [0.351, 'stop', 'red'],
  ] as const)('holds %s m in the prior %s band until the 0.05 m exit margin', (
    distanceM, previous, expected,
  ) => {
    expect(classifyDistance(distanceM, previous)).toBe(expected);
  });
});

describe('Cannon proximity rays', () => {
  it('returns the nearest solid hit and excludes the learner and non-solid markers', () => {
    const world = makeWorld();
    const learner = addLearner(world);
    addBox(world, [0, 0.45, -2.7], [0.3, 0.2, 0.05], false);
    const near = addBox(world, [0, 0.45, -3.515], [0.3, 0.2, 0.25]);
    addBox(world, [0, 0.45, -4.5], [0.3, 0.2, 0.1]);

    const sensors = createSensors(world, learner, profile);
    const result = sensors.sample(0);
    const frontCenter = result.readings.find(({ id }) => id === 'front-center')!;

    expect(frontCenter.obstacleId).toBe(String(near.id));
    expect(frontCenter.distanceM).toBeCloseTo(1.15, 2);
    expect(frontCenter.band).toBe('yellow');
  });

  it('uses the five specified rays on each bumper, including their spread and height', () => {
    const world = makeWorld();
    const learner = addLearner(world);
    const originXs = [-0.9, -0.45, 0, 0.45, 0.9];
    const offsets = [-60, -30, 0, 30, 60].map((degrees) => degrees * Math.PI / 180);
    const frontZ = -2.115;
    const rearZ = 2.485;
    const distance = 1.5;

    for (let i = 0; i < 5; i++) {
      const x = originXs[i]!;
      const angle = offsets[i]!;
      addBox(world, [
        x + Math.sin(angle) * distance, 0.45, frontZ - Math.cos(angle) * distance,
      ], [0.005, 0.15, 0.005]);
      addBox(world, [
        x + Math.sin(angle) * distance, 0.45, rearZ + Math.cos(angle) * distance,
      ], [0.005, 0.15, 0.005]);
    }

    const result = createSensors(world, learner, profile).sample(0);
    for (const id of [...frontIds, ...rearIds]) {
      expect(result.readings.find((reading) => reading.id === id)?.distanceM, id)
        .toBeCloseTo(distance, 1);
    }
  });

  it('reports a low obstacle below the bumper ray height as no hit', () => {
    const world = makeWorld();
    const learner = addLearner(world);
    addBox(world, [0, 0.2, -3.2], [0.4, 0.15, 0.3]);

    const center = createSensors(world, learner, profile).sample(0).readings
      .find(({ id }) => id === 'front-center')!;
    expect(center.distanceM).toBeNull();
    expect(center.obstacleId).toBeNull();
    expect(center.band).toBe('clear');
  });

  it('returns null for every ray without a hit and caps samples at 20 Hz without catch-up', () => {
    const world = makeWorld();
    const sensors = createSensors(world, addLearner(world), profile);

    const first = sensors.sample(0);
    expect(first.readings).toHaveLength(10);
    expect(first.readings.every(({ distanceM, obstacleId }) =>
      distanceM === null && obstacleId === null)).toBe(true);
    expect(sensors.sample(0.049)).toBe(first);
    const second = sensors.sample(0.051);
    expect(second.sampledAtS).toBe(0.051);
    expect(sensors.sample(0.4).sampledAtS).toBe(0.4);
    expect(sensors.sample(0.401).sampledAtS).toBe(0.4);
  });

  it('resets the distance-band history for a new attempt', () => {
    const world = makeWorld();
    const learner = addLearner(world);
    const obstacle = addBox(world, [0, 0.45, -3.515], [0.3, 0.2, 0.25]);
    const sensors = createSensors(world, learner, profile);

    expect(sensors.sample(0).readings.find(({ id }) => id === 'front-center')?.band)
      .toBe('yellow');
    obstacle.position.z = -3.595;
    obstacle.aabbNeedsUpdate = true;
    obstacle.updateAABB();
    world.broadphase.dirty = true;
    expect(sensors.sample(0.051).readings.find(({ id }) => id === 'front-center')?.band)
      .toBe('yellow');
    sensors.reset();
    expect(sensors.sample(0.051).readings.find(({ id }) => id === 'front-center')?.band)
      .toBe('green');
  });

  it('continues a latched green reading through its 2.55 m exit threshold', () => {
    const world = makeWorld();
    const learner = addLearner(world);
    const obstacle = addBox(world, [0, 0.45, -4.565], [0.3, 0.2, 0.05]);
    const sensors = createSensors(world, learner, profile);
    expect(sensors.sample(0).readings.find(({ id }) => id === 'front-center')?.band)
      .toBe('green');

    obstacle.position.z = -4.695;
    obstacle.aabbNeedsUpdate = true;
    obstacle.updateAABB();
    world.broadphase.dirty = true;
    const reading = sensors.sample(0.051).readings.find(({ id }) => id === 'front-center')!;
    expect(reading.distanceM).toBeCloseTo(2.53, 2);
    expect(reading.band).toBe('green');
  });
});

describe('garage wheel stops and the parking sensors', () => {
  it.each([
    [1, 'sedan'], [1, 'cuv'], [2, 'sedan'], [2, 'cuv'], [4, 'sedan'], [4, 'cuv'],
  ] as const)('stage %s/%s: no sensor reports the stop while the tyres touch it', (stageId, id) => {
    const scenario = scenarios[stageId];
    const [stop] = wheelStops(scenario);
    expect(stop).toBeDefined();
    const world = createWorld();
    const cleanup = addColliderBoxes(world, collidersForScenario(scenario));
    const stopBody = cleanup.edges.find(({ box }) => box.id === stop!.id)!.body;
    const rig = createVehicleRig(world, profiles[id], cleanup.idForBody, cleanup.edges);
    const { pose } = wheelStopTouchingPose(scenario, stop!, profiles[id]);
    rig.settle({ positionM: pose.positionM, yawRad: scenario.target.region.headingRad });
    const readings = createSensors(world, rig.body, profiles[id], wheelStopBodies(cleanup.edges))
      .sample(0).readings;
    for (const reading of readings) {
      expect(reading.obstacleId, reading.id).not.toBe(String(stopBody.id));
    }
    rig.dispose();
    cleanup();
  });

  it.each(['sedan', 'cuv'] as const)('%s: excludes a wheel stop explicitly, even one the rays would hit',
    (id) => {
      // A stop raised to sensor height in front of the car, approached from 3 m to 0.2 m: the rays
      // hit it (proving the geometry), yet it is never reported once it is excluded by kind.
      const p = profiles[id];
      const world = makeWorld();
      const stopBox = { id: 'tall-stop', kind: 'wheel-stop' as const, centerM: [0, 0.45, -5] as const,
        halfExtentsM: [0.9, 0.2, 0.075] as const, yawRad: 0 };
      const cleanup = addColliderBoxes(world, [stopBox]);
      const learner = addLearner(world);
      const frontZ = -((1 - p.frontWeightFraction) * p.wheelbaseM + p.frontOverhangM);
      const plain = createSensors(world, learner, p);
      const excluded = createSensors(world, learner, p, wheelStopBodies(cleanup.edges));
      const stopBody = cleanup.edges[0]!.body;
      let hits = 0;
      for (let i = 0; i <= 28; i++) {
        const gap = 3 - i * 0.1;
        learner.position.set(0, p.centerOfMassHeightM, -5 + 0.075 - frontZ + gap);
        const t = i * 0.05;
        if (plain.sample(t).readings.some(({ obstacleId }) => obstacleId === String(stopBody.id))) hits += 1;
        for (const reading of excluded.sample(t).readings) {
          expect(reading.obstacleId, `${reading.id} at ${gap.toFixed(1)} m`).toBeNull();
        }
      }
      expect(hits).toBeGreaterThan(0);
      cleanup();
    });
});

describe('actor rays', () => {
  const box: ActorBox = { id: 'ped-1', centerM: [0, 0.9, -3], halfExtentsM: [0.3, 0.9, 0.2], yawRad: 0 };

  it('hits the near face at the right distance', () => {
    expect(rayBoxDistance([0, 0.45, -0.5], [0, 0, -1], 2.55, box)).toBeCloseTo(2.3, 6);
    expect(rayBoxDistance([0, 0.45, -1], [0, 0, -1], 2.55, box)).toBeCloseTo(1.8, 6);
  });
  it('misses beside the box, beyond maxM, and above the box', () => {
    expect(rayBoxDistance([0.5, 0.45, -1], [0, 0, -1], 2.55, box)).toBeNull();
    expect(rayBoxDistance([0, 0.45, 0], [0, 0, -1], 2.55, box)).toBeNull();
    expect(rayBoxDistance([0, 1.9, -1], [0, 0, -1], 2.55, box)).toBeNull();
  });
  it('handles a yawed box', () => {
    const turned: ActorBox = { ...box, yawRad: Math.PI / 2 };
    expect(rayBoxDistance([0, 0.45, -1], [0, 0, -1], 2.55, turned)).toBeCloseTo(1.7, 6);
  });
});

describe('sensors and actors', () => {
  function boxesAt(box: ActorBox) { return () => [box] as const; }

  it('pedestrian crossing behind triggers the rear sensors', () => {
    const world = makeWorld();
    const learner = addLearner(world);
    const rearBumperZ = 2.485;
    const ped: ActorBox = {
      id: 'ped-1', centerM: [0, 0.9, rearBumperZ + 1.0 + 0.2], halfExtentsM: [0.3, 0.9, 0.2], yawRad: 0,
    };
    const rear = createSensors(world, learner, profile, new Set(), boxesAt(ped)).sample(0)
      .readings.find(({ id }) => id === 'rear-center')!;
    expect(rear.distanceM).toBeCloseTo(1.0, 2);
    expect(rear.band).toBe('yellow');
    expect(rear.obstacleId).toBe('ped-1');
  });

  const carEntry = (x: number, z: number, toZ: number) => ({
    actor: {
      id: 'car-1', kind: 'car' as const, halfExtentsM: [0.9, 0.7, 2.2] as const,
      path: [[x, z], [x, toZ]] as const, cruiseMps: 2.78,
      detour: { kind: 'turn-back' as const },
    },
    trigger: 'moving-off' as const, delayS: 0,
  });
  const learnerAt = (x: number): LearnerState => ({
    footprint: vehicleFootprint(
      { positionM: [x, 0, 0], rotation: [0, 0, 0, 1] }, profile,
    ),
    headingRad: 0, signedSpeedMps: 0, gear: 'P', parkingBrake: true, indicator: 'off',
  });
  const worldWith = (x: number, z: number, toZ: number) => {
    const schedule = { kind: 'lesson', entries: [carEntry(x, z, toZ)] } as unknown as ActorSchedule;
    return createActorWorld(schedule, 'realistic', { forceTriggersAtS: 0 });
  };

  it('car passing in the next lane stays clear', () => {
    const state = worldWith(-2.35, 8, -8);
    const learner = learnerAt(0);
    expect(sensorBoxes(state, learner)).toHaveLength(0);
    const world = makeWorld();
    const body = addLearner(world);
    const snap = createSensors(world, body, profile, new Set(), () => sensorBoxes(state, learner))
      .sample(0);
    expect(snap.readings.every(({ band }) => band === 'clear')).toBe(true);
  });

  it('car approaching in the same lane is reported', () => {
    const state = worldWith(0.3, 2, -8);
    expect(sensorBoxes(state, learnerAt(0)).map(({ id }) => id)).toEqual(['car-1']);
  });

  it('car approaching from behind at x = -2.6 beside a learner at x = -1.5 is reported', () => {
    const state = worldWith(-2.6, 8, -8);
    expect(sensorBoxes(state, learnerAt(-1.5)).map(({ id }) => id)).toEqual(['car-1']);
  });

  it('a crossing (non-parallel) actor is always reported', () => {
    const state = worldWith(-2.35, 8, -8);
    const learner = { ...learnerAt(0), headingRad: Math.PI / 2 };
    expect(sensorBoxes(state, learner)).toHaveLength(1);
  });
});
