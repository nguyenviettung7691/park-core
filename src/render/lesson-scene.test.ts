import { describe, expect, it, vi } from 'vitest';
import { Box3, Mesh, Vector3 } from 'three';
import type { LessonRuntime } from '../contracts';
import { scenarios } from '../lessons/scenarios';
import { vehicleTemplate, wheelStopTemplate } from '../test/vehicle-template';
import { createLessonScene } from './lesson-scene';

function runtime(stepIndex: number): LessonRuntime {
  return {
    stageId: 1,
    stepIndex,
    stepDwellS: 0,
    parkingDwellS: 0,
    acknowledgedStepIds: [],
  };
}

describe('lesson scene', () => {
  it('moves the current-step highlight when the active lesson step changes', () => {
    const lessonScene = createLessonScene(scenarios[1]!, vehicleTemplate(), wheelStopTemplate());
    const highlight = lessonScene.group.getObjectByName('lesson-current-step');

    expect(highlight).toBeDefined();
    const initialPosition = highlight!.position.clone();

    lessonScene.update(runtime(1));

    expect(highlight!.position.equals(initialPosition)).toBe(false);
    lessonScene.dispose();
  });

  it('releases lesson visual resources once on repeated disposal', () => {
    const lessonScene = createLessonScene(scenarios[1]!, vehicleTemplate(), wheelStopTemplate());
    const target = lessonScene.group.children[0];
    if (!(target instanceof Mesh)) throw new Error('Lesson target is not a mesh');
    const disposeGeometry = vi.spyOn(target.geometry, 'dispose');

    lessonScene.dispose();
    lessonScene.dispose();

    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(lessonScene.group.children).toHaveLength(0);
  });

  it.each([1, 2, 4] as const)('clones one wheel-stop template per stage %s stop, never a parked car',
    (stageId) => {
      const template = wheelStopTemplate();
      const scenario = scenarios[stageId];
      const stops = scenario.obstacles.filter(({ kind }) => kind === 'wheel-stop');
      expect(stops).toHaveLength(1);
      const lessonScene = createLessonScene(scenario, vehicleTemplate(), template);
      for (const stop of stops) {
        const matches: unknown[] = [];
        lessonScene.group.traverse((node) => { if (node.name === stop.id) matches.push(node); });
        expect(matches).toHaveLength(1);
        const art = lessonScene.group.getObjectByName(stop.id)!;
        expect(art.visible).toBe(true);
        expect(art.getObjectByName('Exterior')).toBeUndefined();
        expect(art.getObjectByName('WheelStop')).toBeDefined();
        expect(art.position.toArray()).toEqual([...stop.centerM]);
        expect(art.rotation.y).toBeCloseTo(stop.yawRad);
        lessonScene.group.updateMatrixWorld(true);
        const bounds = new Box3().setFromObject(art);
        expect(bounds.getCenter(new Vector3()).distanceTo(new Vector3(...stop.centerM)))
          .toBeLessThan(1e-6);
        const size = bounds.getSize(new Vector3());
        [size.x, size.y, size.z].forEach((value, axis) =>
          expect(value).toBeCloseTo(stop.halfExtentsM[axis]! * 2, 6));
      }
      // The template stays hidden and owned by the environment.
      expect(template.visible).toBe(false);
      expect(template.parent).toBeNull();
      lessonScene.dispose();
    });

  it('disposes its own wheel-stop clones without releasing the template', () => {
    const template = wheelStopTemplate();
    const source = template.getObjectByName('WheelStop') as Mesh;
    const templateGeometry = vi.spyOn(source.geometry, 'dispose');
    const lessonScene = createLessonScene(scenarios[2], vehicleTemplate(), template);
    const clone = lessonScene.group.getObjectByName('stage2-wheel-stop')!
      .getObjectByName('WheelStop') as Mesh;
    expect(clone.geometry).not.toBe(source.geometry);
    expect(clone.material).not.toBe(source.material);
    const cloneGeometry = vi.spyOn(clone.geometry, 'dispose');
    lessonScene.dispose();
    expect(cloneGeometry).toHaveBeenCalledOnce();
    expect(templateGeometry).not.toHaveBeenCalled();
  });

  it('needs the wheel-stop template for a stage with stops', () => {
    expect(() => createLessonScene(scenarios[2], vehicleTemplate(), null)).toThrow(/WheelStopTemplate/);
    expect(() => createLessonScene(scenarios[3], vehicleTemplate(), null)).not.toThrow();
  });
});
