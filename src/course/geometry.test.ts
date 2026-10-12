import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { getPart } from './catalog';
import { attach, facingError, matrixToPose, partGeometry, poseToMatrix, sampleCenterline } from './geometry';

const pos = (m: Matrix4) => new Vector3().setFromMatrixPosition(m);
const forward = (m: Matrix4) => new Vector3(0, 0, 1).transformDirection(m);

describe('sampleCenterline', () => {
  it('runs a straight along +Z', () => {
    const frames = sampleCenterline([{ length: 540 }]);
    const end = frames[frames.length - 1];
    expect(pos(end).distanceTo(new Vector3(0, 0, 540))).toBeLessThan(1e-9);
  });

  it('turns a 45° curve to the left on a 540 mm radius', () => {
    const end = partGeometry(getPart('curve45')).ports[1];
    // Left is +X; centre of the arc at (540, 0, 0).
    const r = 540;
    const a = Math.PI / 4;
    expect(pos(end).distanceTo(new Vector3(r - r * Math.cos(a), 0, r * Math.sin(a)))).toBeLessThan(1e-6);
    expect(forward(end).angleTo(new Vector3(Math.sin(a), 0, Math.cos(a)))).toBeLessThan(1e-9);
  });

  it('climbs with positive pitch and lowers the right side with positive roll', () => {
    const climb = sampleCenterline([{ length: 100, pitch: 10 }]).at(-1)!;
    expect(pos(climb).y).toBeGreaterThan(0);
    const bank = sampleCenterline([{ length: 100, roll: 20 }]).at(-1)!;
    const right = new Vector3(-1, 0, 0).transformDirection(bank);
    expect(right.y).toBeCloseTo(-Math.sin((20 * Math.PI) / 180), 9);
  });
});

describe('ports', () => {
  it('points the start port backwards out of the part', () => {
    const start = partGeometry(getPart('straight')).ports[0];
    expect(forward(start).z).toBeCloseTo(-1, 12);
  });

  it('attaches a piece so the two ports face each other exactly', () => {
    const straight = partGeometry(getPart('straight'));
    const target = poseToMatrix({ pos: [100, 20, -30], rot: [33, 5, 12] });
    const piece = attach(target, straight.ports[1]);
    const err = facingError(target, piece.clone().multiply(straight.ports[1]));
    expect(err.distance).toBeLessThan(1e-9);
    expect(err.angle).toBeLessThan(1e-4);
  });
});

describe('poses', () => {
  it('round-trips yaw, pitch and roll', () => {
    const pose = { pos: [12.3, -4.5, 600] as [number, number, number], rot: [-123.4, 15, 20] as [number, number, number] };
    expect(matrixToPose(poseToMatrix(pose))).toEqual(pose);
  });
});
