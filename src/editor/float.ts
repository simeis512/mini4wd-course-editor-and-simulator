// Where to float the selection's settings over the editor: always in the
// same corner, moving only to keep off what it is about (#64).

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
