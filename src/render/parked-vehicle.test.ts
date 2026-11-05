import { Box3, Mesh, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ColliderBox } from '../runtime-types';
import { vehicleTemplate } from '../test/vehicle-template';
import { scenarios } from '../lessons/scenarios';
import { createLessonScene } from './lesson-scene';
import { createParkedVehicle } from './parked-vehicle';

describe('parked vehicle artwork', () => {
  it.each([
    { halfExtentsM: [0.9, 0.8, 2.2], yawRad: 0 },
    { halfExtentsM: [0.7, 0.8, 2.1], yawRad: 0 },
    { halfExtentsM: [0.7, 0.8, 2.1], yawRad: Math.PI / 4 },
  ] as const)('fits the visible shell to collider $halfExtentsM at yaw $yawRad', (shape) => {
    const collider: ColliderBox = { id: 'parked', kind: 'obstacle', centerM: [2, 0.8, -5], ...shape };
    const template = vehicleTemplate();
    const car = createParkedVehicle(template, collider);
    expect(car.position.toArray()).toEqual([2, 0.8, -5]);
    expect(car.rotation.y).toBeCloseTo(shape.yawRad);
    car.rotation.y = 0;
    const bounds = new Box3().setFromObject(car);
    expect(bounds.getCenter(new Vector3()).distanceTo(new Vector3(2, 0.8, -5))).toBeLessThan(0.02);
    const size = bounds.getSize(new Vector3());
    [size.x, size.y, size.z].forEach((value, axis) =>
      expect(value).toBeCloseTo(shape.halfExtentsM[axis]! * 2, 4));
    const clonedWheel = car.getObjectByName('WheelFL')!;
    template.getObjectByName('WheelFL')!.rotation.x = 1;
    expect(clonedWheel.rotation.x).toBeCloseTo(0);
  });

  it('disposes owned clones once without releasing or mutating the driving template', () => {
    const template = vehicleTemplate();
    const original = template.getObjectByName('Exterior') as Mesh;
    const originalGeometry = vi.spyOn(original.geometry, 'dispose');
    const originalMaterial = vi.spyOn(original.material as import('three').Material, 'dispose');
    const lesson = createLessonScene(scenarios[1], template);
    const clone = lesson.group.getObjectByName('stage1-parked-left')!.getObjectByName('Exterior') as Mesh;
    expect(clone.geometry).not.toBe(original.geometry);
    expect(clone.material).not.toBe(original.material);
    const cloneDispose = vi.spyOn(clone.geometry, 'dispose');
    lesson.dispose();
    lesson.dispose();
    expect(cloneDispose).toHaveBeenCalledOnce();
    expect(originalGeometry).not.toHaveBeenCalled();
    expect(originalMaterial).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3, 4, 5] as const)('renders every parked collider in stage %s', (stage) => {
    const lesson = createLessonScene(scenarios[stage], vehicleTemplate());
    for (const collider of scenarios[stage].obstacles) {
      expect(lesson.group.getObjectByName(collider.id)?.visible).toBe(true);
    }
    lesson.dispose();
  });
});
