import type {
  BodyPose,
  QuatData,
  Vec3Data,
  VehicleProfile,
  VehicleTelemetry,
} from '../contracts';
import type { ColliderBox } from '../runtime-types';
import { rearAxleCenter, vehicleFootprint } from '../vehicle/geometry';

const MAX_DISTANCE_M = 3;
const SAMPLE_STEP_M = 0.1;

type Point2 = readonly [number, number];
type Footprint = readonly [Vec3Data, Vec3Data, Vec3Data, Vec3Data];

export interface TrajectorySample {
  readonly rearAxleM: Vec3Data;
  readonly envelope: Footprint;
}

function boxFootprint(box: ColliderBox): Footprint {
  const [halfWidth, , halfLength] = box.halfExtentsM;
  const cos = Math.cos(box.yawRad);
  const sin = Math.sin(box.yawRad);
  const corner = (x: number, z: number): Vec3Data => [
    box.centerM[0] + x * cos + z * sin,
    box.centerM[1],
    box.centerM[2] - x * sin + z * cos,
  ];
  return [
    corner(-halfWidth, -halfLength),
    corner(halfWidth, -halfLength),
    corner(halfWidth, halfLength),
    corner(-halfWidth, halfLength),
  ];
}

function separates(a: readonly Point2[], b: readonly Point2[]): boolean {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const start = polygon[i];
      const end = polygon[(i + 1) % polygon.length];
      if (!start || !end) continue;
      const axisX = start[1] - end[1];
      const axisZ = end[0] - start[0];
      if (axisX === 0 && axisZ === 0) continue;

      let aMin = Infinity, aMax = -Infinity;
      for (const point of a) {
        const projection = point[0] * axisX + point[1] * axisZ;
        aMin = Math.min(aMin, projection);
        aMax = Math.max(aMax, projection);
      }
      let bMin = Infinity, bMax = -Infinity;
      for (const point of b) {
        const projection = point[0] * axisX + point[1] * axisZ;
        bMin = Math.min(bMin, projection);
        bMax = Math.max(bMax, projection);
      }
      if (aMax < bMin || bMax < aMin) return true;
    }
  }
  return false;
}

function sweptFootprint(previous: Footprint, current: Footprint): Point2[] {
  const points = [...previous, ...current]
    .map(([x, , z]): Point2 => [x, z])
    .sort(([ax, az], [bx, bz]) => ax - bx || az - bz);
  const cross = (origin: Point2, a: Point2, b: Point2) =>
    (a[0] - origin[0]) * (b[1] - origin[1]) -
    (a[1] - origin[1]) * (b[0] - origin[0]);
  const lower: Point2[] = [];
  for (const point of points) {
    while (lower.length >= 2 &&
        cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point2[] = [];
  for (const point of [...points].reverse()) {
    while (upper.length >= 2 &&
        cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function overlapsSolid(
  vehiclePolygon: readonly Point2[],
  boxes: readonly ColliderBox[],
): boolean {
  return boxes.some((box) => {
    if (box.kind === 'ground') return false;
    const obstaclePolygon: readonly Point2[] = boxFootprint(box).map(
      (point) => [point[0], point[2]],
    );
    return !separates(vehiclePolygon, obstaclePolygon);
  });
}

export function sampleTrajectory(
  telemetry: VehicleTelemetry,
  profile: VehicleProfile,
  boxes: readonly ColliderBox[],
): readonly TrajectorySample[] {
  const direction = telemetry.gear === 'D' ? 1 : telemetry.gear === 'R' ? -1 : 0;
  const start = rearAxleCenter(telemetry.pose, profile);
  const steeringRad = telemetry.steeringWheelRad / profile.steeringRatio;
  const curvature = direction * Math.tan(steeringRad) / profile.wheelbaseM;
  const forwardOffsetM = profile.frontWeightFraction * profile.wheelbaseM;

  const atDistance = (distanceM: number): TrajectorySample => {
    const heading = telemetry.headingRad + curvature * distanceM;
    let x = start[0], z = start[2];
    if (Math.abs(curvature) < 1e-8) {
      x -= direction * distanceM * Math.sin(telemetry.headingRad);
      z -= direction * distanceM * Math.cos(telemetry.headingRad);
    } else {
      x += direction * (Math.cos(heading) - Math.cos(telemetry.headingRad)) / curvature;
      z -= direction * (Math.sin(heading) - Math.sin(telemetry.headingRad)) / curvature;
    }
    const rearAxleM: Vec3Data = [x, start[1], z];
    const halfHeading = heading / 2;
    const rotation: QuatData = [0, Math.sin(halfHeading), 0, Math.cos(halfHeading)];
    const pose: BodyPose = {
      positionM: [
        x - Math.sin(heading) * forwardOffsetM,
        telemetry.pose.positionM[1],
        z - Math.cos(heading) * forwardOffsetM,
      ],
      rotation,
    };
    return { rearAxleM, envelope: vehicleFootprint(pose, profile) };
  };

  const samples: TrajectorySample[] = [atDistance(0)];
  if (direction === 0 || overlapsSolid(
    samples[0].envelope.map((point) => [point[0], point[2]]), boxes,
  )) return samples;

  const steps = Math.round(MAX_DISTANCE_M / SAMPLE_STEP_M);
  let previous = samples[0]!;
  for (let step = 1; step <= steps; step++) {
    const sample = atDistance(step * SAMPLE_STEP_M);
    if (overlapsSolid(sweptFootprint(previous.envelope, sample.envelope), boxes)) break;
    samples.push(sample);
    previous = sample;
  }
  return samples;
}
