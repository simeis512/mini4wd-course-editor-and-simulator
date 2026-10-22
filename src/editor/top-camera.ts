/**
 * Where the 2D view looks: the world point (mm) at its middle and its zoom.
 * Screen right is world −X and screen up is world +Z, so this is the view
 * from above.
 */
export class TopCamera {
  cx = 0;
  cz = 0;
  /** Zoom, px per mm. */
  scale = 0.2;

  /** Screen point (px from the top left of a `w` × `h` view) over a world point. */
  toScreen(x: number, z: number, w: number, h: number): [number, number] {
    return [w / 2 - (x - this.cx) * this.scale, h / 2 - (z - this.cz) * this.scale];
  }

  /** World X/Z under a screen point. */
  toWorld(sx: number, sy: number, w: number, h: number): [number, number] {
    return [this.cx - (sx - w / 2) / this.scale, this.cz - (sy - h / 2) / this.scale];
  }

  /** Zoom to `scale` keeping the world point under the screen point where it is. */
  zoomAt(sx: number, sy: number, scale: number, w: number, h: number): void {
    const [x, z] = this.toWorld(sx, sy, w, h);
    this.scale = Math.min(5, Math.max(0.01, scale));
    const [x2, z2] = this.toWorld(sx, sy, w, h);
    this.cx += x - x2;
    this.cz += z - z2;
  }

  /** Move the view so the world point under `from` comes under `to` (screen points). */
  pan(from: { x: number; y: number }, to: { x: number; y: number }, w: number, h: number): void {
    const [x0, z0] = this.toWorld(from.x, from.y, w, h);
    const [x1, z1] = this.toWorld(to.x, to.y, w, h);
    this.cx += x0 - x1;
    this.cz += z0 - z1;
  }

  /** Centre and zoom on the world points, with `margin` mm round them. */
  fit(points: readonly [number, number][], margin: number, w: number, h: number): void {
    if (points.length === 0) {
      this.cx = 0;
      this.cz = 0;
      this.scale = Math.min(w, h) / 2000;
      return;
    }
    const xs = points.map((p) => p[0]);
    const zs = points.map((p) => p[1]);
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    this.cx = (x0 + x1) / 2;
    this.cz = (z0 + z1) / 2;
    this.scale = Math.min(w / (x1 - x0 + 2 * margin), h / (z1 - z0 + 2 * margin));
  }
}
