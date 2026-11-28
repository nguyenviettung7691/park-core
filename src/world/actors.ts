import type {
  ActorDefinition,
  ActorKind,
  ActorRules,
  ActorSchedule,
  ActorTrigger,
  Gear,
  GroundPoint,
  Indicator,
  StageId,
  Vec3Data,
} from '../contracts';
import { orientedRectangle, polygonsOverlap } from './footprint';

const MOVING_SPEED_MPS = 0.2;
const FIRST_STOP_DWELL_S = 0.5;
const TIME_EPSILON_S = 1e-9;
const SWEEP_STEP_M = 0.05;
const STOPPED_SPEED_MPS = 0.05;
const OTHER_HORIZON_S = 1.5;
const OTHER_SAMPLE_M = 0.5;
/** How far past its projection another actor's path counts as \"its path\" for the keep-clearing rule. */
const OTHER_PATH_MARGIN_M = 3;
const DETOUR_MIN_TRANSITION_M = 2;
/** Side-steps never yaw the actor more than this. */
const DETOUR_MAX_YAW_RAD = Math.PI / 9;

export const PEDESTRIAN_STOP_DISTANCE_M = 0.5;
export const CAR_DECEL_MPS2 = 6;
export const LOOKAHEAD_MARGIN_M = { pedestrian: 0.5, car: 1.0 } as const;
export const COACH_GAP_M = 0.3;
export const BLOCKED_WAIT_S = 3;
/**
 * Free drive: while an actor is stopped, a learner that has moved less than this since the hold
 * began counts as stationary for the BLOCKED_WAIT_S timer, whatever its reported speed (a
 * creeping or rocking learner cannot hold an actor forever).
 */
export const HOLD_DISPLACEMENT_M = 1;
/** Free drive: an ambient start waits while the learner overlaps this much of the start of its path. */
export const START_CLEAR_M = 3;
/** Free-drive cap: an ambient start waits while this many ambient actors are visible. */
export const MAX_AMBIENT_ACTIVE = 3;
/** Corridor must stay clear this long before a new encounter can record another near miss. */
export const NEAR_MISS_REARM_S = 1;
export const LESSON_LIFETIME_S = 15;
export const ACCEL_MPS2 = { pedestrian: 1, car: 2 } as const;

export interface LearnerState {
  readonly footprint: readonly Vec3Data[];
  readonly headingRad: number;
  readonly signedSpeedMps: number;
  readonly gear: Gear;
  readonly parkingBrake: boolean;
  readonly indicator: Indicator;
}

export interface ActorPose {
  readonly id: string;
  readonly kind: ActorKind;
  readonly visible: boolean;
  readonly positionM: Vec3Data;
  readonly yawRad: number;
  readonly braking: boolean;
  readonly strideM: number;
}

export interface ActorBox {
  readonly id: string;
  readonly centerM: Vec3Data;
  readonly halfExtentsM: Vec3Data;
  readonly yawRad: number;
}

interface ActorCursor {
  readonly distanceM: number;
  readonly speedMps: number;
  /** Simulation time the actor appeared, or null while it is waiting. */
  readonly activeSinceS: number | null;
  readonly finished: boolean;
  /** Ambient repeat index of the current appearance; -1 before the first. */
  readonly cycle: number;
  /** Lesson entries only: simulation time the trigger fired. */
  readonly triggeredAtS: number | null;
  /** True while the actor is braking for the learner. */
  readonly braking: boolean;
  /** True from the first braking of an encounter until the corridor has been clear for NEAR_MISS_REARM_S. */
  readonly encounterLatched: boolean;
  /** Continuous time the corridor has been clear while latched. */
  readonly clearS: number;
  /** Continuous time stopped by a stationary learner. */
  readonly blockedS: number;
  /** Path taken after being blocked; null while on the scheduled path. */
  readonly detour: PathGeometry | null;
  /** Distance walked on earlier paths, so strides stay continuous. */
  readonly strideBaseM: number;
  /** True while braking for the learner (not for another actor); lets earlier actors yield to it. */
  readonly learnerHeld: boolean;
  /** Free drive: learner footprint centre when this hold (actor stopped) began; null while moving. */
  readonly holdAnchorM: GroundPoint | null;
}

interface PathGeometry {
  readonly points: readonly GroundPoint[];
  readonly cumulativeM: readonly number[];
  readonly lengthM: number;
}

export interface ActorWorldState {
  readonly schedule: ActorSchedule;
  readonly rules: ActorRules;
  readonly forceTriggersAtS: number | null;
  readonly paths: readonly PathGeometry[];
  /** apart[i * n + j]: the scheduled paths of entries i and j can never bring their boxes together. */
  readonly apart: readonly boolean[];
  readonly stepCount: number;
  readonly timeS: number;
  readonly cursors: readonly ActorCursor[];
  readonly previous: LearnerState | null;
  readonly hasMoved: boolean;
  readonly slowSteps: number;
}

export interface ActorStepResult {
  readonly state: ActorWorldState;
  readonly contactId: string | null;
  readonly nearMissIds: readonly string[];
}

