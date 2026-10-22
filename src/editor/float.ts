// Where to float a settings box over the editor so it hides as little as
// possible of what it is about.

/** A screen rectangle in px, relative to the stage. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The smallest rectangle round some points. */
export function rectAround(points: readonly [number, number][]): Rect | null {
  if (points.length === 0) return null;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

/** Area two rectangles share, px². */
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Space kept from the stage edges, px. */
const MARGIN = 8;
/** Space kept between the box and what it is about, px. */
const GAP = 24;
/** How much covering 1 px² weighs against being 1 px further away. */
const DISTANCE_WEIGHT = 0.5;

/**
 * Top-left of a `w`×`h` box on a stage of `width`×`height`: beside `anchor`
 * (the selection) and covering as little of `avoid` (the selection, and
 * pieces it highlights) as it can, nearer spots first. Kept on the stage.
 */
export function floatSpot(w: number, h: number, width: number, height: number, anchor: Rect | null, avoid: readonly Rect[]): [number, number] {
  const clamp = ([x, y]: [number, number]): [number, number] => [
    Math.max(MARGIN, Math.min(x, width - w - MARGIN)),
    Math.max(MARGIN, Math.min(y, height - h - MARGIN)),
  ];
  const corner = clamp([width - w - MARGIN, MARGIN]);
  if (!anchor) return corner;
  const cx = (anchor.left + anchor.right) / 2;
  const cy = (anchor.top + anchor.bottom) / 2;
  const spots = [
    [anchor.right + GAP, cy - h / 2],
    [anchor.left - GAP - w, cy - h / 2],
    [cx - w / 2, anchor.bottom + GAP],
    [cx - w / 2, anchor.top - GAP - h],
    [width, 0],
    [0, 0],
    [width, height],
    [0, height],
  ].map((s) => clamp(s as [number, number]));
  let best = corner;
  let bestScore = Infinity;
  for (const [x, y] of spots) {
    const box = { left: x, top: y, right: x + w, bottom: y + h };
    const covered = avoid.reduce((sum, r) => sum + overlap(box, r), 0);
    const distance = Math.hypot(
      Math.max(0, box.left - anchor.right, anchor.left - box.right),
      Math.max(0, box.top - anchor.bottom, anchor.top - box.bottom),
    );
    const score = covered + distance * DISTANCE_WEIGHT;
    if (score < bestScore) [best, bestScore] = [[x, y], score];
  }
  return best;
}

/** Room kept under a box in the bottom right corner, for the "全体を表示" button, px. */
const FIT_BUTTON_ROOM = 56;

/**
 * Top-left of a `w`×`h` box on a stage of `width`×`height` that always
 * stands in the same place whatever is selected (#64): the top right
 * corner, or when that would cover `avoid` (the selection and the pieces
 * it highlights) the bottom right and then the top left, whichever covers
 * least, in that order.
 */
export function cornerSpot(w: number, h: number, width: number, height: number, avoid: readonly Rect[]): [number, number] {
  const right = Math.max(MARGIN, width - w - MARGIN);
  const spots: [number, number][] = [
    [right, MARGIN],
    [right, Math.max(MARGIN, height - h - FIT_BUTTON_ROOM)],
    [MARGIN, MARGIN],
  ];
  let best = spots[0];
  let bestCovered = Infinity;
  for (const [x, y] of spots) {
    const box = { left: x, top: y, right: x + w, bottom: y + h };
    const covered = avoid.reduce((sum, r) => sum + overlap(box, r), 0);
    if (covered < bestCovered) [best, bestCovered] = [[x, y], covered];
    if (covered === 0) break;
  }
  return best;
}
