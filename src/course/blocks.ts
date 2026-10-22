import { Matrix4, Vector3 } from 'three';

// Box-shaped things placed in the world, such as the lap timer and the
// cardboard boxes (#56, #53): one description that both views draw from.

/** A box `size` mm big (X across, Y up, Z along), centred on `frame` (world mm). */
export interface Block {
  frame: Matrix4;
  size: [number, number, number];
  /** What it is part of, for its colour. */
  role: string;
}

/** The frame `right`, `up` and `along` mm from `frame`, in its own directions (+ X is left). */
export function offsetFrame(frame: Matrix4, right: number, up: number, along: number): Matrix4 {
  return frame.clone().multiply(new Matrix4().makeTranslation(-right, up, along));
}

/** The eight corners of a block, world mm. */
export function blockCorners(b: Block): Vector3[] {
  const [w, h, d] = b.size.map((s) => s / 2);
  const out: Vector3[] = [];
  for (const x of [-w, w]) for (const y of [-h, h]) for (const z of [-d, d]) out.push(new Vector3(x, y, z).applyMatrix4(b.frame));
  return out;
}

/** The smallest convex outline round points on the floor, anticlockwise (X, Z). */
export function convexHull(points: readonly [number, number][]): [number, number][] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: [number, number][]) => {
    const out: [number, number][] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half(pts.slice().reverse())];
}

/** A block seen from above: the outline it covers on the floor (X, Z). */
export function blockFootprint(b: Block): [number, number][] {
  return convexHull(blockCorners(b).map((p) => [p.x, p.z]));
}
