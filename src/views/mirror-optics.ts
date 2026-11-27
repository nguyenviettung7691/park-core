import { Quaternion, Vector3, type PerspectiveCamera } from 'three';

/** A flat (or, with convexity > 1, approximately convex) rectangular mirror glass. */
export interface MirrorGlass {
  /** World-space centre of the glass. */
  readonly center: Vector3;
  /** World rotation; local +Z is the normal facing the eye, +X right and +Y up. */
  readonly quaternion: Quaternion;
  readonly halfSizeM: readonly [number, number];
  /** View widening factor; 1 is a flat mirror. */
  readonly convexity: number;
}

const MIN_EYE_DISTANCE_M = 1e-3;
const LOCAL_Z = new Vector3(0, 0, 1);
const LOCAL_X = new Vector3(1, 0, 0);
const LOCAL_Y = new Vector3(0, 1, 0);
// The camera looks through the glass from behind it, so it faces along +normal.
const TURN_AROUND = new Quaternion(0, 1, 0, 0);
const normal = new Vector3();
const offset = new Vector3();
const axis = new Vector3();

function glassNormal(glass: MirrorGlass): Vector3 {
  return normal.copy(LOCAL_Z).applyQuaternion(glass.quaternion);
}

/** Mirror image of a world point across the glass plane. */
export function reflectPoint(point: Vector3, glass: MirrorGlass, out = new Vector3()): Vector3 {
  const n = glassNormal(glass);
  const distance = offset.copy(point).sub(glass.center).dot(n);
  return out.copy(point).addScaledVector(n, -2 * distance);
}

/**
 * Poses the camera at the eye's mirror image with an off-axis frustum whose near plane is
 * the glass, so the render target holds exactly what the eye sees in the glass.
 */
export function applyMirrorCamera(
  camera: PerspectiveCamera, eye: Vector3, glass: MirrorGlass, far: number,
): void {
  const [halfWidth, halfHeight] = glass.halfSizeM;
  if (!(halfWidth > 0) || !(halfHeight > 0) || !(glass.convexity >= 1) || !(far > 0)) {
    throw new RangeError('Mirror glass needs a positive size, convexity >= 1 and far > 0');
  }
  const eyeDistance = offset.copy(eye).sub(glass.center).dot(glassNormal(glass));
  if (!(eyeDistance > MIN_EYE_DISTANCE_M) || !Number.isFinite(eyeDistance)) {
    throw new RangeError('Mirror eye must be in front of the glass');
  }
  reflectPoint(eye, glass, camera.position);
  camera.quaternion.copy(glass.quaternion).multiply(TURN_AROUND);
  camera.updateMatrixWorld(true);

  offset.copy(glass.center).sub(camera.position);
  const near = eyeDistance;
  const centerX = offset.dot(axis.copy(LOCAL_X).applyQuaternion(camera.quaternion));
  const centerY = offset.dot(axis.copy(LOCAL_Y).applyQuaternion(camera.quaternion));
  const spanX = halfWidth * glass.convexity;
  const spanY = halfHeight * glass.convexity;
  if (!(far > near)) throw new RangeError('Mirror far plane must lie beyond the glass');
  camera.near = near;
  camera.far = far;
  camera.projectionMatrix.makePerspective(
    centerX - spanX, centerX + spanX, centerY + spanY, centerY - spanY, near, far,
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
