export type GraphicsPreset = 'high' | 'balanced' | 'performance' | 'custom';
export type ResolutionScale = 1 | 0.75 | 0.5;
export type FrameRateCap = 'display' | 30 | 60 | 120 | 144;
export type GraphicsQuality = 'high' | 'low';

export interface GraphicsSettings {
  readonly preset: GraphicsPreset;
  readonly resolutionScale: ResolutionScale;
  readonly frameRateCap: FrameRateCap;
  readonly antialias: boolean;
  readonly mirrorQuality: GraphicsQuality;
  readonly overheadQuality: GraphicsQuality;
}

export interface GraphicsCapabilities {
  readonly resolutionScales: readonly ResolutionScale[];
  readonly frameRateCaps: readonly FrameRateCap[];
  readonly antialiasSupported: boolean;
  readonly mirrorQualities: readonly GraphicsQuality[];
  readonly overheadQualities: readonly GraphicsQuality[];
}

export interface GraphicsOptions {
  readonly resolutionScales: readonly ResolutionScale[];
  readonly frameRateCaps: readonly FrameRateCap[];
  readonly antialiasSupported: boolean;
  readonly mirrorQualities: readonly GraphicsQuality[];
  readonly overheadQualities: readonly GraphicsQuality[];
}

const PRESETS = ['high', 'balanced', 'performance', 'custom'] as const;
const RESOLUTION_SCALES = [1, 0.75, 0.5] as const;
const FRAME_RATE_CAPS = ['display', 30, 60, 120, 144] as const;
const QUALITIES = ['high', 'low'] as const;

export const DEFAULT_GRAPHICS_CAPABILITIES: GraphicsCapabilities = {
  resolutionScales: RESOLUTION_SCALES,
  frameRateCaps: FRAME_RATE_CAPS,
  antialiasSupported: true,
  mirrorQualities: QUALITIES,
  overheadQualities: QUALITIES,
};

function isOneOf<T extends string | number>(value: unknown, values: readonly T[]): value is T {
  return values.some((candidate) => candidate === value);
}

function validateCapabilities(capabilities: GraphicsCapabilities): void {
  if (capabilities.resolutionScales.length === 0 ||
      capabilities.frameRateCaps.length === 0 ||
      capabilities.mirrorQualities.length === 0 ||
      capabilities.overheadQualities.length === 0) {
    throw new RangeError('Graphics capabilities must include at least one supported option per setting');
  }
  if (!capabilities.resolutionScales.every((value) => isOneOf(value, RESOLUTION_SCALES)) ||
      !capabilities.frameRateCaps.every((value) => isOneOf(value, FRAME_RATE_CAPS)) ||
      !capabilities.mirrorQualities.every((value) => isOneOf(value, QUALITIES)) ||
      !capabilities.overheadQualities.every((value) => isOneOf(value, QUALITIES))) {
    throw new RangeError('Graphics capabilities contain an unsupported option');
  }
}

function preferredQuality(values: readonly GraphicsQuality[]): GraphicsQuality {
  if (values.includes('high')) return 'high';
  if (values.includes('low')) return 'low';
  throw new RangeError('No supported graphics quality');
}

function preferredResolutionScale(
  requested: ResolutionScale,
  values: readonly ResolutionScale[],
): ResolutionScale {
  if (values.includes(requested)) return requested;
  return values.reduce((closest, candidate) =>
    Math.abs(candidate - requested) < Math.abs(closest - requested) ||
      (Math.abs(candidate - requested) === Math.abs(closest - requested) && candidate > closest)
      ? candidate
      : closest,
  );
}

function preferredFrameRateCap(
  requested: FrameRateCap,
  values: readonly FrameRateCap[],
): FrameRateCap {
  if (values.includes(requested)) return requested;
  if (values.includes('display')) return 'display';
  return values.reduce<number>((highest, candidate) =>
    typeof candidate === 'number' ? Math.max(highest, candidate) : highest,
  0) as Exclude<FrameRateCap, 'display'>;
}

