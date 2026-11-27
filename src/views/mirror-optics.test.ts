import { describe, expect, it } from 'vitest';
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { applyMirrorCamera, reflectPoint, type MirrorGlass } from './mirror-optics';

function glassAt(
  center: Vector3, yawRad = 0, pitchRad = 0, halfSizeM: [number, number] = [0.11, 0.065], convexity = 1,
): MirrorGlass {
  return {
    center,
    quaternion: new Quaternion().setFromEuler(new Euler(pitchRad, yawRad, 0, 'YXZ')),
    halfSizeM,
    convexity,
  };
}

function ndc(camera: PerspectiveCamera, point: Vector3): Vector3 {
  return point.clone().project(camera);
}

/** A far world point seen from the eye by way of the given point on the glass. */
function reflectedTarget(eye: Vector3, glass: MirrorGlass, onGlass: Vector3, distance = 10): Vector3 {
  const normal = new Vector3(0, 0, 1).applyQuaternion(glass.quaternion);
  const incoming = onGlass.clone().sub(eye).normalize();
  const outgoing = incoming.clone().addScaledVector(normal, -2 * incoming.dot(normal));
  return onGlass.clone().addScaledVector(outgoing, distance);
}

describe('mirror optics', () => {
  it('reflects the eye across the glass plane', () => {
    const glass = glassAt(new Vector3());
    const reflected = reflectPoint(new Vector3(0.1, 0.2, 0.7), glass);
    expect(reflected.x).toBeCloseTo(0.1, 9);
    expect(reflected.y).toBeCloseTo(0.2, 9);
    expect(reflected.z).toBeCloseTo(-0.7, 9);
  });

  it('maps the reflected centre ray to the glass centre', () => {
    const eye = new Vector3(-0.36, 0.6, -0.665);
    const glass = glassAt(new Vector3(-0.96, 0.43, -1.45), 20 * Math.PI / 180, -5 * Math.PI / 180);
    const camera = new PerspectiveCamera();
    applyMirrorCamera(camera, eye, glass, 100);
    const projected = ndc(camera, reflectedTarget(eye, glass, glass.center));
    expect(projected.x).toBeCloseTo(0, 6);
    expect(projected.y).toBeCloseTo(0, 6);
  });

  it('maps reflected corner rays to the matching corners', () => {
    const eye = new Vector3(-0.36, 0.6, -0.665);
    const glass = glassAt(new Vector3(-0.96, 0.43, -1.45), 25 * Math.PI / 180, -3 * Math.PI / 180);
    const camera = new PerspectiveCamera();
    applyMirrorCamera(camera, eye, glass, 100);
    const corner = new Vector3(glass.halfSizeM[0], glass.halfSizeM[1], 0)
      .applyQuaternion(glass.quaternion).add(glass.center);
    const projected = ndc(camera, reflectedTarget(eye, glass, corner));
    // Glass local +X (UV u = 1) lands at NDC x = -1: the render target texture is shown
    // with repeat.x = -1, so texture u = 0 (NDC -1) appears at glass u = 1, which keeps
    // an object on the glass's +X side on that same side of the displayed mirror image.
    expect(projected.x).toBeCloseTo(-1, 6);
    expect(projected.y).toBeCloseTo(1, 6);
  });

  it('puts the near plane on the glass', () => {
    const eye = new Vector3(0.2, 0.1, 0.9);
    const glass = glassAt(new Vector3(), 0.3, 0.1);
    const camera = new PerspectiveCamera();
    applyMirrorCamera(camera, eye, glass, 100);
    const onPlane = new Vector3(0.03, -0.02, 0).applyQuaternion(glass.quaternion).add(glass.center);
    expect(ndc(camera, onPlane).z).toBeCloseTo(-1, 6);
  });

  it('widens the view by the convexity factor', () => {
    const eye = new Vector3(0, 0, 1);
    const halfWidthTan = (convexity: number) => {
      const camera = new PerspectiveCamera();
      applyMirrorCamera(camera, eye, glassAt(new Vector3(), 0, 0, [0.11, 0.065], convexity), 100);
      const e = camera.projectionMatrix.elements;
      // Symmetric case: x_ndc = (2n / (r - l)) * x / -z, so tan(half angle) = 1 / e[0].
      return 1 / e[0]!;
    };
    expect(halfWidthTan(1)).toBeCloseTo(0.11, 9);
    expect(halfWidthTan(1.3)).toBeCloseTo(0.11 * 1.3, 9);
  });

  it('rejects an eye on or behind the glass', () => {
    const camera = new PerspectiveCamera();
    const glass = glassAt(new Vector3());
    expect(() => applyMirrorCamera(camera, new Vector3(0, 0, 0), glass, 100)).toThrow(RangeError);
    expect(() => applyMirrorCamera(camera, new Vector3(0, 0, -0.5), glass, 100)).toThrow(RangeError);
  });
});
