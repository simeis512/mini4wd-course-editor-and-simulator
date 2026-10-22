/** Steps the turn buttons go round by, degrees. */
export const TURN_STEP_DEG = 15;
/** A twist that ends this close to square (degrees) settles on it, so the course can be put straight again by hand. */
const SQUARE_SNAP_DEG = 3;

/** The angle in degrees, in [0, 360). */
export function normalDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** `deg` settled on the nearest multiple of 90 when it is within the snap. */
export function snapSquare(deg: number): number {
  const square = Math.round(deg / 90) * 90;
  return Math.abs(deg - square) <= SQUARE_SNAP_DEG ? normalDeg(square) : normalDeg(deg);
}

/**
 * Where the 2D view looks: the world point (mm) at its middle, its zoom and
 * how far it is turned. Unturned, screen right is world −X and screen up is
 * world +Z, so this is the view from above; turning goes clockwise on the
 * screen (#75: the owner wanted to turn the 2D view for the share picture).
 */
export class TopCamera {
  cx = 0;
  cz = 0;
  /** Zoom, px per mm. */
  scale = 0.2;
  /** Turn, degrees clockwise on the screen, in [0, 360). */
  angle = 0;

  private get turn(): [number, number] {
    const a = (this.angle * Math.PI) / 180;
    return [Math.cos(a), Math.sin(a)];
  }

  /** Screen point (px from the top left of a `w` × `h` view) over a world point. */
  toScreen(x: number, z: number, w: number, h: number): [number, number] {
    const [c, s] = this.turn;
    const dx = -(x - this.cx) * this.scale;
    const dy = -(z - this.cz) * this.scale;
    return [w / 2 + dx * c - dy * s, h / 2 + dx * s + dy * c];
  }

  /** World X/Z under a screen point. */
  toWorld(sx: number, sy: number, w: number, h: number): [number, number] {
    const [c, s] = this.turn;
    const rx = sx - w / 2;
    const ry = sy - h / 2;
    const dx = rx * c + ry * s;
    const dy = -rx * s + ry * c;
    return [this.cx - dx / this.scale, this.cz - dy / this.scale];
  }

  /** Zoom to `scale` keeping the world point under the screen point where it is. */
  zoomAt(sx: number, sy: number, scale: number, w: number, h: number): void {
    this.keeping(sx, sy, w, h, () => (this.scale = Math.min(5, Math.max(0.01, scale))));
  }

  /** Turn to `angle` (degrees) keeping the world point under the screen point where it is. */
  turnAt(sx: number, sy: number, angle: number, w: number, h: number): void {
    this.keeping(sx, sy, w, h, () => (this.angle = normalDeg(angle)));
  }

  /** Move the view so the world point under `from` comes under `to` (screen points). */
  pan(from: { x: number; y: number }, to: { x: number; y: number }, w: number, h: number): void {
    const [x0, z0] = this.toWorld(from.x, from.y, w, h);
    const [x1, z1] = this.toWorld(to.x, to.y, w, h);
    this.cx += x0 - x1;
    this.cz += z0 - z1;
  }

  /** Centre and zoom on the world points as the view is turned, with `margin` mm round them. */
  fit(points: readonly [number, number][], margin: number, w: number, h: number): void {
    if (points.length === 0) {
      this.cx = 0;
      this.cz = 0;
      this.scale = Math.min(w, h) / 2000;
      return;
    }
    // The points' extent along the screen's axes, in mm.
    const [c, s] = this.turn;
    const us = points.map(([x, z]) => -x * c + z * s);
    const vs = points.map(([x, z]) => -x * s - z * c);
    const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
    const [u, v] = [(u0 + u1) / 2, (v0 + v1) / 2];
    this.cx = -u * c - v * s;
    this.cz = u * s - v * c;
    this.scale = Math.min(w / (u1 - u0 + 2 * margin), h / (v1 - v0 + 2 * margin));
  }

  private keeping(sx: number, sy: number, w: number, h: number, change: () => void): void {
    const [x, z] = this.toWorld(sx, sy, w, h);
    change();
    const [x2, z2] = this.toWorld(sx, sy, w, h);
    this.cx += x - x2;
    this.cz += z - z2;
  }
}
