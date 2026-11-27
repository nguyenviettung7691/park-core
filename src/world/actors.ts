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

const MOVING_SPEED_MPS = 0.2;
const FIRST_STOP_DWELL_S = 0.5;
const TIME_EPSILON_S = 1e-9;

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

  const cursors: ActorCursor[] = state.cursors.map((cursor, index) => {
    if (cursor.activeSinceS === null || cursor.finished) return cursor;
    const distanceM = cursor.distanceM + cursor.speedMps * dtS;
    if (distanceM >= state.paths[index].lengthM) {
      return { ...cursor, distanceM: state.paths[index].lengthM, speedMps: 0, finished: true };
    }
    return { ...cursor, distanceM };
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

  return { state: freezeState(next), contactId: null, nearMissIds: [] };
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
    const at = pointAlong(state.paths[index], cursor.distanceM);
    return {
      id: definition.id,
      kind: definition.kind,
      visible: isVisible(cursor),
      positionM: [at.x, definition.halfExtentsM[1], at.z] as const,
      yawRad: at.yawRad,
      braking: false,
      strideM: cursor.distanceM,
    };
  });
}

export function actorBoxes(state: ActorWorldState): readonly ActorBox[] {
  const boxes: ActorBox[] = [];
  state.cursors.forEach((cursor, index) => {
    if (!isVisible(cursor)) return;
    const definition = definitionOf(state.schedule, index);
    const at = pointAlong(state.paths[index], cursor.distanceM);
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
