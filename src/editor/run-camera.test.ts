import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { cameraView, levelHeading, RunCamera, SEE_THROUGH_REACH, seeThroughPoints, SIDE, SIDE_EASE_Y } from './run-camera';

const facing = (yaw: number, roll = 0) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), roll));

describe('run camera (#28)', () => {
  it('rides behind and above the machine, looking ahead of it', () => {
    const v = cameraView('follow', new Vector3(100, 0, 0), new Vector3(0, 0, 1))!;
    expect(v.eye.z).toBeLessThan(0);
    expect(v.eye.y).toBeGreaterThan(0);
    expect(v.target.z).toBeGreaterThan(0);
    expect(v.target.x).toBe(100);
  });

  it('looks down from high above, and leaves the camera alone when free', () => {
    const v = cameraView('overhead', new Vector3(), new Vector3(1, 0, 0))!;
    expect(v.eye.y).toBeGreaterThan(1000);
    expect(v.target.length()).toBe(0);
    expect(cameraView('free', new Vector3(), new Vector3(1, 0, 0))).toBeNull();
  });

  it('keeps level whatever the machine does, and the last way when it points up', () => {
    expect(levelHeading(facing(Math.PI / 2, 0.5)).toArray().map((n) => +n.toFixed(6))).toEqual([1, 0, 0]);
    const up = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    expect(levelHeading(up, new Vector3(0, 0, -1)).z).toBe(-1);
  });

  it('eases after the machine, and jumps to it after a snap', () => {
    const cam = new RunCamera('follow');
    const first = cam.next(new Vector3(), facing(0), 0)!;
    const moved = cam.next(new Vector3(0, 0, 1000), facing(0), 1 / 60)!;
    expect(moved.eye.z - first.eye.z).toBeGreaterThan(0);
    expect(moved.eye.z - first.eye.z).toBeLessThan(1000);
    cam.snap();
    expect(cam.next(new Vector3(0, 0, 1000), facing(0), 1 / 60)!.eye.z).toBeCloseTo(1000 - 380);
  });
});

describe('side camera (#136)', () => {
  it('rides low on the left of the way the machine goes, looking at it', () => {
    // Facing +z, the machine's left is +x.
    const v = cameraView('side', new Vector3(100, 50, 0), new Vector3(0, 0, 1))!;
    expect(v.eye.toArray()).toEqual([100 + SIDE.out, 50 + SIDE.up, 0]);
    expect(v.target.toArray()).toEqual([100, 50 + SIDE.lift, 0]);
    // Turned the other way, it goes round to the other side.
    const back = cameraView('side', new Vector3(), new Vector3(0, 0, -1))!;
    expect(back.eye.x).toBeCloseTo(-SIDE.out);
  });

  it('keeps the machine in the middle going along, and follows a jump up slowly', () => {
    const cam = new RunCamera('side');
    cam.next(new Vector3(), facing(0), 0);
    const v = cam.next(new Vector3(0, 100, 100), facing(0), 1 / 60)!;
    expect(v.target.z).toBeCloseTo(100);
    expect(v.eye.z).toBeCloseTo(100);
    expect(v.target.y).toBeCloseTo(SIDE.lift + 100 * SIDE_EASE_Y);
  });

  it('swings round smoothly when the machine turns', () => {
    const cam = new RunCamera('side');
    cam.next(new Vector3(), facing(0), 0);
    const v = cam.next(new Vector3(), facing(Math.PI / 2), 1 / 60)!;
    // Facing +x the camera belongs at -z; it has only started to go there.
    expect(v.eye.x).toBeCloseTo(SIDE.out * 0.85);
    expect(v.eye.z).toBeCloseTo(-SIDE.out * 0.15);
  });

  it('looks through fences up to SEE_THROUGH_REACH ahead and behind', () => {
    const points = seeThroughPoints(new Vector3(), new Vector3(0, 0, 1));
    const zs = points.map((p) => p.z);
    expect(Math.min(...zs)).toBe(-SEE_THROUGH_REACH);
    expect(Math.max(...zs)).toBe(SEE_THROUGH_REACH);
    expect(points.every((p) => p.x === 0 && p.y > 0)).toBe(true);
  });
});
