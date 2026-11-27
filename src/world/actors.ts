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
const DETOUR_MIN_TRANSITION_M = 2;
/** Side-steps never yaw the actor more than this. */
const DETOUR_MAX_YAW_RAD = Math.PI / 9;

export const PEDESTRIAN_STOP_DISTANCE_M = 0.5;
export const CAR_DECEL_MPS2 = 6;
export const LOOKAHEAD_MARGIN_M = { pedestrian: 0.5, car: 1.0 } as const;
export const COACH_GAP_M = 0.3;
export const BLOCKED_WAIT_S = 3;
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
  /** Continuous time stopped by a stationary learner. */
  readonly blockedS: number;
  /** Path taken after being blocked; null while on the scheduled path. */
  readonly detour: PathGeometry | null;
  /** Distance walked on earlier paths, so strides stay continuous. */
  readonly strideBaseM: number;
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
  blockedS: 0,
  detour: null,
  strideBaseM: 0,
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
    blockedS: 0,
    detour: null,
    strideBaseM: 0,
  };
}

/** Starts every actor whose scheduled appearance time has been reached. */
function startDueActors(state: ActorWorldState, cursors: ActorCursor[]): void {
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
    stepCount: 0,
    timeS: 0,
    cursors,
    previous: null,
    hasMoved: false,
    slowSteps: 0,
  };
  startDueActors(state, cursors);
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

function boxPolygon(
  definition: ActorDefinition,
  path: PathGeometry,
  distanceM: number,
  inflateM: number,
): readonly Vec3Data[] {
  const at = pointAlong(path, distanceM);
  return orientedRectangle(
    [at.x, definition.halfExtentsM[1], at.z],
    definition.halfExtentsM[0] + inflateM,
    definition.halfExtentsM[2] + inflateM,
    at.yawRad,
  );
}

function overlapsLearner(
  definition: ActorDefinition,
  path: PathGeometry,
  distanceM: number,
  inflateM: number,
  learner: LearnerState,
): boolean {
  return polygonsOverlap(boxPolygon(definition, path, distanceM, inflateM), learner.footprint);
}

/** Sweeps the actor's box along its path every SWEEP_STEP_M. */
function corridorBlocked(
  definition: ActorDefinition,
  path: PathGeometry,
  fromM: number,
  toM: number,
  learner: LearnerState,
): boolean {
  const end = Math.min(toM, path.lengthM);
  for (let distanceM = fromM; distanceM < end; distanceM += SWEEP_STEP_M) {
    if (overlapsLearner(definition, path, distanceM, 0, learner)) return true;
  }
  return overlapsLearner(definition, path, Math.max(end, fromM), 0, learner);
}

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
): ActorAdvance {
  const definition = definitionOf(state.schedule, index);
  const path = pathOf(state, index, cursor);
  const learnerSpeed = Math.abs(learner.signedSpeedMps);
  const decel = decelOf(definition);

  // Rule 1: corridor ahead.
  const stopM = (cursor.speedMps * cursor.speedMps) / (2 * decel);
  const braking = corridorBlocked(
    definition, path, cursor.distanceM,
    cursor.distanceM + stopM + LOOKAHEAD_MARGIN_M[definition.kind], learner,
  );
  // Rule 3: near miss on entering the corridor while the learner is moving.
  const nearMiss = braking && !cursor.braking && learnerSpeed > MOVING_SPEED_MPS;
  let speedMps = braking
    ? Math.max(0, cursor.speedMps - decel * dtS)
    : Math.min(definition.cruiseMps, cursor.speedMps + ACCEL_MPS2[definition.kind] * dtS);
  let distanceM = cursor.distanceM + speedMps * dtS;

  // Rule 2: coach guard.
  if (state.rules === 'coach'
    && overlapsLearner(definition, path, distanceM, COACH_GAP_M, learner)) {
    if (overlapsLearner(definition, path, cursor.distanceM, COACH_GAP_M, learner)) {
      distanceM = cursor.distanceM;
    } else {
      let low = cursor.distanceM;
      let high = distanceM;
      for (let i = 0; i < 16; i += 1) {
        const mid = (low + high) / 2;
        if (overlapsLearner(definition, path, mid, COACH_GAP_M, learner)) high = mid;
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
  const contact = !finished && overlapsLearner(definition, path, distanceM, 0, learner);

  // Rule 5: blocked by a stationary learner.
  const blocked = speedMps < STOPPED_SPEED_MPS && learnerSpeed < MOVING_SPEED_MPS;
  const blockedS = blocked ? cursor.blockedS + dtS : 0;
  const moved: ActorCursor = { ...cursor, distanceM, speedMps, finished, braking, blockedS };
  if (!finished && blockedS >= BLOCKED_WAIT_S - TIME_EPSILON_S) {
    if (cursor.detour !== null) {
      return { cursor: { ...moved, finished: true }, nearMiss, contact };
    }
    const detour = definition.detour.kind === 'turn-back'
      ? turnBackPath(path, distanceM)
      : offsetPath(path, distanceM, definition.detour.lateralM);
    return {
      cursor: {
        ...moved, distanceM: 0, speedMps: 0, blockedS: 0, detour,
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
  const cursors: ActorCursor[] = state.cursors.map((cursor, index) => {
    if (cursor.activeSinceS === null || cursor.finished) return cursor;
    const result = advanceActor(state, index, cursor, learner, timeS, dtS);
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
  startDueActors(next, cursors);

  return { state: freezeState(next), contactId, nearMissIds };
}

function isVisible(cursor: ActorCursor): boolean {
  return cursor.activeSinceS !== null && !cursor.finished;
}

function pointAlong(path: PathGeometry, distanceM: number): {
  readonly x: number; readonly z: number; readonly yawRad: number;
} {
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
  return {
    x: x0 + (x1 - x0) * t,
    z: z0 + (z1 - z0) * t,
    yawRad: Math.atan2(0 - (x1 - x0), 0 - (z1 - z0)), // 0 - avoids -0 flipping pi sign
  };
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
