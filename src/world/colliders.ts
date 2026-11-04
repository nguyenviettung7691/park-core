import * as CANNON from 'cannon-es';
import type {
  EnvironmentId,
  ScenarioDefinition,
  SpawnPose,
  VehicleProfile,
} from '../contracts';
import type { ColliderBox } from '../runtime-types';

export function createWorld(): CANNON.World {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0), allowSleep: false });
  world.broadphase = new CANNON.SAPBroadphase(world);
  const solver = world.solver as CANNON.GSSolver;
  solver.iterations = 10;
  solver.tolerance = 0.001;
  world.defaultContactMaterial.restitution = 0;
  return world;
}

const WALL = 0.05;
const wall = (id: string, x: number, z: number, hx: number, hz: number): ColliderBox =>
  ({ id, kind: 'obstacle', centerM: [x, 1, z], halfExtentsM: [hx, 1, hz], yawRad: 0 });

// Designer-selected development yard; not owner-authored lesson coordinates.
export const prototypeYard: readonly ColliderBox[] = Object.freeze([
  { id: 'ground', kind: 'ground', centerM: [0, -0.5, 0], halfExtentsM: [20, 0.5, 20], yawRad: 0 },
  wall('wall-north', 0, -20, 20, WALL),
  wall('wall-south', 0, 20, 20, WALL),
  wall('wall-west', -20, 0, WALL, 20),
  wall('wall-east', 20, 0, WALL, 20),
  { id: 'barrier', kind: 'obstacle', centerM: [0, 0.5, -10], halfExtentsM: [4, 0.5, 0.05], yawRad: 0 },
] satisfies ColliderBox[]);

const environmentColliders: Readonly<Record<EnvironmentId, readonly ColliderBox[]>> = {
  garage: Object.freeze([
    { id: 'garage-ground', kind: 'ground', centerM: [0, -0.125, 0],
      halfExtentsM: [15, 0.125, 15], yawRad: 0 },
    { id: 'garage-back-wall', kind: 'obstacle', centerM: [0, 2.8, -14.8],
      halfExtentsM: [15, 2.8, 0.2], yawRad: 0 },
    { id: 'garage-left-wall', kind: 'obstacle', centerM: [-14.8, 2.8, 0],
      halfExtentsM: [0.2, 2.8, 15], yawRad: 0 },
    { id: 'garage-right-wall', kind: 'obstacle', centerM: [14.8, 2.8, 0],
      halfExtentsM: [0.2, 2.8, 15], yawRad: 0 },
    { id: 'garage-pillar-lf', kind: 'obstacle', centerM: [-9, 2.45, -8],
      halfExtentsM: [0.35, 2.45, 0.35], yawRad: 0 },
    { id: 'garage-pillar-lb', kind: 'obstacle', centerM: [-9, 2.45, 8],
      halfExtentsM: [0.35, 2.45, 0.35], yawRad: 0 },
    { id: 'garage-pillar-rf', kind: 'obstacle', centerM: [9, 2.45, -8],
      halfExtentsM: [0.35, 2.45, 0.35], yawRad: 0 },
    { id: 'garage-pillar-rb', kind: 'obstacle', centerM: [9, 2.45, 8],
      halfExtentsM: [0.35, 2.45, 0.35], yawRad: 0 },
  ] satisfies ColliderBox[]),
  roadside: Object.freeze([
    { id: 'roadside-ground', kind: 'ground', centerM: [0, -0.12, 0],
      halfExtentsM: [25, 0.12, 16], yawRad: 0 },
    { id: 'roadside-curb-left', kind: 'curb', centerM: [-4.2, 0.12, 0],
      halfExtentsM: [0.15, 0.12, 16], yawRad: 0 },
    { id: 'roadside-curb-right', kind: 'curb', centerM: [4.2, 0.12, 0],
      halfExtentsM: [0.15, 0.12, 16], yawRad: 0 },
    { id: 'roadside-fence', kind: 'obstacle', centerM: [8, 0.9, 0],
      halfExtentsM: [0.09, 0.9, 14], yawRad: 0 },
    { id: 'roadside-block', kind: 'obstacle', centerM: [-7.2, 0.35, -1],
      halfExtentsM: [0.6, 0.35, 0.35], yawRad: 0 },
  ] satisfies ColliderBox[]),
};

export function collidersForEnvironment(id: EnvironmentId): readonly ColliderBox[] {
  return environmentColliders[id];
}

export function collidersForScenario(scenario: ScenarioDefinition): readonly ColliderBox[] {
  const boxes = [...collidersForEnvironment(scenario.environmentId), ...scenario.obstacles];
  const ids = new Set<string>();
  for (const box of boxes) {
    if (ids.has(box.id)) throw new Error(`Duplicate collider ID: ${box.id}`);
    ids.add(box.id);
  }
  return boxes;
}

export const prototypeSpawn = (profile: VehicleProfile): SpawnPose =>
  ({ positionM: [0, profile.centerOfMassHeightM, 4], yawRad: 0 });

export function addColliderBoxes(world: CANNON.World, boxes: readonly ColliderBox[]): () => void {
  // Friction 1 so the pair product equals the chassis material's coefficient.
  const material = new CANNON.Material({ friction: 1, restitution: 0 });
  const bodies = boxes.map((box) => {
    const body = new CANNON.Body({ type: CANNON.Body.STATIC, mass: 0, material });
    body.addShape(new CANNON.Box(new CANNON.Vec3(...box.halfExtentsM)));
    body.position.set(...box.centerM);
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), box.yawRad);
    world.addBody(body);
    return body;
  });
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    for (const body of bodies) world.removeBody(body);
  };
}
