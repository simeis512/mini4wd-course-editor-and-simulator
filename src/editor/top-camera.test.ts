import { describe, expect, it } from 'vitest';
import { normalDeg, snapSquare, TopCamera } from './top-camera';

const W = 800;
const H = 600;

function camera(angle: number): TopCamera {
  const c = new TopCamera();
  Object.assign(c, { cx: 120, cz: -340, scale: 0.37, angle });
  return c;
}

describe('TopCamera', () => {
  it('looks from above when unturned: world −X to the right, +Z up', () => {
    const c = camera(0);
    const [x0, y0] = c.toScreen(c.cx, c.cz, W, H);
    expect([x0, y0]).toEqual([W / 2, H / 2]);
    const [xr] = c.toScreen(c.cx - 100, c.cz, W, H);
    const [, yu] = c.toScreen(c.cx, c.cz + 100, W, H);
    expect(xr).toBeGreaterThan(W / 2);
    expect(yu).toBeLessThan(H / 2);
  });

  it('turns clockwise on the screen', () => {
    // World −X is screen right unturned; a quarter turn clockwise puts it at the bottom.
    const c = camera(90);
    const [x, y] = c.toScreen(c.cx - 100, c.cz, W, H);
    expect(x).toBeCloseTo(W / 2);
    expect(y).toBeGreaterThan(H / 2);
  });

  it('converts back and forth at any turn', () => {
    for (const angle of [0, 15, 90, 137, 270, 359]) {
      const c = camera(angle);
      const [sx, sy] = c.toScreen(503, 1234, W, H);
      const [x, z] = c.toWorld(sx, sy, W, H);
      expect(x).toBeCloseTo(503);
      expect(z).toBeCloseTo(1234);
    }
  });

  it('keeps the point under the pointer when zooming or turning', () => {
    const c = camera(30);
    const before = c.toWorld(100, 50, W, H);
    c.zoomAt(100, 50, 1.2, W, H);
    expect(c.toWorld(100, 50, W, H)[0]).toBeCloseTo(before[0]);
    c.turnAt(100, 50, 75, W, H);
    const after = c.toWorld(100, 50, W, H);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
    expect(c.angle).toBe(75);
  });

  it('pans so the grabbed point follows the pointer', () => {
    const c = camera(200);
    const grabbed = c.toWorld(300, 300, W, H);
    c.pan({ x: 300, y: 300 }, { x: 420, y: 250 }, W, H);
    const now = c.toWorld(420, 250, W, H);
    expect(now[0]).toBeCloseTo(grabbed[0]);
    expect(now[1]).toBeCloseTo(grabbed[1]);
  });

  it('fits a long course across the screen when turned so it lies across', () => {
    // 3000 mm along Z, 1000 mm along X: upright unturned, lying across at 90°.
    const points: [number, number][] = [
      [0, 0],
      [1000, 0],
      [1000, 3000],
      [0, 3000],
    ];
    const upright = camera(0);
    upright.fit(points, 0, W, H);
    const across = camera(90);
    across.fit(points, 0, W, H);
    expect(across.scale).toBeGreaterThan(upright.scale);
    for (const c of [upright, across]) {
      expect(c.cx).toBeCloseTo(500);
      expect(c.cz).toBeCloseTo(1500);
      const ys = points.map(([x, z]) => c.toScreen(x, z, W, H));
      for (const [sx, sy] of ys) {
        expect(sx).toBeGreaterThanOrEqual(-1e-6);
        expect(sx).toBeLessThanOrEqual(W + 1e-6);
        expect(sy).toBeGreaterThanOrEqual(-1e-6);
        expect(sy).toBeLessThanOrEqual(H + 1e-6);
      }
    }
    expect(across.scale).toBeCloseTo(W / 3000);
  });
});

describe('angles', () => {
  it('normalises to [0, 360)', () => {
    expect(normalDeg(-15)).toBe(345);
    expect(normalDeg(375)).toBe(15);
  });

  it('settles a twist near square on it', () => {
    expect(snapSquare(88)).toBe(90);
    expect(snapSquare(-2)).toBe(0);
    expect(snapSquare(358.5)).toBe(0);
    expect(snapSquare(80)).toBe(80);
  });
});
