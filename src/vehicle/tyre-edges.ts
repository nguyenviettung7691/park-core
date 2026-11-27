import type { Vec3Data } from '../contracts';
import type { ColliderBox, WheelEdgeContact } from '../runtime-types';

export const TYRE_HALF_WIDTH_M = 0.1;
/**
 * A rolling slice up to this far beyond first-touch distance still reports 'touching' (no support,
 * no force), so a tyre resting against an edge does not flicker between touching and none.
 */
export const TOUCH_MARGIN_M = 0.005;
/**
 * Slack on the rolled distance that may advance an edge engagement per step (see TyreEdgeHistory):
 * the travel is the tyre centre's, while the leading slice sits up to a half-width off it and turns
 * with yaw, so a genuine roll is allowed 25% more than measured (e then follows the geometry).
 */
export const ENGAGE_TRAVEL_SLACK = 1.25;
/**
 * Below this |face normal . rolling direction| a slice found inside a box with no history counts as
 * sideways intrusion (sidewall against the face), not as a tyre that rolled onto the box.
 */
const LATERAL_ALONG = 0.5;
/** Floor on |n . rollDir| for the face reaction (caps it at about ten times the vertical load). */
const FACE_ALONG_MIN = 0.1;

export interface TyreFrame {
  readonly centerM: Vec3Data;
  readonly rollDir: Vec3Data;
  readonly axleDir: Vec3Data;
  readonly radiusM: number;
  readonly groundY: number;
}

/**
 * Per-wheel memory that makes edge support follow rolling, not steering. For each box near the
 * tyre, the engagement e is the rolling distance (in the tyre's own plane) between the leading slice
 * and the face. Geometry alone gives d / |n . rollDir|, which steering or yaw can shrink in one
 * step; e may only shrink by the distance the tyre actually rolled into the face this step (travel,
 * with ENGAGE_TRAVEL_SLACK) and only grow by the distance travelled away, so a tyre steered or slid
 * into a face rubs it (sidewall push) while a tyre rolling into it with speed rides up gradually.
 */
export interface TyreEdgeHistory {
  /** Engagement per box id from the previous step's `engagement`. */
  readonly engagement: ReadonlyMap<string, number>;
  /** Plan travel of the tyre centre since the previous step. */
  readonly travelM: Vec3Data;
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
   * Face reaction missing from the support normal for an oblique edge: horizontal outward face
   * normal of the supporting box and its magnitude per unit vertical load. With a = |n . rollDir|
   * the support normal pushes back a (e / s) per unit load along the rolling direction, so a^2 (e / s)
   * across the face; height changes with the distance D to the face as (e / s) / a, so the full
   * reaction across the face is that much. The missing part, (e / s)(1 / a - a^2), is zero head-on;
   * the rig applies it inelastically (it stops the tyre moving into the face, never pushes it out).
   */
  readonly faceNormal: Vec3Data | null;
  readonly faceReactionRatio: number;
  /** Engagement to carry to the next step (boxes in reach, or still easing off). */
  readonly engagement: ReadonlyMap<string, number>;
}

const NONE_CONTACT: WheelEdgeContact = Object.freeze({
  colliderId: null, kind: null, state: 'none',
});
const SLICE_OFFSETS = [-TYRE_HALF_WIDTH_M, 0, TYRE_HALF_WIDTH_M] as const;
const ALONG_EPS = 1e-9;

interface BoxEval {
  readonly box: ColliderBox;
  readonly top: number;
  readonly h: number;
  readonly support: number | null;
  readonly over: boolean;
  readonly touching: boolean;
  readonly nx: number;
  readonly nz: number;
  readonly ny: number;
  readonly hitX: number;
  readonly hitZ: number;
  readonly faceNx: number;
  readonly faceNz: number;
  readonly faceRatio: number;
  readonly pen: number;
  readonly penNx: number;
  readonly penNz: number;
}

/**
 * Tyre against curb and wheel-stop boxes. The tyre is three thin discs (slices) across its width.
 * A slice whose plane meets a face at rolling distance e (in its own plane) rides on the edge at
 * top + sqrt(r^2 - e^2) - r, with the corner-to-centre normal in the wheel plane, exactly as a
 * head-on roll at plan distance e. `history` (the rig's per-wheel memory) makes e follow rolling,
 * see TyreEdgeHistory; without it e is the plain geometry (a slice found inside a box across a face
 * nearly parallel to it, other than the centre slice, then counts as sideways intrusion).
 * A slice inside a box that is not carrying the tyre reports a lateral penetration (sidewall push).
 */
