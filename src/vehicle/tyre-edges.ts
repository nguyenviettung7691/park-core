import type { Vec3Data } from '../contracts';
import type { ColliderBox, WheelEdgeContact } from '../runtime-types';

export const TYRE_HALF_WIDTH_M = 0.1;
/**
 * A rolling slice up to this far beyond first-touch distance still reports 'touching' (no support,
 * no force), so a tyre resting against an edge does not flicker between touching and none.
 */
export const TOUCH_MARGIN_M = 0.005;

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
  /** The box the lateral penetration is against (null without one). */
  readonly lateralColliderId: string | null;
  /**
   * Nearest box with a slice within first-touch reach (or overlapping it) across a face classed
   * lateral, and no rolling contact from that box this call: the wheel is alongside it, not rolling
   * into it. The rig latches it as `lateralOnlyId` (null without one).
   */
  readonly lateralReachColliderId: string | null;
  /** The `lateralOnlyId` box has a slice within first-touch reach (or overlapping it). */
  readonly lateralOnlyInReach: boolean;
}

const NONE_CONTACT: WheelEdgeContact = Object.freeze({
  colliderId: null, kind: null, state: 'none',
});
const NO_EDGE: TyreEdgeResult = Object.freeze({
  contact: NONE_CONTACT, supportY: null, normal: null, hitPointM: null,
  lateralPenetrationM: 0, lateralNormal: null, lateralColliderId: null,
  lateralReachColliderId: null, lateralOnlyInReach: false,
});
const SLICE_OFFSETS = [-TYRE_HALF_WIDTH_M, 0, TYRE_HALF_WIDTH_M] as const;
const EPS = 1e-9;

/**
 * `lateralOnlyId`: a box whose faces count as lateral (sidewall push, no lift) at any angle. The rig
 * passes the box a wheel is already alongside (see lateralReachColliderId), so steering or yawing
 * toward its face cannot reclassify it as a deep rolling contact and lift the tyre in one step.
 * Against that box a slice reports 'touching' (no support, no force) once the tyre's plan footprint
 * at the box's height reaches the face: d <= (first touch + margin) * |n . rollDir|.
 */
export function tyreEdge(
  tyre: TyreFrame,
  edges: readonly ColliderBox[],
  lateralOnlyId: string | null = null,
): TyreEdgeResult {
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
  let nearBox: ColliderBox | null = null;
  let nearGap = Infinity;
  let latBox: ColliderBox | null = null;
  let latD = Infinity;
  let lateralOnlyInReach = false;

  for (const box of edges) {
    if (box.kind !== 'curb' && box.kind !== 'wheel-stop') continue;
    const top = box.centerM[1] + box.halfExtentsM[1];
    if (tyre.groundY >= top) continue;
    const lateralOnly = box.id === lateralOnlyId;
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
    // First-touch distance: where the tyre circle reaches the edge corner from the ground.
    const firstTouch = Math.sqrt(Math.max(0, 2 * r * h - h * h));
    let boxRolling = false;
    let boxLatD = Infinity;
    let boxInReach = false;

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
        boxInReach = true;
        if (i === 1) {
          // Centre slice over the box: it carries the wheel.
          over = true;
          boxRolling = true;
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
        if (lateralOnly || Math.abs(wnx * rx + wnz * rz) < 0.5) {
          boxLatD = 0;
          if (!centreIn && depth > bestPen) {
            bestPen = depth;
            penBox = box;
            penNx = wnx;
            penNz = wnz;
          }
        } else {
          boxRolling = true;
          if (top > bestSupport) {
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
        }
        continue;
      }

      if (d > firstTouch + TOUCH_MARGIN_M) continue;
      boxInReach = true;
      // Outward face normal (world) from the rectangle point to the slice centre.
      const wnx = (dlx * cos + dlz * sin) / d;
      const wnz = (-dlx * sin + dlz * cos) / d;
      const along = Math.abs(wnx * rx + wnz * rz);
      if (lateralOnly || along < 0.5) {
        // Lateral: no lift. Alongside the face, within reach of rolling onto it.
        boxLatD = Math.min(boxLatD, d);
        const reach = (firstTouch + TOUCH_MARGIN_M) * along;
        if (lateralOnly && d <= reach && d - reach < nearGap) {
          // Steered/yawed tyre footprint against the face: rubbing it, no support or force.
          nearGap = d - reach;
          nearBox = box;
        }
        continue;
      }
      boxRolling = true;
      if (d > firstTouch) {
        if (d - firstTouch < nearGap) {
          nearGap = d - firstTouch;
          nearBox = box;
        }
        continue;
      }
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
    if (lateralOnly && boxInReach) lateralOnlyInReach = true;
    if (!boxRolling && boxLatD < latD) {
      latD = boxLatD;
      latBox = box;
    }
  }

  const hasSupport = bestBox !== null;
  if (!hasSupport && penBox === null && nearBox === null) {
    if (latBox === null && !lateralOnlyInReach) return NO_EDGE;
    return {
      ...NO_EDGE, lateralReachColliderId: latBox?.id ?? null, lateralOnlyInReach,
    };
  }

  let state: WheelEdgeContact['state'] = 'touching';
  if (over) state = 'over';
  else if (hasSupport && bestSupport - tyre.groundY >= bestH / 2) state = 'climbing';

  const owner = bestBox ?? penBox ?? nearBox!;
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
    lateralColliderId: penBox ? penBox.id : null,
    lateralReachColliderId: latBox?.id ?? null,
    lateralOnlyInReach,
  };
}