export function rulesForStage(stageId: StageId): ActorRules {
  return stageId <= 2 ? 'coach' : 'realistic';
}

function definitionOf(schedule: ActorSchedule, index: number): ActorDefinition {
  return schedule.entries[index].actor;
}

function buildPath(points: readonly GroundPoint[]): PathGeometry {
  if (points.length < 2) throw new Error('Actor path needs at least two points');
  const cumulativeM = [0];
  for (let i = 1; i < points.length; i += 1) {
    cumulativeM.push(cumulativeM[i - 1] + Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1],
    ));
  }
  return { points, cumulativeM, lengthM: cumulativeM[cumulativeM.length - 1] };
}

function freezeState(state: ActorWorldState): ActorWorldState {
  for (const cursor of state.cursors) Object.freeze(cursor);
  Object.freeze(state.cursors);
  return Object.freeze(state);
}

const idleCursor: ActorCursor = {
  distanceM: 0,
  speedMps: 0,
  activeSinceS: null,
  finished: false,
  cycle: -1,
  triggeredAtS: null,
  braking: false,
  encounterLatched: false,
  clearS: 0,
  blockedS: 0,
  detour: null,
  strideBaseM: 0,
  learnerHeld: false,
  holdAnchorM: null,
};

function activate(cursor: ActorCursor, definition: ActorDefinition, timeS: number,
  cycle: number): ActorCursor {
  return {
    ...cursor,
    distanceM: 0,
    speedMps: definition.cruiseMps,
    activeSinceS: timeS,
    finished: false,
    cycle,
    braking: false,
    encounterLatched: false,
    clearS: 0,
    blockedS: 0,
    detour: null,
    strideBaseM: 0,
    learnerHeld: false,
    holdAnchorM: null,
  };
}

/**
 * Starts every actor whose scheduled appearance time has been reached. `before`: the cursors at
 * the start of this step (null at creation, when there is no learner either); otherwise the
 * learner scratch holds this step's learner.
 */
const spawnBox = new Float64Array(8);
const spawnBounds = new Float64Array(4);

function spawnClear(state: ActorWorldState, cursors: readonly ActorCursor[], index: number): boolean {
  const definition = definitionOf(state.schedule, index);
  const path = state.paths[index];
  if (corridorBlocked(definition, path, 0, START_CLEAR_M,
    learnerScratch.points, 0, learnerScratch.count, learnerScratch.bounds)) return false;
  return cursors.every((cursor, other) => {
    if (other === index || !isVisible(cursor)) return true;
    writeBox(spawnBox, 0, definitionOf(state.schedule, other), pathOf(state, other, cursor),
      cursor.distanceM, 0);
    writeBounds(spawnBounds, spawnBox, 0, 4);
    return !corridorBlocked(definition, path, 0, START_CLEAR_M, spawnBox, 0, 4, spawnBounds);
  });
}

function startDueActors(state: ActorWorldState, cursors: ActorCursor[],
  before: readonly ActorCursor[] | null): void {
  const { schedule, timeS } = state;
  if (schedule.kind === 'lesson') {
    schedule.entries.forEach((entry, index) => {
      const cursor = cursors[index];
      if (cursor.activeSinceS !== null || cursor.triggeredAtS === null) return;
      const startS = cursor.triggeredAtS + entry.delayS;
      if (timeS >= startS - TIME_EPSILON_S) {
        cursors[index] = activate(cursor, entry.actor, timeS, 0);
      }
    });
    return;
  }
  schedule.entries.forEach((entry, index) => {
    if (timeS < entry.startS - TIME_EPSILON_S) return;
    const cycle = Math.floor((timeS - entry.startS) / entry.periodS + TIME_EPSILON_S);
    if (cycle > cursors[index].cycle) {
      // Never restart an actor that is (or was, at the start of this step) still visible: its
      // appearance for this cycle waits until it has finished and been hidden for a step. Only the
      // latest due cycle starts, so an appearance deferred past its period is skipped.
      if (isVisible(cursors[index]) || (before !== null && isVisible(before[index]))) return;
      // Free-drive cap: stay hidden (and retry next step) while the cap is already reached.
      if (cursors.filter(isVisible).length >= MAX_AMBIENT_ACTIVE) return;
      // Spawn clear: same retry while the learner or another visible actor sits on the first
      // START_CLEAR_M of the path.
      if (before !== null && !spawnClear(state, cursors, index)) return;
      cursors[index] = activate(cursors[index], entry.actor, timeS, cycle);
    }
  });
}

export function createActorWorld(
  schedule: ActorSchedule,
  rules: ActorRules,
  options: { readonly forceTriggersAtS?: number } = {},
): ActorWorldState {
  const forceS = options.forceTriggersAtS ?? null;
  const cursors: ActorCursor[] = schedule.entries.map(() => ({
    ...idleCursor,
    triggeredAtS: schedule.kind === 'lesson' ? forceS : null,
  }));
  const state: ActorWorldState = {
    schedule,
    rules,
    forceTriggersAtS: forceS,
    paths: schedule.entries.map((entry) => buildPath(entry.actor.path)),
    apart: Object.freeze(schedule.entries.flatMap((a, i) => schedule.entries.map((b, j) =>
      i !== j && pathsApart(a.actor, b.actor)))),
    stepCount: 0,
    timeS: 0,
    cursors,
    previous: null,
    hasMoved: false,
    slowSteps: 0,
  };
  startDueActors(state, cursors, null);
  return freezeState(state);
}

