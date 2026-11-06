import { describe, expect, it } from 'vitest';
import {
  applyGraphicsPreset,
  createDefaultGraphicsSettings,
  getGraphicsOptions,
  parseGraphicsSettings,
  updateGraphicsSettings,
  type GraphicsCapabilities,
  type GraphicsSettings,
} from './graphics-settings';

const fullCapabilities: GraphicsCapabilities = {
  resolutionScales: [1, 0.75, 0.5],
  frameRateCaps: ['display', 30, 60, 120, 144],
  antialiasSupported: true,
  mirrorQualities: ['high', 'low'],
  overheadQualities: ['high', 'low'],
};

describe('graphics settings defaults and presets', () => {
  it('starts at high quality without an additional frame cap', () => {
    expect(createDefaultGraphicsSettings(fullCapabilities)).toEqual({
      preset: 'high',
      resolutionScale: 1,
      frameRateCap: 'display',
      antialias: true,
      mirrorQuality: 'high',
      overheadQuality: 'high',
    });
  });

  it.each([
    ['high', 1, 'display', true, 'high', 'high'],
    ['balanced', 0.75, 60, true, 'low', 'low'],
    ['performance', 0.5, 60, false, 'low', 'low'],
  ] as const)(
    'maps the %s preset to its configured values',
    (preset, resolutionScale, frameRateCap, antialias, mirrorQuality, overheadQuality) => {
      expect(applyGraphicsPreset(preset, fullCapabilities)).toEqual({
        preset,
        resolutionScale,
        frameRateCap,
        antialias,
        mirrorQuality,
        overheadQuality,
      });
    },
  );
});

describe('graphics settings capability handling', () => {
  it('uses only supported choices for defaults and visible options', () => {
    const limited: GraphicsCapabilities = {
      resolutionScales: [0.5],
      frameRateCaps: [30],
      antialiasSupported: false,
      mirrorQualities: ['low'],
      overheadQualities: ['low'],
    };

    expect(createDefaultGraphicsSettings(limited)).toEqual({
      preset: 'high',
      resolutionScale: 0.5,
      frameRateCap: 30,
      antialias: false,
      mirrorQuality: 'low',
      overheadQuality: 'low',
    });
    expect(getGraphicsOptions(limited)).toEqual({
      resolutionScales: [0.5],
      frameRateCaps: [30],
      antialiasSupported: false,
      mirrorQualities: ['low'],
      overheadQualities: ['low'],
    });
  });

  it('falls back to supported high defaults for malformed persisted data', () => {
    expect(parseGraphicsSettings({
      preset: 'ultra',
      resolutionScale: 2,
      frameRateCap: 'unlimited',
      antialias: true,
      mirrorQuality: 'ultra',
      overheadQuality: 'ultra',
    }, fullCapabilities)).toEqual(createDefaultGraphicsSettings(fullCapabilities));
  });

  it('preserves the prior render scale when loading a legacy settings record', () => {
    expect(parseGraphicsSettings({ resolutionScale: 0.75 }, fullCapabilities)).toEqual({
      preset: 'custom',
      resolutionScale: 0.75,
      frameRateCap: 'display',
      antialias: true,
      mirrorQuality: 'high',
      overheadQuality: 'high',
    });
  });

  it('marks a changed setting as custom', () => {
    const initial: GraphicsSettings = createDefaultGraphicsSettings(fullCapabilities);
    expect(updateGraphicsSettings(initial, { resolutionScale: 0.75 }, fullCapabilities)).toEqual({
      ...initial,
      preset: 'custom',
      resolutionScale: 0.75,
    });
  });
});
