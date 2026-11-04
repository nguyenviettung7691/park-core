import { describe, expect, it } from 'vitest';
import { collidersForEnvironment } from '../world/colliders';
import { profiles } from '../vehicle/profiles';
import {
  footprint,
  footprintInsideRegion,
  colliderFootprint,
  polygonsOverlap,
  poseAtRegion,
  poseFromSpawn,
  requireScenarioColliderComposer,
  requireScenarioModule,
  scenarioNumbersAreFinite,
} from './scenario-test-utils';

describe('authored lesson scenarios', () => {
  it('defines five correctly sized lessons with clear spawns and parking envelopes', async () => {
    const { scenarios } = requireScenarioModule();
    const collidersForScenario = await requireScenarioColliderComposer();
    const expected = [
      { stageId: 1, environment: 'garage', width: 3, length: 6 },
      { stageId: 2, environment: 'garage', width: 2.8, length: 5.5 },
      { stageId: 3, environment: 'roadside', width: 2.5, length: 7 },
      { stageId: 4, environment: 'garage', width: 2.6, length: 5.3 },
      { stageId: 5, environment: 'roadside', width: 2.5, length: 6.5 },
    ] as const;

    expect(Object.keys(scenarios).map(Number).sort()).toEqual([1, 2, 3, 4, 5]);
    for (const row of expected) {
      const scenario = scenarios[row.stageId];
      expect(scenario.stageId).toBe(row.stageId);
      expect(scenario.environmentId).toBe(row.environment);
      expect(scenario.target.region.halfWidthM * 2).toBe(row.width);
      expect(scenario.target.region.halfLengthM * 2).toBe(row.length);
      expect(Object.keys(scenario.spawnByVehicle).sort()).toEqual(['cuv', 'sedan']);
      expect(scenario.regions.setup).toBeDefined();
      expect(scenario.regions.target).toBeDefined();
      expect(scenario.steps.length).toBeGreaterThan(0);
      expect(scenarioNumbersAreFinite(scenario)).toBe(true);

      const colliders = collidersForScenario(scenario);
      const colliderIds = colliders.map(({ id }) => id);
      expect(colliderIds.every(Boolean)).toBe(true);
      expect(new Set(colliderIds).size).toBe(colliderIds.length);
      expect(new Set(scenario.obstacles.map(({ id }) => id)).size)
        .toBe(scenario.obstacles.length);

      const environment = collidersForEnvironment(scenario.environmentId);
      const usableWidth = scenario.environmentId === 'garage'
        ? Math.min(...environment
          .filter(({ id }) => id.endsWith('-rf') || id.endsWith('-rb'))
          .map(({ centerM, halfExtentsM }) => centerM[0] - halfExtentsM[0]))
          - Math.max(...environment
            .filter(({ id }) => id.endsWith('-lf') || id.endsWith('-lb'))
            .map(({ centerM, halfExtentsM }) => centerM[0] + halfExtentsM[0]))
        : 2 * Math.min(...environment
          .filter(({ kind }) => kind === 'curb')
          .map(({ centerM, halfExtentsM }) => Math.abs(centerM[0]) - halfExtentsM[0]));
      expect(usableWidth).toBeGreaterThanOrEqual(6);

      for (const profile of Object.values(profiles)) {
        const solids = colliders.filter(({ kind }) => kind !== 'ground');
        const spawnPose = poseFromSpawn(scenario.spawnByVehicle[profile.id]);
        const spawnFootprint = footprint(spawnPose, profile);
        const targetFootprint = footprint(poseAtRegion(scenario.target.region, profile), profile);

        expect(footprintInsideRegion(spawnFootprint, scenario.drivingBounds)).toBe(true);
        expect(footprintInsideRegion(targetFootprint, scenario.drivingBounds)).toBe(true);
        expect(footprintInsideRegion(targetFootprint, scenario.target.region, 0.05)).toBe(true);
        for (const solid of solids) {
          expect(polygonsOverlap(spawnFootprint, colliderFootprint(solid))).toBe(false);
          expect(polygonsOverlap(targetFootprint, colliderFootprint(solid))).toBe(false);
        }
      }
    }
  });
});
