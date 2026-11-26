import { describe, expect, it } from 'vitest';
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
