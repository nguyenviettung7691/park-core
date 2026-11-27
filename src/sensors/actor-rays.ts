import type { Vec3Data } from '../contracts';
import type { ActorBox } from '../world/actors';

/**
 * Distance along a unit `direction` from `from` to the box's near face, or null when there is no
 * hit within `maxM`. Slab test in the box's local x/z frame; the hit counts only when the ray
 * height `from[1]` lies inside the box's vertical extent. A ray starting inside reads 0.
 */
export function rayBoxDistance(
  from: Vec3Data, direction: Vec3Data, maxM: number, box: ActorBox,
): number | null {
  const [cx, cy, cz] = box.centerM;
  if (from[1] < cy - box.halfExtentsM[1] || from[1] > cy + box.halfExtentsM[1]) return null;
  const cos = Math.cos(box.yawRad), sin = Math.sin(box.yawRad);
  // Inverse of orientedRectangle's local-to-world rotation.
  const dx = from[0] - cx, dz = from[2] - cz;
  const origin = [cos * dx - sin * dz, sin * dx + cos * dz] as const;
  const dir = [cos * direction[0] - sin * direction[2], sin * direction[0] + cos * direction[2]] as const;
  const half = [box.halfExtentsM[0], box.halfExtentsM[2]] as const;
  let near = 0, far = maxM;
  for (let axis = 0; axis < 2; axis += 1) {
    if (Math.abs(dir[axis]) < 1e-12) {
      if (Math.abs(origin[axis]) > half[axis]) return null;
      continue;
    }
    const t1 = (-half[axis] - origin[axis]) / dir[axis];
    const t2 = (half[axis] - origin[axis]) / dir[axis];
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
    if (near > far) return null;
  }
  return near;
}
