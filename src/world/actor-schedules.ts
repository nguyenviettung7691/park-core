import type {
  ActorDefinition,
  ActorDetour,
  ActorRules,
  ActorSchedule,
  AmbientActorEntry,
  EnvironmentId,
  GroundPoint,
  ScenarioDefinition,
} from '../contracts';
import { rulesForStage } from './actors';

const PEDESTRIAN_HALF_EXTENTS_M = [0.25, 0.85, 0.25] as const;
const PEDESTRIAN_CRUISE_MPS = 1.4;
const CAR_HALF_EXTENTS_M = [0.9, 0.8, 2.3] as const;

/** Roadside cruise (20 km/h) and garage cruise (10 km/h). */
export const ROADSIDE_CAR_MPS = 5.56;
export const GARAGE_CAR_MPS = 2.78;

export function pedestrian(
  id: string,
  path: readonly GroundPoint[],
  detour: ActorDetour,
): ActorDefinition {
  return {
    id, kind: 'pedestrian', halfExtentsM: PEDESTRIAN_HALF_EXTENTS_M, path,
    cruiseMps: PEDESTRIAN_CRUISE_MPS, detour,
  };
}

export function car(
  id: string,
  path: readonly GroundPoint[],
  cruiseMps: number,
  detour: ActorDetour,
): ActorDefinition {
  return { id, kind: 'car', halfExtentsM: CAR_HALF_EXTENTS_M, path, cruiseMps, detour };
}

const turnBack: ActorDetour = { kind: 'turn-back' };
const offset = (lateralM: number): ActorDetour => ({ kind: 'offset', lateralM });

function ambient(actor: ActorDefinition, startS: number, periodS: number): AmbientActorEntry {
  return { actor, startS, periodS };
}

export const ambientSchedules: Readonly<Record<EnvironmentId, readonly AmbientActorEntry[]>> =
  Object.freeze({
    garage: Object.freeze([
      ambient(pedestrian('ped-garage-ambient', [[-6, 14.2], [-6, -14.2]], turnBack), 5, 30),
      ambient(car('car-garage-ambient', [[-12.2, -1], [12.2, -1]], GARAGE_CAR_MPS, turnBack),
        15, 40),
    ]),
    roadside: Object.freeze([
      ambient(pedestrian('ped-roadside-right', [[6, -15], [6, 15]], turnBack), 0, 30),
      ambient(pedestrian('ped-roadside-left', [[-6, 15], [-6, -15]], turnBack), 15, 30),
      ambient(car('car-roadside-a', [[-2.35, 18.5], [-2.35, -18.5]], ROADSIDE_CAR_MPS,
        turnBack), 8, 20),
      ambient(car('car-roadside-b', [[2.1, -18.5], [2.1, 18.5]], ROADSIDE_CAR_MPS,
        offset(0.6)), 18, 20),
    ]),
  });

export function scheduleForMode(
  mode:
    | { readonly kind: 'lesson'; readonly scenario: ScenarioDefinition }
    | { readonly kind: 'sandbox'; readonly environmentId: EnvironmentId },
): { readonly schedule: ActorSchedule; readonly rules: ActorRules } {
  if (mode.kind === 'lesson') {
    return {
      schedule: { kind: 'lesson', entries: mode.scenario.actors },
      rules: rulesForStage(mode.scenario.stageId),
    };
  }
  return {
    schedule: { kind: 'ambient', entries: ambientSchedules[mode.environmentId] },
    rules: 'realistic',
  };
}

export { offset as offsetDetour, turnBack as turnBackDetour };