function triggerFired(
  trigger: ActorTrigger,
  learner: LearnerState,
  previous: LearnerState | null,
  firstStop: boolean,
): boolean {
  switch (trigger) {
    case 'moving-off':
      return (learner.gear === 'D' || learner.gear === 'R')
        && !learner.parkingBrake
        && Math.abs(learner.signedSpeedMps) > MOVING_SPEED_MPS;
    case 'reverse-selected':
      return learner.gear === 'R' && previous?.gear !== 'R';
    case 'indicator-left':
      return learner.indicator === 'left' && previous?.indicator !== 'left';
    case 'indicator-right':
      return learner.indicator === 'right' && previous?.indicator !== 'right';
    case 'first-stop':
      return firstStop;
  }
}

function pathOf(state: ActorWorldState, index: number, cursor: ActorCursor): PathGeometry {
  return cursor.detour ?? state.paths[index];
}

// ---- Non-allocating geometry. Bit-identical to orientedRectangle + polygonsOverlap: the same
// corner arithmetic, the same separating axes (edges of the concatenated point list) and the
// same 1e-8 tolerance; only the storage differs (flat x,z pairs in Float64Arrays). ----

/** pointAlong results, written by locate() (avoids an object per sample). */
let atX = 0;
let atZ = 0;
let atYaw = 0;

function locate(path: PathGeometry, distanceM: number): void {
  const clamped = Math.min(Math.max(distanceM, 0), path.lengthM);
  let segment = path.points.length - 2;
  for (let i = 1; i < path.points.length; i += 1) {
    if (clamped <= path.cumulativeM[i]) { segment = i - 1; break; }
  }
  const [x0, z0] = path.points[segment];
  const [x1, z1] = path.points[segment + 1];
  const length = path.cumulativeM[segment + 1] - path.cumulativeM[segment];
  const t = length > 0 ? (clamped - path.cumulativeM[segment]) / length : 0;
  // Local -z faces travel, matching the vehicle convention (yaw 0 faces -z).
  atX = x0 + (x1 - x0) * t;
  atZ = z0 + (z1 - z0) * t;
  atYaw = Math.atan2(0 - (x1 - x0), 0 - (z1 - z0)); // 0 - avoids -0 flipping pi sign
}

/** Writes the 4 corners (x,z) of the actor's box at distanceM into out[offset..offset+8). */
function writeBox(
  out: Float64Array,
  offset: number,
  definition: ActorDefinition,
  path: PathGeometry,
  distanceM: number,
  inflateM: number,
): void {
  locate(path, distanceM);
  const halfWidthM = definition.halfExtentsM[0] + inflateM;
  const halfLengthM = definition.halfExtentsM[2] + inflateM;
  const cos = Math.cos(atYaw), sin = Math.sin(atYaw);
  const nw = -halfWidthM, nl = -halfLengthM;
  out[offset] = atX + cos * nw + sin * nl;
  out[offset + 1] = atZ - sin * nw + cos * nl;
  out[offset + 2] = atX + cos * halfWidthM + sin * nl;
  out[offset + 3] = atZ - sin * halfWidthM + cos * nl;
  out[offset + 4] = atX + cos * halfWidthM + sin * halfLengthM;
  out[offset + 5] = atZ - sin * halfWidthM + cos * halfLengthM;
  out[offset + 6] = atX + cos * nw + sin * halfLengthM;
  out[offset + 7] = atZ - sin * nw + cos * halfLengthM;
}

function pointX(a: Float64Array, aOff: number, aN: number, b: Float64Array, bOff: number,
  k: number): number {
  return k < aN ? a[aOff + 2 * k] : b[bOff + 2 * (k - aN)];
}

function pointZ(a: Float64Array, aOff: number, aN: number, b: Float64Array, bOff: number,
  k: number): number {
  return k < aN ? a[aOff + 2 * k + 1] : b[bOff + 2 * (k - aN) + 1];
}

/** polygonsOverlap on flat polygons of aN and bN points. */
function flatOverlap(
  a: Float64Array, aOff: number, aN: number,
  b: Float64Array, bOff: number, bN: number,
): boolean {
  const n = aN + bN;
  for (let k = 0; k < n; k += 1) {
    const m = (k + 1) % n;
    const px = pointX(a, aOff, aN, b, bOff, k), pz = pointZ(a, aOff, aN, b, bOff, k);
    const nx = pointX(a, aOff, aN, b, bOff, m), nz = pointZ(a, aOff, aN, b, bOff, m);
    const axisX = -(nz - pz), axisZ = nx - px;
    let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
    for (let i = 0; i < aN; i += 1) {
      const v = a[aOff + 2 * i] * axisX + a[aOff + 2 * i + 1] * axisZ;
      if (v < aMin) aMin = v;
      if (v > aMax) aMax = v;
    }
    for (let i = 0; i < bN; i += 1) {
      const v = b[bOff + 2 * i] * axisX + b[bOff + 2 * i + 1] * axisZ;
      if (v < bMin) bMin = v;
      if (v > bMax) bMax = v;
    }
    if (!(aMax >= bMin - 1e-8 && bMax >= aMin - 1e-8)) return false;
  }
  return true;
}

