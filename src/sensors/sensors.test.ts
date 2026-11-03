import * as CANNON from 'cannon-es';
import { describe, expect, it } from 'vitest';
import type { SensorId } from '../contracts';
import { profiles } from '../vehicle/profiles';
import { classifyDistance, createSensors } from './proximity';

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
