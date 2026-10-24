import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { cameraView, levelHeading, RunCamera } from './run-camera';

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
