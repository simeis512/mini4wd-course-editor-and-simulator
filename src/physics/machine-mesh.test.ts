import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { rideHeight } from './machine';
import { buildShadow, placeShadow, shadowStrength } from './machine-mesh';
import { STANDARD_MACHINE } from './machine-spec';

const spec = STANDARD_MACHINE;
const resting = rideHeight(spec) * 1000;

describe('machine shadow (#99)', () => {
  it('is darkest on the road and fades as the machine flies', () => {
    expect(shadowStrength(spec, resting)).toBeGreaterThan(0.3);
    expect(shadowStrength(spec, resting + 50)).toBeLessThan(shadowStrength(spec, resting));
    expect(shadowStrength(spec, resting + 1000)).toBe(0);
  });

  it('lies on a tilted road along the way the machine faces', () => {
    const shadow = buildShadow(spec);
    const normal = new THREE.Vector3(0, 1, 1).normalize();
    const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    placeShadow(shadow, spec, new THREE.Vector3(0, resting, 0), turned, { point: new THREE.Vector3(0, 0, 0), normal });
    expect(shadow.visible).toBe(true);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(shadow.quaternion);
    expect(up.distanceTo(normal)).toBeLessThan(1e-9);
    // Its length (local Z) runs along the machine, which faces +X.
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(shadow.quaternion).x).toBeCloseTo(1, 9);
    placeShadow(shadow, spec, new THREE.Vector3(), turned, null);
    expect(shadow.visible).toBe(false);
  });
});