function settingsForPreset(
  preset: Exclude<GraphicsPreset, 'custom'>,
  capabilities: GraphicsCapabilities,
): GraphicsSettings {
  const requested = preset === 'high'
    ? { resolutionScale: 1, frameRateCap: 'display', antialias: true, mirrorQuality: 'high', overheadQuality: 'high' } as const
    : preset === 'balanced'
      ? { resolutionScale: 0.75, frameRateCap: 60, antialias: true, mirrorQuality: 'low', overheadQuality: 'low' } as const
      : { resolutionScale: 0.5, frameRateCap: 60, antialias: false, mirrorQuality: 'low', overheadQuality: 'low' } as const;

  return {
    preset,
    resolutionScale: preferredResolutionScale(requested.resolutionScale, capabilities.resolutionScales),
    frameRateCap: preferredFrameRateCap(requested.frameRateCap, capabilities.frameRateCaps),
    antialias: requested.antialias && capabilities.antialiasSupported,
    mirrorQuality: capabilities.mirrorQualities.includes(requested.mirrorQuality)
      ? requested.mirrorQuality
      : preferredQuality(capabilities.mirrorQualities),
    overheadQuality: capabilities.overheadQualities.includes(requested.overheadQuality)
      ? requested.overheadQuality
      : preferredQuality(capabilities.overheadQualities),
  };
}

function isSupportedSettings(
  settings: GraphicsSettings,
  capabilities: GraphicsCapabilities,
): boolean {
  return isOneOf(settings.preset, PRESETS) &&
    capabilities.resolutionScales.includes(settings.resolutionScale) &&
    capabilities.frameRateCaps.includes(settings.frameRateCap) &&
    (settings.antialias === false || capabilities.antialiasSupported) &&
    capabilities.mirrorQualities.includes(settings.mirrorQuality) &&
    capabilities.overheadQualities.includes(settings.overheadQuality);
}

export function createDefaultGraphicsSettings(
  capabilities: GraphicsCapabilities,
): GraphicsSettings {
  validateCapabilities(capabilities);
  return settingsForPreset('high', capabilities);
}

export function getGraphicsOptions(capabilities: GraphicsCapabilities): GraphicsOptions {
  validateCapabilities(capabilities);
  return {
    resolutionScales: [...capabilities.resolutionScales],
    frameRateCaps: [...capabilities.frameRateCaps],
    antialiasSupported: capabilities.antialiasSupported,
    mirrorQualities: [...capabilities.mirrorQualities],
    overheadQualities: [...capabilities.overheadQualities],
  };
}

export function parseGraphicsSettings(
  value: unknown,
  capabilities: GraphicsCapabilities,
): GraphicsSettings {
  validateCapabilities(capabilities);
  if (!value || typeof value !== 'object') return createDefaultGraphicsSettings(capabilities);
  const record = value as Record<string, unknown>;
  const isLegacySettings = record.preset === undefined &&
    record.frameRateCap === undefined &&
    record.antialias === undefined &&
    record.mirrorQuality === undefined &&
    record.overheadQuality === undefined;
  if (isLegacySettings) {
    const defaults = createDefaultGraphicsSettings(capabilities);
    if (!isOneOf(record.resolutionScale, RESOLUTION_SCALES) ||
        !capabilities.resolutionScales.includes(record.resolutionScale)) {
      return defaults;
    }
    return {
      ...defaults,
      preset: record.resolutionScale === 1 ? 'high' : 'custom',
      resolutionScale: record.resolutionScale,
    };
  }
  const settings = {
    preset: record.preset,
    resolutionScale: record.resolutionScale,
    frameRateCap: record.frameRateCap,
    antialias: record.antialias,
    mirrorQuality: record.mirrorQuality,
    overheadQuality: record.overheadQuality,
  };
  if (!isOneOf(settings.preset, PRESETS) ||
      !isOneOf(settings.resolutionScale, RESOLUTION_SCALES) ||
      !isOneOf(settings.frameRateCap, FRAME_RATE_CAPS) ||
      typeof settings.antialias !== 'boolean' ||
      !isOneOf(settings.mirrorQuality, QUALITIES) ||
      !isOneOf(settings.overheadQuality, QUALITIES)) {
    return createDefaultGraphicsSettings(capabilities);
  }
  const parsed = settings as GraphicsSettings;
  return isSupportedSettings(parsed, capabilities)
    ? parsed
    : createDefaultGraphicsSettings(capabilities);
}

export function applyGraphicsPreset(
  preset: Exclude<GraphicsPreset, 'custom'>,
  capabilities: GraphicsCapabilities,
): GraphicsSettings {
  validateCapabilities(capabilities);
  return settingsForPreset(preset, capabilities);
}

export function updateGraphicsSettings(
  current: GraphicsSettings,
  patch: Partial<Omit<GraphicsSettings, 'preset'>>,
  capabilities: GraphicsCapabilities,
): GraphicsSettings {
  validateCapabilities(capabilities);
  const updated = { ...current, ...patch, preset: 'custom' as const };
  if (!isSupportedSettings(updated, capabilities)) {
    throw new RangeError('Graphics settings contain an unsupported option');
  }
  return updated;
}
