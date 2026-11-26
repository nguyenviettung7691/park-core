import type { Vec3Data } from '../contracts';
import type { ColliderBox, WheelEdgeContact } from '../runtime-types';

export const TYRE_HALF_WIDTH_M = 0.1;

export interface TyreFrame {
  readonly centerM: Vec3Data;
  readonly rollDir: Vec3Data;
  readonly axleDir: Vec3Data;
  readonly radiusM: number;
  readonly groundY: number;
}

export interface TyreEdgeResult {
  readonly contact: WheelEdgeContact;
  readonly supportY: number | null;
  readonly normal: Vec3Data | null;
  readonly hitPointM: Vec3Data | null;
  readonly lateralPenetrationM: number;
  readonly lateralNormal: Vec3Data | null;
}

const NONE_CONTACT: WheelEdgeContact = Object.freeze({
  colliderId: null, kind: null, state: 'none',
});
const NO_EDGE: TyreEdgeResult = Object.freeze({
  contact: NONE_CONTACT, supportY: null, normal: null, hitPointM: null,
  lateralPenetrationM: 0, lateralNormal: null,
});
const SLICE_OFFSETS = [-TYRE_HALF_WIDTH_M, 0, TYRE_HALF_WIDTH_M] as const;
const EPS = 1e-9;

export function tyreEdge(tyre: TyreFrame, edges: readonly ColliderBox[]): TyreEdgeResult {
  const r = tyre.radiusM;
  const [cx, , cz] = tyre.centerM;
  const [rx, , rz] = tyre.rollDir;
  const [ax, , az] = tyre.axleDir;

  let over = false;
  let bestSupport = -Infinity;
  let bestBox: ColliderBox | null = null;
  let bestH = 0;
  let nx = 0;
  let nz = 0;
  let ny = 1;
  let hitX = 0;
  let hitZ = 0;
  let hitY = 0;
  let bestPen = 0;
  let penBox: ColliderBox | null = null;
  let penNx = 0;
  let penNz = 0;

  for (const box of edges) {
    if (box.kind !== 'curb' && box.kind !== 'wheel-stop') continue;
    const top = box.centerM[1] + box.halfExtentsM[1];
    if (tyre.groundY >= top) continue;
    const h = top - tyre.groundY;
    const cos = Math.cos(box.yawRad);
    const sin = Math.sin(box.yawRad);
    const hx = box.halfExtentsM[0];
    const hz = box.halfExtentsM[2];

    // Is the centre slice inside this box? Then it carries the wheel: no lateral push.
    const cwx = cx - box.centerM[0];
    const cwz = cz - box.centerM[2];
    const clx = cwx * cos - cwz * sin;
    const clz = cwx * sin + cwz * cos;
    const centreIn = Math.abs(clx) <= hx && Math.abs(clz) <= hz;

    for (let i = 0; i < 3; i += 1) {
      const off = SLICE_OFFSETS[i];
      const wx = cx + ax * off - box.centerM[0];
      const wz = cz + az * off - box.centerM[2];
      // Local axes in world xz: x -> (cos, -sin), z -> (sin, cos).
      const lx = wx * cos - wz * sin;
      const lz = wx * sin + wz * cos;
      const px = Math.max(-hx, Math.min(hx, lx));
      const pz = Math.max(-hz, Math.min(hz, lz));
      const dlx = lx - px;
      const dlz = lz - pz;
      const d = Math.hypot(dlx, dlz);
      const inside = d === 0;

      if (inside) {
        if (i === 1) {
          // Centre slice over the box: it carries the wheel.
          over = true;
          if (top > bestSupport) {
            bestSupport = top;
            bestBox = box;
            bestH = h;
            ny = 1;
            nx = 0;
            nz = 0;
            hitX = cx;
            hitZ = cz;
            hitY = top;
          }
          continue;
        }
        // Outer slice inside: nearest face gives n and the overlap depth.
        const gx = hx - Math.abs(lx);
        const gz = hz - Math.abs(lz);
        let lnx = 0;
        let lnz = 0;
        let depth: number;
        if (gx < gz) { lnx = lx < 0 ? -1 : 1; depth = gx; } else { lnz = lz < 0 ? -1 : 1; depth = gz; }
        const wnx = lnx * cos + lnz * sin;
        const wnz = -lnx * sin + lnz * cos;
        if (Math.abs(wnx * rx + wnz * rz) < 0.5) {
          if (!centreIn && depth > bestPen) {
            bestPen = depth;
            penBox = box;
            penNx = wnx;
            penNz = wnz;
          }
        } else if (top > bestSupport) {
          bestSupport = top;
          bestBox = box;
          bestH = h;
          nx = 0;
          nz = 0;
          ny = 1;
          hitX = cx + ax * off;
          hitZ = cz + az * off;
          hitY = top;
        }
        continue;
      }

      if (d >= r) continue;
      // Outward face normal (world) from the rectangle point to the slice centre.
      const wnx = (dlx * cos + dlz * sin) / d;
      const wnz = (-dlx * sin + dlz * cos) / d;
      if (Math.abs(wnx * rx + wnz * rz) < 0.5) continue; // lateral: no overlap, no lift
      const s = Math.sqrt(r * r - d * d);
      const support = top + s - r;
      // Below the ground plane the tyre is not yet touching the edge.
      if (support < tyre.groundY || support <= bestSupport) continue;
      bestSupport = support;
      bestBox = box;
      bestH = h;
      const len = Math.hypot(d, s);
      nx = (wnx * d) / len;
      nz = (wnz * d) / len;
      ny = s / len;
      hitX = cx + ax * off - wnx * d;
      hitZ = cz + az * off - wnz * d;
      hitY = top;
    }
  }

  const hasSupport = bestBox !== null;
  if (!hasSupport && penBox === null) return NO_EDGE;

  let state: WheelEdgeContact['state'] = 'touching';
  if (over) state = 'over';
  else if (hasSupport && bestSupport - tyre.groundY >= bestH / 2) state = 'climbing';

  const owner = bestBox ?? penBox!;
  const contact: WheelEdgeContact = {
    colliderId: owner.id,
    kind: owner.kind as 'curb' | 'wheel-stop',
    state,
  };
  return {
    contact,
    supportY: hasSupport ? bestSupport : null,
    normal: hasSupport ? [nx, ny, nz] : null,
    hitPointM: hasSupport ? [hitX, hitY, hitZ] : null,
    lateralPenetrationM: penBox ? bestPen : 0,
    lateralNormal: penBox ? [penNx, 0, penNz] : null,
  };
}
