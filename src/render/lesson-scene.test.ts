import { describe, expect, it, vi } from 'vitest';
import { Mesh } from 'three';
import type { LessonRuntime } from '../contracts';
import { scenarios } from '../lessons/scenarios';
import { vehicleTemplate } from '../test/vehicle-template';
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
    const lessonScene = createLessonScene(scenarios[1]!, vehicleTemplate());
    const highlight = lessonScene.group.getObjectByName('lesson-current-step');

    expect(highlight).toBeDefined();
    const initialPosition = highlight!.position.clone();

    lessonScene.update(runtime(1));

    expect(highlight!.position.equals(initialPosition)).toBe(false);
    lessonScene.dispose();
  });

  it('releases lesson visual resources once on repeated disposal', () => {
    const lessonScene = createLessonScene(scenarios[1]!, vehicleTemplate());
    const target = lessonScene.group.children[0];
    if (!(target instanceof Mesh)) throw new Error('Lesson target is not a mesh');
    const disposeGeometry = vi.spyOn(target.geometry, 'dispose');

    lessonScene.dispose();
    lessonScene.dispose();

    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(lessonScene.group.children).toHaveLength(0);
  });
});
