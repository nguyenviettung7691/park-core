import type { BodyPose, ScenarioDefinition, VehicleProfile } from '../contracts';
import type { ColliderBox } from '../runtime-types';

// Test/capture helper without a vitest dependency, shared by unit tests and browser fixtures.
/** The scenario's wheel stops (per-scenario colliders of kind 'wheel-stop'). */
export function wheelStops(scenario: ScenarioDefinition): readonly ColliderBox[] {
  return scenario.obstacles.filter(({ kind }) => kind === 'wheel-stop');
}

/** Horizontal tyre extent at a stop's top: where a tyre of radius r first touches an edge of height h. */
export function firstTouchDistanceM(tireRadiusM: number, edgeHeightM: number): number {
  return Math.sqrt(2 * tireRadiusM * edgeHeightM - edgeHeightM * edgeHeightM);
}

/**
 * Pose square to the target heading whose leading tyres (the axle nearer the stop when the car sits
 * at the target centre: front in a nose-in bay, rear in a reverse bay) rest against the stop's near
 * face, at the first-touch distance from it.
 */
export function wheelStopTouchingPose(
  scenario: ScenarioDefinition,
  stop: ColliderBox,
  profile: VehicleProfile,
): { readonly pose: BodyPose; readonly leading: 'front' | 'rear' } {
  const region = scenario.target.region;
  const heading = region.headingRad;
  const fwdX = -Math.sin(heading), fwdZ = -Math.cos(heading);
  const along = (stop.centerM[0] - region.centerM[0]) * fwdX
    + (stop.centerM[2] - region.centerM[2]) * fwdZ;
  const dx = firstTouchDistanceM(profile.tireRadiusM, 2 * stop.halfExtentsM[1]);
  const f = profile.frontWeightFraction, L = profile.wheelbaseM;
  const half = stop.halfExtentsM[2];
  const leading = along > 0 ? 'front' : 'rear';
  const centre = leading === 'front' ? along - half - dx - (1 - f) * L : along + half + dx + f * L;
  return {
    leading,
    pose: {
      positionM: [region.centerM[0] + fwdX * centre, profile.centerOfMassHeightM,
        region.centerM[2] + fwdZ * centre],
      rotation: [0, Math.sin(heading / 2), 0, Math.cos(heading / 2)],
    },
  };
}
