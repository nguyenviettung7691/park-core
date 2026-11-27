// Types for TypeScript tests that build GLBs in memory (tools/generate-assets.mjs).
export const EXTERIOR_LAMPS_DEFAULT: boolean;
export const DRIVER_SEAT_DEFAULT: boolean;

export interface BuildGlbOptions {
  /** Author the exterior lit-lamp nodes (vehicles only). */
  readonly lamps?: boolean;
  /** Author the movable `DriverSeat` node (vehicles only). */
  readonly driverSeat?: boolean;
}

export function buildGlb(
  assetId: 'sedan' | 'cuv' | 'roadside' | 'garage', options?: BuildGlbOptions,
): Uint8Array;

export function writeAssets(
  outputRoot: string, assetIds?: readonly string[], options?: BuildGlbOptions,
): void;
