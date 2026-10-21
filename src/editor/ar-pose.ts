import * as THREE from 'three';
import { MM } from '../course/mesh';

/** Sizes the course can be shown at in AR, as a share of real size; the first is the default (#19, provisional). */
export const AR_SCALES = [1, 1 / 5, 1 / 10, 1 / 20] as const;

/** How far one press of a turn button turns the course, degrees (the angle snap of spec 8). */
export const AR_TURN_STEP = 15;

/** The name of an AR size on its button. */
export function scaleLabel(scale: number): string {
  return scale === 1 ? '実寸' : `1/${Math.round(1 / scale)}`;
}

/** The size after `scale` when the size button is pressed, going round. */
export function nextScale(scale: number): number {
  const i = AR_SCALES.findIndex((s) => s === scale);
  return AR_SCALES[(i + 1) % AR_SCALES.length];
}

/** Turn about the up axis (radians) that points the course's +Z along `forward`, flattened onto the floor. */
export function headingOf(forward: THREE.Vector3): number {
  return Math.abs(forward.x) + Math.abs(forward.z) < 1e-9 ? 0 : Math.atan2(forward.x, forward.z);
}

/**
 * Transform for the course root (course mm to scene m) that puts the
 * course point `pivot` (mm) on the scene point `at` (m), turned by `yaw`
 * about the up axis and shown at `scale` of real size.
 */
export function arPose(pivot: THREE.Vector3, at: THREE.Vector3, yaw: number, scale: number): THREE.Matrix4 {
  return new THREE.Matrix4()
    .makeTranslation(at.x, at.y, at.z)
    .multiply(new THREE.Matrix4().makeRotationY(yaw))
    .multiply(new THREE.Matrix4().makeScale(MM * scale, MM * scale, MM * scale))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

/** The point of a course box (mm) that sits on the floor: the middle of its underside. */
export function floorPivot(box: THREE.Box3): THREE.Vector3 {
  if (box.isEmpty()) return new THREE.Vector3();
  const c = box.getCenter(new THREE.Vector3());
  return c.setY(box.min.y);
}
