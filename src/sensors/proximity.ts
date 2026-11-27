import * as CANNON from 'cannon-es';
import type { SensorBand, SensorId, SensorReading, SensorSnapshot, VehicleProfile } from '../contracts';
import type { ColliderEdge } from '../world/colliders';
import type { ActorBox } from '../world/actors';
import { rayBoxDistance } from './actor-rays';

const MAX_DISTANCE_M = 2.5;
const RAY_DISTANCE_M = 2.55;
const SAMPLE_INTERVAL_S = 0.05;
const SENSOR_IDS: readonly SensorId[] = [
  'front-left-outer', 'front-left', 'front-center', 'front-right', 'front-right-outer',
  'rear-left-outer', 'rear-left', 'rear-center', 'rear-right', 'rear-right-outer',
];
const BAND_LEVEL: Readonly<Record<SensorBand, number>> = {
  clear: 0, green: 1, yellow: 2, red: 3, stop: 4,
};
const EXIT_DISTANCE_M: Partial<Record<SensorBand, number>> = {
  green: 2.55, yellow: 1.25, red: 0.65, stop: 0.35,
};

export interface ProximitySensors {
  sample(simulationTimeS: number): SensorSnapshot;
  reset(): void;
}

interface SensorRay {
  readonly id: SensorId;
  readonly origin: CANNON.Vec3;
  readonly direction: CANNON.Vec3;
  readonly ray: CANNON.Ray;
}

export function classifyDistance(distanceM: number | null, previous: SensorBand): SensorBand {
  if (distanceM === null || !Number.isFinite(distanceM) || distanceM < 0) return 'clear';
  const raw: SensorBand = distanceM <= 0.3 ? 'stop' :
    distanceM <= 0.6 ? 'red' :
      distanceM <= 1.2 ? 'yellow' :
        distanceM <= MAX_DISTANCE_M ? 'green' : 'clear';
  if (BAND_LEVEL[raw] > BAND_LEVEL[previous]) return raw;
  const exitDistance = EXIT_DISTANCE_M[previous];
  return exitDistance !== undefined && distanceM <= exitDistance ? previous : raw;
}

/** The wheel-stop bodies among the edge colliders (for createSensors' `ignored`). */
export function wheelStopBodies(edges: readonly ColliderEdge[]): ReadonlySet<CANNON.Body> {
  return new Set(edges.filter(({ box }) => box.kind === 'wheel-stop').map(({ body }) => body));
}

/**
 * `ignored`: bodies the sensors never report, whatever the ray height or pitch. Wheel stops are
 * passed here (spec: the parking sensors exclude them, a stop is a tool, not an obstacle); the
 * 0.45 m rays would also pass over a 0.11 m stop, but that is geometry, not a rule.
 */
export function createSensors(
  world: CANNON.World, body: CANNON.Body, profile: VehicleProfile,
  ignored: ReadonlySet<CANNON.Body> = new Set(),
  actorBoxes: () => readonly ActorBox[] = () => [],
): ProximitySensors {
  const halfWidth = profile.bodySizeM[0] / 2;
  const frontZ = -((1 - profile.frontWeightFraction) * profile.wheelbaseM +
    profile.frontOverhangM);
  const rearZ = profile.frontWeightFraction * profile.wheelbaseM + profile.rearOverhangM;
  const localHeight = 0.45 - profile.centerOfMassHeightM;
  const rays: SensorRay[] = [];

  for (const [ids, front] of [[SENSOR_IDS.slice(0, 5), true], [SENSOR_IDS.slice(5), false]] as const) {
    ids.forEach((id, index) => {
      const angle = (index - 2) * Math.PI / 6;
      rays.push({
        id,
        origin: new CANNON.Vec3(
          -halfWidth + index * halfWidth / 2, localHeight, front ? frontZ : rearZ,
        ),
        direction: new CANNON.Vec3(
          Math.sin(angle), 0, (front ? -1 : 1) * Math.cos(angle),
        ),
        ray: new CANNON.Ray(),
      });
    });
  }

  let lastSampleS = -Infinity;
  let previousSnapshot: SensorSnapshot | null = null;
  const bands = new Map<SensorId, SensorBand>(SENSOR_IDS.map((id) => [id, 'clear']));

  return {
    sample(simulationTimeS) {
      if (!Number.isFinite(simulationTimeS) || simulationTimeS < lastSampleS) {
        throw new RangeError('Sensor simulation time must be finite and monotonic');
      }
      if (previousSnapshot && simulationTimeS - lastSampleS < SAMPLE_INTERVAL_S) {
        return previousSnapshot;
      }
      const readings = rays.map(({ id, origin, direction, ray }): SensorReading => {
        const from = new CANNON.Vec3();
        const worldDirection = new CANNON.Vec3();
        const to = new CANNON.Vec3();
        body.pointToWorldFrame(origin, from);
        body.vectorToWorldFrame(direction, worldDirection);
        worldDirection.scale(RAY_DISTANCE_M, to);
        from.vadd(to, to);
        let closestDistance = Infinity;
        let obstacleId: string | null = null;
        ray.intersectWorld(world, {
          mode: CANNON.Ray.ALL,
          from,
          to,
          callback(result) {
            if (!result.body || result.body === body || !result.body.collisionResponse ||
                ignored.has(result.body) || result.distance >= closestDistance) return;
            closestDistance = result.distance;
            obstacleId = String(result.body.id);
          },
        });
        const boxes = actorBoxes();
        if (boxes.length > 0) {
          const unit: readonly [number, number, number] =
            [worldDirection.x / worldDirection.length(), 0, worldDirection.z / worldDirection.length()];
          for (const box of boxes) {
            const hit = rayBoxDistance([from.x, from.y, from.z], unit, RAY_DISTANCE_M, box);
            if (hit !== null && hit < closestDistance) { closestDistance = hit; obstacleId = box.id; }
          }
        }
        const distanceM = obstacleId === null ? null : closestDistance;
        const band = classifyDistance(distanceM, bands.get(id) ?? 'clear');
        bands.set(id, band);
        return Object.freeze({ id, distanceM, obstacleId, band });
      });
      lastSampleS = simulationTimeS;
      previousSnapshot = Object.freeze({
        sampledAtS: simulationTimeS,
        readings: Object.freeze(readings),
      });
      return previousSnapshot;
    },
    reset() {
      lastSampleS = -Infinity;
      previousSnapshot = null;
      for (const id of SENSOR_IDS) bands.set(id, 'clear');
    },
  };
}
