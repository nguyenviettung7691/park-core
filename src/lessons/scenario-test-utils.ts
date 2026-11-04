import { expect } from 'vitest';
import type {
  BodyPose,
  OrientedRegion,
  ScenarioDefinition,
  SpawnPose,
  StageId,
  Vec3Data,
  VehicleProfile,
} from '../contracts';
import type { ColliderBox } from '../runtime-types';
import { vehicleFootprint } from '../vehicle/geometry';

interface ScenarioModule {
  readonly scenarios: Readonly<Record<StageId, ScenarioDefinition>>;
}

type ScenarioColliderApi = {
  readonly collidersForScenario?: (
    scenario: ScenarioDefinition,
  ) => readonly ColliderBox[];
};

export function requireScenarioModule(): ScenarioModule {
  const module = import.meta.glob<ScenarioModule>('./scenarios.ts', { eager: true })[
    './scenarios.ts'
  ];
  expect(module, 'lesson scenarios module').toBeDefined();
  if (!module) throw new Error('Lesson scenarios module is missing');
  return module;
}

export async function requireScenarioColliderComposer(): Promise<
  (scenario: ScenarioDefinition) => readonly ColliderBox[]
> {
  const module = await import('../world/colliders');
  const composer = (module as typeof module & ScenarioColliderApi).collidersForScenario;
  expect(composer, 'scenario collider composer').toBeTypeOf('function');
  if (!composer) throw new Error('Scenario collider composer is missing');
  return composer;
}

export function poseFromSpawn(spawn: SpawnPose): BodyPose {
  return {
    positionM: spawn.positionM,
    rotation: [0, Math.sin(spawn.yawRad / 2), 0, Math.cos(spawn.yawRad / 2)],
  };
}

export function poseAtRegion(region: OrientedRegion, profile: VehicleProfile): BodyPose {
  return {
    positionM: [region.centerM[0], profile.centerOfMassHeightM, region.centerM[2]],
    rotation: [
      0,
      Math.sin(region.headingRad / 2),
      0,
      Math.cos(region.headingRad / 2),
    ],
  };
}

export function footprint(pose: BodyPose, profile: VehicleProfile): readonly Vec3Data[] {
  return vehicleFootprint(pose, profile);
}

function rectangle(
  centerM: Vec3Data,
  halfWidthM: number,
  halfLengthM: number,
  yawRad: number,
): readonly [Vec3Data, Vec3Data, Vec3Data, Vec3Data] {
  const cos = Math.cos(yawRad), sin = Math.sin(yawRad);
  const local = [
    [-halfWidthM, -halfLengthM],
    [halfWidthM, -halfLengthM],
    [halfWidthM, halfLengthM],
    [-halfWidthM, halfLengthM],
  ] as const;
  return [
    [centerM[0] + cos * local[0][0] + sin * local[0][1], centerM[1],
      centerM[2] - sin * local[0][0] + cos * local[0][1]],
    [centerM[0] + cos * local[1][0] + sin * local[1][1], centerM[1],
      centerM[2] - sin * local[1][0] + cos * local[1][1]],
    [centerM[0] + cos * local[2][0] + sin * local[2][1], centerM[1],
      centerM[2] - sin * local[2][0] + cos * local[2][1]],
    [centerM[0] + cos * local[3][0] + sin * local[3][1], centerM[1],
      centerM[2] - sin * local[3][0] + cos * local[3][1]],
  ];
}

export function colliderFootprint(box: ColliderBox): readonly Vec3Data[] {
  return rectangle(box.centerM, box.halfExtentsM[0], box.halfExtentsM[2], box.yawRad);
}

export function regionFootprint(region: OrientedRegion): readonly Vec3Data[] {
  return rectangle(
    region.centerM,
    region.halfWidthM,
    region.halfLengthM,
    region.headingRad,
  );
}

export function polygonsOverlap(
  first: readonly Vec3Data[],
  second: readonly Vec3Data[],
): boolean {
  const axes = [...first, ...second].map((point, index, points) => {
    const next = points[(index + 1) % points.length];
    return [-(next[2] - point[2]), next[0] - point[0]] as const;
  });
  return axes.every(([axisX, axisZ]) => {
    const project = (polygon: readonly Vec3Data[]) => polygon.map(
      (point) => point[0] * axisX + point[2] * axisZ,
    );
    const firstProjection = project(first);
    const secondProjection = project(second);
    return Math.max(...firstProjection) >= Math.min(...secondProjection) - 1e-8
      && Math.max(...secondProjection) >= Math.min(...firstProjection) - 1e-8;
  });
}

export function pointInRegion(
  point: Vec3Data,
  region: OrientedRegion,
  insetM = 0,
): boolean {
  const dx = point[0] - region.centerM[0];
  const dz = point[2] - region.centerM[2];
  const cos = Math.cos(region.headingRad), sin = Math.sin(region.headingRad);
  const localX = cos * dx - sin * dz;
  const localZ = sin * dx + cos * dz;
  return Math.abs(localX) <= region.halfWidthM - insetM + 1e-8
    && Math.abs(localZ) <= region.halfLengthM - insetM + 1e-8;
}

export function footprintInsideRegion(
  points: readonly Vec3Data[],
  region: OrientedRegion,
  insetM = 0,
): boolean {
  return points.every((point) => pointInRegion(point, region, insetM));
}

export function scenarioNumbersAreFinite(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(scenarioNumbersAreFinite);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).every(scenarioNumbersAreFinite);
  }
  return true;
}
