import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { deriveVehicleAssetContract, mirrorBoxes } from './asset-contract';
import { profiles } from './profiles';
import { deriveGeometry, vehicleFootprint } from './geometry';

describe('shared vehicle asset contract', () => {
  it('propagates changed dimensions, eye and mirror heights into dependent geometry', () => {
    const profile = { ...profiles.sedan, mirrorWidthM: 2.2, mirrorHeightM: 1.05,
      wheelbaseM: 2.8, frontOverhangM: 1, rearOverhangM: 1,
      bodySizeM: [1.9, 1.5, 4.8] as const, driverEyeLocalM: [-0.4, 0.7, -1] as const };
    const contract = deriveVehicleAssetContract(profile);
    const geometry = deriveGeometry(profile);
    expect(contract.driverEyeLocalM).toEqual(profile.driverEyeLocalM);
    expect(contract.mirrors.left.positionM).toEqual(geometry.mirrors[0].centerLocalM);
    expect(contract.mirrors.rear.positionM[2]).toBeCloseTo(-1.56);
    expect(contract.rearDisplayM).toEqual(contract.mirrors.rear.positionM);
    expect(contract.bodyPhysicalZ[1] - contract.bodyPhysicalZ[0]).toBeCloseTo(4.8);
    const footprint = vehicleFootprint({ positionM: [0, 0, 0], rotation: [0, 0, 0, 1] }, profile);
    expect(footprint[0][0]).toBe(-1.1);
    expect(footprint[0][2]).toBeCloseTo(contract.bodyPhysicalZ[0]);
    expect(mirrorBoxes(profile)[0].centerLocalM[1]).toBeCloseTo(0.53);
  });

  it('places sedan and CUV mirrors ahead of the driver', () => {
    const sedan = deriveVehicleAssetContract(profiles.sedan);
    const eye = profiles.sedan.driverEyeLocalM;
    for (const id of ['left', 'right'] as const) {
      expect(sedan.mirrors[id].positionM[2]).toBeLessThan(eye[2] - 0.4);
    }
    expect(sedan.mirrors.rear.positionM).toEqual([
      expect.closeTo(0, 6), expect.closeTo(0.74, 6), expect.closeTo(-1.225, 6)]);
    expect(sedan.mirrors.rear.positionM[1]).toBeGreaterThan(eye[1] + 0.1);
    // CUV interior subtask: the same cabin view contract around its own eye.
    const cuv = deriveVehicleAssetContract(profiles.cuv);
    expect(cuv.mirrors.left.positionM).toEqual([
      expect.closeTo(-0.965, 4), expect.closeTo(0.48, 4), expect.closeTo(-1.3312, 4)]);
    expect(cuv.mirrors.left.positionM[2]).toBeLessThan(profiles.cuv.driverEyeLocalM[2] - 0.4);
    expect(cuv.mirrors.rear.positionM).toEqual([
      expect.closeTo(0, 4), expect.closeTo(0.82, 4), expect.closeTo(-1.1062, 4)]);
    expect(cuv.rearDisplayM).toEqual(cuv.mirrors.rear.positionM);
  });

  it('rejects inconsistent dimensions instead of silently rescaling the asset', () => {
    expect(() => deriveVehicleAssetContract({ ...profiles.sedan, wheelbaseM: 3 }))
      .toThrow('axle/overhang');
    expect(() => deriveVehicleAssetContract({ ...profiles.sedan, mirrorHeightM: NaN }))
      .toThrow('mirrorHeightM');
  });
});

const DEG = Math.PI / 180;

function glassFrame(contract: ReturnType<typeof deriveVehicleAssetContract>, id: 'rear' | 'left' | 'right') {
  const spec = contract.mirrors[id];
  const q = new Quaternion(...spec.rotation);
  return {
    spec,
    center: new Vector3(...spec.positionM),
    normal: new Vector3(0, 0, 1).applyQuaternion(q),
    right: new Vector3(1, 0, 0).applyQuaternion(q),
    up: new Vector3(0, 1, 0).applyQuaternion(q),
  };
}

/** Direction the eye sees by way of a point on the glass (vehicle-local). */
function reflectedRay(eye: Vector3, normal: Vector3, onGlass: Vector3): Vector3 {
  const incoming = onGlass.clone().sub(eye).normalize();
  return incoming.addScaledVector(normal, -2 * incoming.dot(normal));
}

/** Horizontal angle of a ray from straight back (+Z); positive is towards -X (left). */
function outwardLeftDeg(ray: Vector3): number {
  return Math.atan2(-ray.x, ray.z) / DEG;
}

describe.each(['sedan', 'cuv'] as const)('%s mirror glass contract', (id) => {
  const contract = deriveVehicleAssetContract(profiles[id]);
  const eye = new Vector3(...profiles[id].driverEyeLocalM);

  it('sizes and convexity match the spec', () => {
    expect(contract.mirrors.rear.halfSizeM).toEqual([0.12, 0.03]);
    expect(contract.mirrors.left.halfSizeM).toEqual([0.11, 0.065]);
    expect(contract.mirrors.right.halfSizeM).toEqual([0.11, 0.065]);
    expect(contract.mirrors.rear.convexity).toBe(1);
    expect(contract.mirrors.left.convexity).toBe(1);
    expect(contract.mirrors.right.convexity).toBe(1.3);
  });

  it('side mirrors show a sliver of the flank on the inner edge', () => {
    for (const [mirror, side] of [['left', -1], ['right', 1]] as const) {
      const glass = glassFrame(contract, mirror);
      const span = glass.spec.halfSizeM[0] * glass.spec.convexity;
      const edges = [1, -1].map((sign) => glass.center.clone().addScaledVector(glass.right, sign * span));
      const [inner, outer] = Math.abs(edges[0]!.x) < Math.abs(edges[1]!.x) ? edges : [edges[1]!, edges[0]!];
      // Positive = outward on this mirror's side of the car.
      const outward = (point: Vector3) => -side * outwardLeftDeg(reflectedRay(eye, glass.normal, point));
      expect(outward(inner!), mirror).toBeCloseTo(-1, 1);
      expect(outward(outer!), mirror).toBeGreaterThan(0);
      const centre = outward(glass.center);
      expect(centre, mirror).toBeGreaterThan(3);
      expect(centre, mirror).toBeLessThan(mirror === 'left' ? 8 : 9);
    }
  });

  it('pitches side centre rays 3° down and the rear ray 2° down, straight back', () => {
    for (const [mirror, pitch] of [['left', -3], ['right', -3], ['rear', -2]] as const) {
      const glass = glassFrame(contract, mirror);
      const ray = reflectedRay(eye, glass.normal, glass.center);
      expect(Math.asin(ray.y) / DEG, mirror).toBeCloseTo(pitch, 1);
    }
    const rear = glassFrame(contract, 'rear');
    expect(outwardLeftDeg(reflectedRay(eye, rear.normal, rear.center))).toBeCloseTo(0, 1);
  });

  it('glass rotations are unit, finite, roll-free and face the eye', () => {
    for (const mirror of ['rear', 'left', 'right'] as const) {
      const glass = glassFrame(contract, mirror);
      expect(glass.spec.rotation.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...glass.spec.rotation)).toBeCloseTo(1, 9);
      expect(glass.right.y, mirror).toBeCloseTo(0, 9);
      expect(glass.up.y, mirror).toBeGreaterThan(0.9);
      expect(eye.clone().sub(glass.center).dot(glass.normal), mirror).toBeGreaterThan(0);
    }
  });
});
