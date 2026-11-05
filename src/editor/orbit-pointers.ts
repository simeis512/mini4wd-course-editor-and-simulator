import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// OrbitControls listens for pointermove and pointerup on the whole document
// once a finger is down on the canvas, and takes every finger's moves as its
// own: a second finger on the side panel then swings the camera wildly
// (#147, three 0.186). Only the fingers it is following may reach it.

/** The parts of OrbitControls this reaches into; they are not in its typings (three 0.186). */
interface OrbitInternals {
  _isTrackingPointer(e: PointerEvent): boolean;
  _onPointerMove(e: PointerEvent): void;
  _onPointerUp(e: PointerEvent): void;
}

/**
 * Let only the pointers the controls follow move or release them. Call
 * before `connect`, which adds these handlers as listeners.
 */
export function followOwnPointers(controls: OrbitControls): void {
  const c = controls as unknown as OrbitInternals;
  for (const name of ['_isTrackingPointer', '_onPointerMove', '_onPointerUp'] as const) {
    // A newer three may rename them: fail loudly rather than let the bug back in.
    if (typeof c[name] !== 'function') throw new Error(`OrbitControls has no ${name}`);
  }
  const move = c._onPointerMove;
  const up = c._onPointerUp;
  c._onPointerMove = (e) => {
    if (c._isTrackingPointer(e)) move(e);
  };
  c._onPointerUp = (e) => {
    if (c._isTrackingPointer(e)) up(e);
  };
}
