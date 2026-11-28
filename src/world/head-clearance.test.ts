import { Mesh, Triangle, Vector3, type Group, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { buildGlb } from '../../tools/generate-assets.mjs';
import type { VehicleId } from '../contracts';
import { deriveVehicleAssetContract } from '../vehicle/asset-contract';
import { profiles } from '../vehicle/profiles';
import { headEyeLocal, type SeatOffset } from '../views/head-pose';

/** Near plane (0.1 m) plus 0.02 m: no sampled eye may come closer to any vehicle triangle. */
const MIN_CLEARANCE_M = 0.12;
const DEG = Math.PI / 180;
const yaws = Array.from({ length: (110 + 160) / 5 + 1 }, (_, index) => (-160 + index * 5) * DEG);

function parse(bytes: Uint8Array): Promise<Group> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', (gltf) => resolve(gltf.scene), reject);
  });
}

/** Every triangle of every mesh (visible or not), in the vehicle root frame. */
function worldTriangles(root: Object3D): Triangle[] {
  root.updateMatrixWorld(true);
  const triangles: Triangle[] = [];
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute('position');
    const index = object.geometry.getIndex();
    const corner = (i: number) => new Vector3().fromBufferAttribute(position, index ? index.getX(i) : i)
      .applyMatrix4(object.matrixWorld);
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i += 3) triangles.push(new Triangle(corner(i), corner(i + 1), corner(i + 2)));
  });
  return triangles;
}

function nearest(eye: Vector3, triangles: readonly Triangle[]): number {
  const point = new Vector3();
  let best = Infinity;
  for (const triangle of triangles) best = Math.min(best, triangle.closestPointToPoint(eye, point).distanceTo(eye));
  return best;
}

describe('driver head clearance in the exported cockpit', () => {
  it.each(['sedan', 'cuv'] as const)('keeps every %s eye >= 0.12 m from the vehicle at the seat corners', async (id: VehicleId) => {
    const scene = await parse(buildGlb(id));
    const root = scene.children[0]!;
    expect(root.position.toArray()).toEqual([0, 0, 0]);
    const seatNode = root.getObjectByName('DriverSeat');
    if (!seatNode) throw new Error('DriverSeat missing');
    const authored = seatNode.position.clone();
    const contract = deriveVehicleAssetContract(profiles[id]);
    const { foreAft, height } = contract.seatRangeM;
    const failures: string[] = [];
    for (const foreAftM of foreAft) {
      for (const heightM of height) {
        const seat: SeatOffset = { foreAftM, heightM };
        seatNode.position.copy(authored).add(new Vector3(0, heightM, foreAftM));
        const triangles = worldTriangles(root);
        for (const yaw of yaws) {
          const eye = new Vector3(...headEyeLocal(contract.driverEyeLocalM, seat, yaw, contract.headClearance));
          const distance = nearest(eye, triangles);
          if (distance < MIN_CLEARANCE_M) {
            failures.push(`seat ${foreAftM}/${heightM} yaw ${Math.round(yaw / DEG)}: ${distance.toFixed(3)} m`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);
});