/** Axis-aligned bounds [minX, minZ, maxX, maxZ] of `count` points (cheap pre-reject only). */
function writeBounds(out: Float64Array, points: Float64Array, offset: number, count: number): void {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const x = points[offset + 2 * i], z = points[offset + 2 * i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  out[0] = minX; out[1] = minZ; out[2] = maxX; out[3] = maxZ;
}

/** Bounds slack: far above rounding, far below any meaningful gap. */
const BOUNDS_SLACK_M = 1e-3;

function boundsApart(a: Float64Array, aOff: number, b: Float64Array, bOff: number): boolean {
  return a[aOff] > b[bOff + 2] + BOUNDS_SLACK_M || b[bOff] > a[aOff + 2] + BOUNDS_SLACK_M
    || a[aOff + 1] > b[bOff + 3] + BOUNDS_SLACK_M || b[bOff + 1] > a[aOff + 3] + BOUNDS_SLACK_M;
}

/** Conservative bounds of every box centred on the path between fromM and toM. */
function writeCorridorBounds(
  out: Float64Array,
  definition: ActorDefinition,
  path: PathGeometry,
  fromM: number,
  toM: number,
  inflateM: number,
): void {
  const radiusM = Math.hypot(definition.halfExtentsM[0] + inflateM,
    definition.halfExtentsM[2] + inflateM);
  locate(path, fromM);
  let minX = atX, maxX = atX, minZ = atZ, maxZ = atZ;
  locate(path, toM);
  minX = Math.min(minX, atX); maxX = Math.max(maxX, atX);
  minZ = Math.min(minZ, atZ); maxZ = Math.max(maxZ, atZ);
  for (let i = 1; i < path.points.length - 1; i += 1) {
    if (path.cumulativeM[i] <= fromM || path.cumulativeM[i] >= toM) continue;
    const [x, z] = path.points[i];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  out[0] = minX - radiusM; out[1] = minZ - radiusM;
  out[2] = maxX + radiusM; out[3] = maxZ + radiusM;
}

const boxScratch = new Float64Array(8);
const learnerScratch = {
  points: new Float64Array(8), count: 0, bounds: new Float64Array(4), centerX: 0, centerZ: 0,
};
const corridorBoundsScratch = new Float64Array(4);

function loadLearner(learner: LearnerState): void {
  const count = learner.footprint.length;
  if (learnerScratch.points.length < 2 * count) learnerScratch.points = new Float64Array(2 * count);
  learner.footprint.forEach((point, i) => {
    learnerScratch.points[2 * i] = point[0];
    learnerScratch.points[2 * i + 1] = point[2];
  });
  learnerScratch.count = count;
  let sumX = 0, sumZ = 0;
  for (const point of learner.footprint) { sumX += point[0]; sumZ += point[2]; }
  learnerScratch.centerX = sumX / count;
  learnerScratch.centerZ = sumZ / count;
  writeBounds(learnerScratch.bounds, learnerScratch.points, 0, count);
}

/** The loaded learner footprint overlaps the actor's box at distanceM. */
function overlapsLearner(
  definition: ActorDefinition,
  path: PathGeometry,
  distanceM: number,
  inflateM: number,
): boolean {
  writeBox(boxScratch, 0, definition, path, distanceM, inflateM);
  return flatOverlap(boxScratch, 0, 4, learnerScratch.points, 0, learnerScratch.count);
}

/** Sweeps the actor's box along its path every SWEEP_STEP_M (first sample fromM, last the end). */
function corridorBlocked(
  definition: ActorDefinition,
  path: PathGeometry,
  fromM: number,
  toM: number,
  target: Float64Array,
  targetOffset: number,
  targetCount: number,
  targetBounds: Float64Array,
): boolean {
  const end = Math.min(toM, path.lengthM);
  writeCorridorBounds(corridorBoundsScratch, definition, path, fromM, Math.max(end, fromM), 0);
  if (boundsApart(corridorBoundsScratch, 0, targetBounds, 0)) return false;
  for (let distanceM = fromM; distanceM < end; distanceM += SWEEP_STEP_M) {
    writeBox(boxScratch, 0, definition, path, distanceM, 0);
    if (flatOverlap(boxScratch, 0, 4, target, targetOffset, targetCount)) return true;
  }
  writeBox(boxScratch, 0, definition, path, Math.max(end, fromM), 0);
  return flatOverlap(boxScratch, 0, 4, target, targetOffset, targetCount);
}

/**
 * One visible actor this step, as seen by the others (only built when 2 or more are visible).
 * Box lists are flat: box k occupies [8k, 8k+8). Scratch storage is reused across steps.
 */
interface ActorFrame {
  index: number;
  definition: ActorDefinition;
  path: PathGeometry;
  distanceM: number;
  aheadM: number;
  /** Held by the learner or already leaving on a detour: it will not yield, so others do. */
  committed: boolean;
  onDetour: boolean;
  /** Box 0: current box. Boxes 1..projectionEnd-1: next OTHER_HORIZON_S at its current speed
   * (sampled every OTHER_SAMPLE_M, then the end of the horizon, box `reachBox`, or -1).
   * Boxes 0..pathEnd-1 except reachBox: its path ahead (OTHER_PATH_MARGIN_M past the horizon). */
  boxes: Float64Array;
  reachBox: number;
  projectionEnd: number;
  pathEnd: number;
  /** Bounds of each box (4 per box) and of all of them (`sweepBounds`). */
  boxBounds: Float64Array;
  sweepBounds: Float64Array;
  /** Own corridor (Rule 1 samples), built on first use this step. */
  corridor: Float64Array;
  corridorCount: number;
  corridorBounds: Float64Array;
  corridorBuilt: boolean;
}

const framePool: ActorFrame[] = [];

function frameAt(slot: number): ActorFrame {
  framePool[slot] ??= {
    index: 0, definition: undefined as unknown as ActorDefinition,
    path: undefined as unknown as PathGeometry, distanceM: 0, aheadM: 0, committed: false,
    onDetour: false, boxes: new Float64Array(8 * 32), reachBox: -1, projectionEnd: 0, pathEnd: 0,
    boxBounds: new Float64Array(4 * 32), sweepBounds: new Float64Array(4),
    corridor: new Float64Array(8 * 96), corridorCount: 0, corridorBounds: new Float64Array(4),
    corridorBuilt: false,
  };
  return framePool[slot];
}

function aheadOf(definition: ActorDefinition, cursor: ActorCursor): number {
  const stopM = (cursor.speedMps * cursor.speedMps) / (2 * decelOf(definition));
  return cursor.distanceM + stopM + LOOKAHEAD_MARGIN_M[definition.kind];
}

function pushBox(frame: ActorFrame, count: number, distanceM: number): number {
  if (frame.boxes.length < 8 * (count + 1)) {
    const grown = new Float64Array(frame.boxes.length * 2);
    grown.set(frame.boxes);
    frame.boxes = grown;
    const bounds = new Float64Array(frame.boxBounds.length * 2);
    bounds.set(frame.boxBounds);
    frame.boxBounds = bounds;
  }
  writeBox(frame.boxes, 8 * count, frame.definition, frame.path, distanceM, 0);
  writeBounds(boxScratch, frame.boxes, 8 * count, 4);
  frame.boxBounds.set(boxScratch.subarray(0, 4), 4 * count);
  return count + 1;
}

/** Frames of the visible actors, by schedule index (empty unless 2 or more are visible). */
function actorFrames(state: ActorWorldState): readonly (ActorFrame | undefined)[] {
  const frames: (ActorFrame | undefined)[] = [];
  let visible = 0;
  for (const cursor of state.cursors) if (isVisible(cursor)) visible += 1;
  if (visible < 2) return frames;
  let slot = 0;
  state.cursors.forEach((cursor, index) => {
    if (!isVisible(cursor)) return;
    const frame = frameAt(slot);
    slot += 1;
    frame.index = index;
    frame.definition = definitionOf(state.schedule, index);
    frame.path = pathOf(state, index, cursor);
    frame.distanceM = cursor.distanceM;
    frame.aheadM = aheadOf(frame.definition, cursor);
    frame.committed = cursor.learnerHeld || cursor.detour !== null;
    frame.onDetour = cursor.detour !== null;
    frame.corridorBuilt = false;
    const { path } = frame;
    const reachM = Math.min(path.lengthM, cursor.distanceM + cursor.speedMps * OTHER_HORIZON_S);
    let count = pushBox(frame, 0, cursor.distanceM);
    for (let at = cursor.distanceM + OTHER_SAMPLE_M; at < reachM; at += OTHER_SAMPLE_M) {
      count = pushBox(frame, count, at);
    }
    frame.reachBox = -1;
    if (reachM > cursor.distanceM) { frame.reachBox = count; count = pushBox(frame, count, reachM); }
    frame.projectionEnd = count;
    // Path ahead: the projection boxes, then on to OTHER_PATH_MARGIN_M past it.
    const pathEndM = Math.min(path.lengthM, reachM + OTHER_PATH_MARGIN_M);
    let at = cursor.distanceM + OTHER_SAMPLE_M;
    while (at < reachM) at += OTHER_SAMPLE_M;
    for (; at < pathEndM; at += OTHER_SAMPLE_M) count = pushBox(frame, count, at);
    count = pushBox(frame, count, pathEndM);
    frame.pathEnd = count;
    writeBounds(frame.sweepBounds, frame.boxes, 0, 4 * count);
    frames[index] = frame;
  });
  return frames;
}

/** Builds the frame's own Rule 1 corridor boxes (same samples as corridorBlocked) once per step. */
function ensureCorridor(frame: ActorFrame): void {
  if (frame.corridorBuilt) return;
  const { definition, path, distanceM: fromM } = frame;
  const end = Math.min(frame.aheadM, path.lengthM);
  let count = 0;
  const add = (distanceM: number) => {
    if (frame.corridor.length < 8 * (count + 1)) {
      const grown = new Float64Array(frame.corridor.length * 2);
      grown.set(frame.corridor);
      frame.corridor = grown;
    }
    writeBox(frame.corridor, 8 * count, definition, path, distanceM, 0);
    count += 1;
  };
  for (let distanceM = fromM; distanceM < end; distanceM += SWEEP_STEP_M) add(distanceM);
  add(Math.max(end, fromM));
  frame.corridorCount = count;
  writeBounds(frame.corridorBounds, frame.corridor, 0, 4 * count);
  frame.corridorBuilt = true;
}

/** The frame's corridor meets the other frame's box k. */
function corridorMeets(frame: ActorFrame, other: ActorFrame, k: number): boolean {
  if (boundsApart(frame.corridorBounds, 0, other.boxBounds, 4 * k)) return false;
  for (let c = 0; c < frame.corridorCount; c += 1) {
    if (flatOverlap(frame.corridor, 8 * c, 4, other.boxes, 8 * k, 4)) return true;
  }
  return false;
}

/** Static: the two scheduled paths' swept boxes can never touch (computed once per world). */
function pathsApart(a: ActorDefinition, b: ActorDefinition): boolean {
  const slabs = (definition: ActorDefinition) => definition.path.slice(1).map((to, i) => {
    const from = definition.path[i];
    const lengthM = Math.hypot(to[0] - from[0], to[1] - from[1]);
    return orientedRectangle(
      [(from[0] + to[0]) / 2, 0, (from[1] + to[1]) / 2],
      definition.halfExtentsM[0] + PATHS_APART_SLACK_M,
      lengthM / 2 + definition.halfExtentsM[2] + PATHS_APART_SLACK_M,
      Math.atan2(0 - (to[0] - from[0]), 0 - (to[1] - from[1])),
    );
  });
  const bSlabs = slabs(b);
  return slabs(a).every((slab) => bSlabs.every((other) => !polygonsOverlap(slab, other)));
}

const PATHS_APART_SLACK_M = 0.05;

function decelOf(definition: ActorDefinition): number {
  return definition.kind === 'car'
    ? CAR_DECEL_MPS2
    : (definition.cruiseMps * definition.cruiseMps) / (2 * PEDESTRIAN_STOP_DISTANCE_M);
}

/** The path walked so far, reversed, starting at the current position. */
function turnBackPath(path: PathGeometry, distanceM: number): PathGeometry {
  const here = pointAlong(path, distanceM);
  const walked: GroundPoint[] = [[here.x, here.z]];
  for (let i = path.points.length - 1; i >= 0; i -= 1) {
    if (path.cumulativeM[i] < distanceM - 1e-9) walked.push(path.points[i]);
  }
  if (walked.length < 2) walked.push([here.x, here.z]);
  return buildPath(walked);
}

/** The remaining path shifted to the left of travel, after a short transition. */
function offsetPath(path: PathGeometry, distanceM: number, lateralM: number): PathGeometry {
  const shifted = (at: number): GroundPoint => {
    const p = pointAlong(path, at);
    // Heading (dx, dz) = (-sin yaw, -cos yaw); left of travel is (dz, -dx).
    return [p.x - Math.cos(p.yawRad) * lateralM, p.z + Math.sin(p.yawRad) * lateralM];
  };
  const here = pointAlong(path, distanceM);
  const transitionM = Math.max(DETOUR_MIN_TRANSITION_M,
    Math.abs(lateralM) / Math.tan(DETOUR_MAX_YAW_RAD));
  const joinM = Math.min(distanceM + transitionM, path.lengthM);
  const points: GroundPoint[] = [[here.x, here.z], shifted(joinM)];
  for (let i = 0; i < path.points.length; i += 1) {
    if (path.cumulativeM[i] > joinM + 1e-9) points.push(shifted(path.cumulativeM[i]));
  }
  return buildPath(points);
}

interface ActorAdvance {
  readonly cursor: ActorCursor;
  readonly nearMiss: boolean;
  readonly contact: boolean;
}

function advanceActor(
  state: ActorWorldState,
  index: number,
  cursor: ActorCursor,
  learner: LearnerState,
  timeS: number,
  dtS: number,
  frames: readonly (ActorFrame | undefined)[],
): ActorAdvance {
  const definition = definitionOf(state.schedule, index);
  const path = pathOf(state, index, cursor);
  const learnerSpeed = Math.abs(learner.signedSpeedMps);
  const decel = decelOf(definition);

  // Rule 1: corridor ahead.
  const aheadM = aheadOf(definition, cursor);
  const learnerAhead = corridorBlocked(definition, path, cursor.distanceM, aheadM,
    learnerScratch.points, 0, learnerScratch.count, learnerScratch.bounds);
  // Rule 1b: other actors in the corridor (never near misses or contacts). Deadlock-free:
  // - another actor's CURRENT box is always yielded to, whatever the schedule order;
  // - its projected boxes (next OTHER_HORIZON_S) only when it is an earlier schedule entry or is
  //   committed (held by the learner, or leaving on a detour), and only while this actor's own box
  //   is not already on the other's path ahead (then stopping would leave it there; keep clearing);
  // - a detouring actor ignores other actors.
  // A mutual hold (both boxes in each other's corridors) ends via the Rule 5 detour timer.
  const own = frames[index];
  const yieldsTo = (other: ActorFrame | undefined): boolean => {
    if (own === undefined || other === undefined || other === own) return false;
    if (!other.onDetour && state.apart[index * state.cursors.length + other.index]) return false;
    ensureCorridor(own);
    if (boundsApart(own.corridorBounds, 0, other.sweepBounds, 0)) return false;
    if (corridorMeets(own, other, 0)) return true;
    if (!(other.index < index || other.committed)) return false;
    let projected = false;
    for (let k = 1; k < other.projectionEnd && !projected; k += 1) {
      projected = corridorMeets(own, other, k);
    }
    if (!projected) return false;
    for (let k = 0; k < other.pathEnd; k += 1) {
      if (k !== other.reachBox && !boundsApart(own.boxBounds, 0, other.boxBounds, 4 * k)
        && flatOverlap(own.boxes, 0, 4, other.boxes, 8 * k, 4)) return false;
    }
    return true;
  };
  const actorAhead = !learnerAhead && cursor.detour === null && frames.some(yieldsTo);
  const braking = learnerAhead;
  const slowing = learnerAhead || actorAhead;
  // Rule 3: near miss on entering the corridor while the learner is moving.
  // Latched per encounter; re-armed only after the corridor has been clear for NEAR_MISS_REARM_S.
  const nearMiss = braking && !cursor.encounterLatched && learnerSpeed > MOVING_SPEED_MPS;
  const clearS = braking ? 0 : cursor.clearS + dtS;
  const encounterLatched = braking
    || (cursor.encounterLatched && clearS < NEAR_MISS_REARM_S - TIME_EPSILON_S);
  let speedMps = slowing
    ? Math.max(0, cursor.speedMps - decel * dtS)
    : Math.min(definition.cruiseMps, cursor.speedMps + ACCEL_MPS2[definition.kind] * dtS);
  let distanceM = cursor.distanceM + speedMps * dtS;

  // Rule 2: coach guard.
  if (state.rules === 'coach'
    && overlapsLearner(definition, path, distanceM, COACH_GAP_M)) {
    if (overlapsLearner(definition, path, cursor.distanceM, COACH_GAP_M)) {
      distanceM = cursor.distanceM;
    } else {
      let low = cursor.distanceM;
      let high = distanceM;
      for (let i = 0; i < 16; i += 1) {
        const mid = (low + high) / 2;
        if (overlapsLearner(definition, path, mid, COACH_GAP_M)) high = mid;
        else low = mid;
      }
      distanceM = low;
    }
    speedMps = 0;
  }

  let finished = distanceM >= path.lengthM;
  if (finished) { distanceM = path.lengthM; speedMps = 0; }
  const entry = state.schedule.kind === 'lesson' ? state.schedule.entries[index] : null;
  const triggeredAtS = cursor.triggeredAtS;
  if (entry !== null && triggeredAtS !== null
    && timeS - triggeredAtS >= LESSON_LIFETIME_S - TIME_EPSILON_S) finished = true;

  // Rule 4: contact after the move.
  const contact = !finished && overlapsLearner(definition, path, distanceM, 0);

  // Rule 5: blocked by a stationary learner (free drive: or one that has stayed within
  // HOLD_DISPLACEMENT_M since the hold began), or held by another actor.
  const stopped = speedMps < STOPPED_SPEED_MPS;
  const holdAnchorM: GroundPoint | null = stopped && state.schedule.kind === 'ambient'
    ? cursor.holdAnchorM ?? [learnerScratch.centerX, learnerScratch.centerZ]
    : null;
  const learnerStill = learnerSpeed < MOVING_SPEED_MPS || (holdAnchorM !== null
    && Math.hypot(learnerScratch.centerX - holdAnchorM[0],
      learnerScratch.centerZ - holdAnchorM[1]) < HOLD_DISPLACEMENT_M);
  const blocked = stopped && (learnerStill || actorAhead);
  const blockedS = blocked ? cursor.blockedS + dtS : 0;
  const moved: ActorCursor = {
    ...cursor, distanceM, speedMps, finished, braking: slowing, encounterLatched, clearS,
    blockedS, learnerHeld: learnerAhead, holdAnchorM,
  };
  if (!finished && blockedS >= BLOCKED_WAIT_S - TIME_EPSILON_S) {
    if (cursor.detour !== null) {
      return { cursor: { ...moved, finished: true }, nearMiss, contact };
    }
    const detour = definition.detour.kind === 'turn-back'
      ? turnBackPath(path, distanceM)
      : offsetPath(path, distanceM, definition.detour.lateralM);
    return {
      cursor: {
        ...moved, distanceM: 0, speedMps: 0, blockedS: 0, detour, holdAnchorM: null,
        strideBaseM: cursor.strideBaseM + distanceM,
      },
      nearMiss,
      contact,
    };
  }
  return { cursor: moved, nearMiss, contact };
}

export function stepActors(
  state: ActorWorldState,
  learner: LearnerState,
  dtS: number,
): ActorStepResult {
  const stepCount = state.stepCount + 1;
  const timeS = stepCount * dtS;
  const moving = Math.abs(learner.signedSpeedMps) > MOVING_SPEED_MPS;
  const slowSteps = moving ? 0 : state.slowSteps + 1;
  const hasMoved = state.hasMoved || moving;
  const firstStop = hasMoved && !moving
    && slowSteps * dtS >= FIRST_STOP_DWELL_S - TIME_EPSILON_S;

  const nearMissIds: string[] = [];
  let contactId: string | null = null;
  loadLearner(learner);
  const frames = actorFrames(state);
  const cursors: ActorCursor[] = state.cursors.map((cursor, index) => {
    if (cursor.activeSinceS === null || cursor.finished) return cursor;
    const result = advanceActor(state, index, cursor, learner, timeS, dtS, frames);
    const { id } = definitionOf(state.schedule, index);
    if (result.nearMiss) nearMissIds.push(id);
    if (result.contact && contactId === null) contactId = id;
    return result.cursor;
  });

  const next: ActorWorldState = {
    ...state,
    stepCount,
    timeS,
    cursors,
    previous: learner,
    hasMoved,
    slowSteps,
  };

  if (state.schedule.kind === 'lesson') {
    state.schedule.entries.forEach((entry, index) => {
      const cursor = cursors[index];
      if (cursor.triggeredAtS !== null) return;
      if (triggerFired(entry.trigger, learner, state.previous, firstStop)) {
        cursors[index] = { ...cursor, triggeredAtS: timeS };
      }
    });
  }
  startDueActors(next, cursors, state.cursors);

  return { state: freezeState(next), contactId, nearMissIds };
}

function isVisible(cursor: ActorCursor): boolean {
  return cursor.activeSinceS !== null && !cursor.finished;
}

function pointAlong(path: PathGeometry, distanceM: number): {
  readonly x: number; readonly z: number; readonly yawRad: number;
} {
  locate(path, distanceM);
  return { x: atX, z: atZ, yawRad: atYaw };
}

export function actorPoses(state: ActorWorldState): readonly ActorPose[] {
  return state.cursors.map((cursor, index) => {
    const definition = definitionOf(state.schedule, index);
    const at = pointAlong(pathOf(state, index, cursor), cursor.distanceM);
    return {
      id: definition.id,
      kind: definition.kind,
      visible: isVisible(cursor),
      positionM: [at.x, definition.halfExtentsM[1], at.z] as const,
      yawRad: at.yawRad,
      braking: cursor.braking,
      strideM: cursor.strideBaseM + cursor.distanceM,
    };
  });
}

export function actorBoxes(state: ActorWorldState): readonly ActorBox[] {
  const boxes: ActorBox[] = [];
  state.cursors.forEach((cursor, index) => {
    if (!isVisible(cursor)) return;
    const definition = definitionOf(state.schedule, index);
    const at = pointAlong(pathOf(state, index, cursor), cursor.distanceM);
    boxes.push({
      id: definition.id,
      centerM: [at.x, definition.halfExtentsM[1], at.z],
      halfExtentsM: definition.halfExtentsM,
      yawRad: at.yawRad,
    });
  });
  return boxes;
}

export function activeActorCount(state: ActorWorldState): number {
  return state.cursors.filter(isVisible).length;
}

export function actorTimeS(state: ActorWorldState): number {
  return state.timeS;
}

const SENSOR_PARALLEL_RAD = Math.PI / 9;
const SENSOR_LATERAL_MARGIN_M = 1.0;

/**
 * The boxes the parking sensors may report: every active actor except those moving parallel to
 * the learner (heading within 20 degrees, either direction) whose centre lies more than 1.0 m
 * laterally outside the learner's mirror-width footprint.
 */
export function sensorBoxes(state: ActorWorldState, learner: LearnerState): readonly ActorBox[] {
  const rightX = Math.cos(learner.headingRad), rightZ = -Math.sin(learner.headingRad);
  const lateral = learner.footprint.map(([x, , z]) => x * rightX + z * rightZ);
  const minM = Math.min(...lateral), maxM = Math.max(...lateral);
  return actorBoxes(state).filter((box) => {
    const diff = Math.abs(box.yawRad - learner.headingRad) % Math.PI;
    const parallel = Math.min(diff, Math.PI - diff) <= SENSOR_PARALLEL_RAD;
    if (!parallel) return true;
    const centre = box.centerM[0] * rightX + box.centerM[2] * rightZ;
    const outsideM = Math.max(minM - centre, centre - maxM, 0);
    return outsideM <= SENSOR_LATERAL_MARGIN_M;
  });
}