export function tyreEdge(
  tyre: TyreFrame,
  edges: readonly ColliderBox[],
  history: TyreEdgeHistory | null = null,
): TyreEdgeResult {
  const r = tyre.radiusM;
  const [cx, , cz] = tyre.centerM;
  const [rx, , rz] = tyre.rollDir;
  const [ax, , az] = tyre.axleDir;
  const engagement = new Map<string, number>();
  let best: BoxEval | null = null;
  let bestPen: BoxEval | null = null;
  let nearest: BoxEval | null = null;

  for (const box of edges) {
    if (box.kind !== 'curb' && box.kind !== 'wheel-stop') continue;
    const top = box.centerM[1] + box.halfExtentsM[1];
    if (tyre.groundY >= top) continue;
    const h = top - tyre.groundY;
    const cos = Math.cos(box.yawRad);
    const sin = Math.sin(box.yawRad);
    const hx = box.halfExtentsM[0];
    const hz = box.halfExtentsM[2];
    // First-touch distance: where the tyre circle reaches the edge corner from the ground.
    const firstTouch = Math.sqrt(Math.max(0, 2 * r * h - h * h));
    const reach = firstTouch + TOUCH_MARGIN_M;

    let minD = Infinity;
    let geomMin = Infinity;
    let geomInit = Infinity;
    let lead = -1;
    let centreIn = false;
    let anyIn = false;
    let pen = 0;
    let penNx = 0;
    let penNz = 0;
    const sx = [0, 0, 0];
    const sz = [0, 0, 0];
    const snx = [0, 0, 0];
    const snz = [0, 0, 0];
    const salong = [0, 0, 0];

    for (let i = 0; i < 3; i += 1) {
      const off = SLICE_OFFSETS[i];
      sx[i] = cx + ax * off;
      sz[i] = cz + az * off;
      const wx = sx[i] - box.centerM[0];
      const wz = sz[i] - box.centerM[2];
      // Local axes in world xz: x -> (cos, -sin), z -> (sin, cos).
      const lx = wx * cos - wz * sin;
      const lz = wx * sin + wz * cos;
      const px = Math.max(-hx, Math.min(hx, lx));
      const pz = Math.max(-hz, Math.min(hz, lz));
      const dlx = lx - px;
      const dlz = lz - pz;
      const d = Math.hypot(dlx, dlz);
      let lnx: number;
      let lnz: number;
      let depth = 0;
      if (d === 0) {
        // Inside: nearest face gives the outward normal and the overlap depth.
        const gx = hx - Math.abs(lx);
        const gz = hz - Math.abs(lz);
        if (gx < gz) { lnx = lx < 0 ? -1 : 1; lnz = 0; depth = gx; } else { lnx = 0; lnz = lz < 0 ? -1 : 1; depth = gz; }
      } else {
        lnx = dlx / d;
        lnz = dlz / d;
      }
      // Outward face normal (world).
      const wnx = lnx * cos + lnz * sin;
      const wnz = -lnx * sin + lnz * cos;
      const along = Math.abs(wnx * rx + wnz * rz);
      snx[i] = wnx;
      snz[i] = wnz;
      salong[i] = along;
      minD = Math.min(minD, d);
      const geom = d === 0 ? 0 : (along > ALONG_EPS ? d / along : Infinity);
      if (d === 0) {
        anyIn = true;
        if (i === 1) centreIn = true;
        if (depth > pen) { pen = depth; penNx = wnx; penNz = wnz; }
      }
      if (geom < geomMin) { geomMin = geom; lead = i; }
      const init = d === 0 && i !== 1 && along < LATERAL_ALONG ? Infinity : geom;
      geomInit = Math.min(geomInit, init);
    }

    const prev = history?.engagement.get(box.id);
    if (minD > reach && (prev === undefined || prev > firstTouch)) continue;

    let e: number;
    if (prev === undefined) {
      e = geomInit;
    } else if (geomMin < prev) {
      // Approach: only rolling into the face (not steering, yaw or sliding) advances e.
      const [tx, , tz] = history!.travelM;
      const towards = rx * -snx[lead] + rz * -snz[lead] >= 0 ? 1 : -1;
      const rolled = Math.max(0, (tx * rx + tz * rz) * towards);
      const along = Math.max(salong[lead], ALONG_EPS);
      const into = Math.max(0, -(tx * snx[lead] + tz * snz[lead]));
      e = Math.max(geomMin, prev - ENGAGE_TRAVEL_SLACK * Math.min(rolled, into / along));
    } else {
      // Retreat: ease off no faster than the tyre travels.
      const [tx, , tz] = history!.travelM;
      e = Math.min(geomMin, prev + ENGAGE_TRAVEL_SLACK * Math.hypot(tx, tz));
    }
    // Beyond reach e only delays: hold it there, so a tyre that came alongside (geometry far
    // beyond reach) and then rolls into the face engages after the same rolled distance as head-on.
    e = Math.min(e, reach);
    if (history && (minD <= reach || e <= firstTouch)) engagement.set(box.id, e);

    const carried = e <= 0;
    const touching = anyIn || geomMin <= reach || e <= firstTouch;
    let support: number | null = null;
    let nx = 0;
    let ny = 1;
    let nz = 0;
    let hitX = cx;
    let hitZ = cz;
    let faceRatio = 0;
    if (carried && centreIn) {
      support = top;
    } else if (e <= firstTouch && lead >= 0) {
      const s = Math.sqrt(r * r - e * e);
      const y = top + s - r;
      // Below the ground plane the tyre is not yet touching the edge.
      if (y >= tyre.groundY) {
        support = y;
        // Rolling direction toward the face, in the wheel plane.
        const towards = rx * -snx[lead] + rz * -snz[lead] >= 0 ? 1 : -1;
        // Corner-to-centre normal in the wheel plane, its horizontal part scaled by |n . rollDir|:
        // full head-on, fading for a graze so that a tyre brushing a face it barely meets does not
        // brake the car along it (the face reaction below carries the push across the face).
        const he = e * salong[lead];
        const len = Math.hypot(he, s);
        nx = (-rx * towards * he) / len;
        nz = (-rz * towards * he) / len;
        ny = s / len;
        hitX = sx[lead] + rx * towards * e;
        hitZ = sz[lead] + rz * towards * e;
        const along = Math.max(salong[lead], FACE_ALONG_MIN);
        faceRatio = (e / s) * Math.max(0, 1 / along - salong[lead] * salong[lead]);
      }
    }
    if (!touching && support === null) continue;
    const ev: BoxEval = {
      box, top, h, support, over: carried && centreIn, touching, nx, ny, nz, hitX, hitZ,
      faceNx: lead >= 0 ? snx[lead] : 0, faceNz: lead >= 0 ? snz[lead] : 0, faceRatio,
      pen: carried ? 0 : pen, penNx, penNz,
    };
    if (support !== null && (best === null || support > best.support!)) best = ev;
    if (ev.pen > 0 && (bestPen === null || ev.pen > bestPen.pen)) bestPen = ev;
    nearest ??= ev;
  }

  const owner = best ?? bestPen ?? nearest;
  if (owner === null) {
    return {
      contact: NONE_CONTACT, supportY: null, normal: null, hitPointM: null,
      lateralPenetrationM: 0, lateralNormal: null, lateralColliderId: null,
      faceNormal: null, faceReactionRatio: 0, engagement,
    };
  }
  let state: WheelEdgeContact['state'] = 'touching';
  if (owner.over) state = 'over';
  else if (owner.support !== null && owner.support - tyre.groundY >= owner.h / 2) state = 'climbing';
  const contact: WheelEdgeContact = {
    colliderId: owner.box.id,
    kind: owner.box.kind as 'curb' | 'wheel-stop',
    state,
  };
  const sup = best;
  return {
    contact,
    supportY: sup ? sup.support : null,
    normal: sup ? [sup.nx, sup.ny, sup.nz] : null,
    hitPointM: sup ? [sup.hitX, sup.top, sup.hitZ] : null,
    lateralPenetrationM: bestPen ? bestPen.pen : 0,
    lateralNormal: bestPen ? [bestPen.penNx, 0, bestPen.penNz] : null,
    lateralColliderId: bestPen ? bestPen.box.id : null,
    faceNormal: sup && sup.faceRatio > 0 ? [sup.faceNx, 0, sup.faceNz] : null,
    faceReactionRatio: sup ? sup.faceRatio : 0,
    engagement,
  };
}
