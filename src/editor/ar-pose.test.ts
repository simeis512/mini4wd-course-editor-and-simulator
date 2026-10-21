import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MM } from '../course/mesh';
import { angleDelta, AR_SCALES, arPose, dotCell, floorPivot, headingOf, nextScale, scaleLabel, turnAbout, twistAngle } from './ar-pose';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function expectNear(a: THREE.Vector3, b: THREE.Vector3): void {
  expect(a.distanceTo(b)).toBeLessThan(1e-9);
}

describe('arPose', () => {
  it('puts the pivot on the floor point', () => {
    const m = arPose(v(300, 0, -200), v(0.5, -1.1, -1.4), 0.7, 1 / 10);
    expectNear(v(300, 0, -200).applyMatrix4(m), v(0.5, -1.1, -1.4));
  });

  it('shows the course at real size or smaller', () => {
    const at = v(0, 0, 0);
    expectNear(v(1000, 0, 0).applyMatrix4(arPose(v(0, 0, 0), at, 0, 1)), v(1000 * MM, 0, 0));
    expectNear(v(1000, 0, 0).applyMatrix4(arPose(v(0, 0, 0), at, 0, 1 / 10)), v(0.1, 0, 0));
  });

  it('turns the course about the pivot', () => {
    const m = arPose(v(0, 0, 0), v(1, 0, 1), Math.PI / 2, 1);
    // +Z of the course points along scene +X after a quarter turn.
    expectNear(v(0, 0, 1000).applyMatrix4(m), v(2, 0, 1));
  });
});

describe('headingOf', () => {
  it('points the course +Z where the viewer looks, ignoring tilt', () => {
    const yaw = headingOf(v(0, -0.8, -1));
    expectNear(v(0, 0, 1).applyAxisAngle(v(0, 1, 0), yaw), v(0, 0, -1));
    expect(headingOf(v(1, 0.5, 0))).toBeCloseTo(Math.PI / 2);
  });

  it('keeps the course unturned when looking straight down', () => {
    expect(headingOf(v(0, -1, 0))).toBe(0);
  });
});

describe('floorPivot', () => {
  it('takes the middle of the underside', () => {
    expectNear(floorPivot(new THREE.Box3(v(-100, 0, 0), v(300, 120, 500))), v(100, 0, 250));
    expectNear(floorPivot(new THREE.Box3()), v(0, 0, 0));
  });
});

describe('scales', () => {
  it('goes round the sizes, starting at real size', () => {
    expect(AR_SCALES[0]).toBe(1);
    let s: number = AR_SCALES[0];
    const seen = [];
    for (let i = 0; i < AR_SCALES.length; i++) {
      seen.push(scaleLabel(s));
      s = nextScale(s);
    }
    expect(seen).toEqual(['実寸', '1/5', '1/10', '1/20']);
    expect(s).toBe(1);
  });
});

describe('dotCell', () => {
  it('gives nearby points one cell and farther ones another', () => {
    expect(dotCell(v(0.01, -1.2, 0.51), 0.05)).toBe(dotCell(v(0.0, -1.21, 0.49), 0.05));
    expect(dotCell(v(0.1, -1.2, 0.5), 0.05)).not.toBe(dotCell(v(0, -1.2, 0.5), 0.05));
  });
});

describe('twist', () => {
  it('measures the fingers turning, the short way round', () => {
    const before = twistAngle({ x: 0, y: 0 }, { x: 100, y: 0 });
    const after = twistAngle({ x: 0, y: 0 }, { x: 0, y: 100 });
    expect(angleDelta(before, after)).toBeCloseTo(Math.PI / 2);
    expect(angleDelta(after, before)).toBeCloseTo(-Math.PI / 2);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
    expect(angleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2);
  });
});

describe('turnAbout', () => {
  it('keeps the turning centre where it is', () => {
    const pivot = v(100, 0, 200);
    const at = v(0.5, -1.2, -1.5);
    const centre = v(0.8, -1.2, -1.0);
    const yaw = 0.3;
    const turn = 0.9;
    // The course point over the centre before the turn...
    const before = arPose(pivot, at, yaw, 1 / 5);
    const under = centre.clone().applyMatrix4(before.clone().invert());
    // ...is still there after it.
    const after = arPose(pivot, turnAbout(at, centre, turn), yaw + turn, 1 / 5);
    expectNear(under.applyMatrix4(after), centre);
  });
});
