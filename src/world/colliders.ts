import * as CANNON from 'cannon-es';
import type { SpawnPose, VehicleProfile } from '../contracts';
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
