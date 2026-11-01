import * as THREE from 'three';

// Where the camera looks from while the machine runs (#28, spec
// simulator.md 6): behind it, beside it (#136), high above it, or left
// where the user puts it.

export type CameraMode = 'follow' | 'overhead' | 'free' | 'side';

/** A camera's place and the point it looks at, course mm. */
export interface CameraView {
  eye: THREE.Vector3;
  target: THREE.Vector3;
}

/** Following: how far behind and above the machine the camera rides, and how far ahead of it it looks, mm (cosmetic). */
const FOLLOW = { back: 380, up: 170, ahead: 120 };
/** Overhead: how high above the machine, and how far back so the view is not straight down, mm (cosmetic). */
const OVERHEAD = { up: 1500, back: 350 };
/**
 * Beside the machine (#136, owner 2026-10-30; provisional, cosmetic): how far
 * out to its left, how high the camera rides and how high above the machine
 * it looks, mm. Low, so landings show.
 */
export const SIDE = { out: 450, up: 40, lift: 20 };
/**
 * Beside the machine the camera rises and falls slower than it goes along
 * (#136, owner 2026-10-30; provisional), so a jump and the bounce on landing
 * are not smoothed away.
 */
export const SIDE_EASE_Y = 0.03;
/**
 * How far ahead of and behind the machine fences between it and the side
 * camera are seen through (#136, owner 2026-10-30; provisional), mm.
 */
export const SEE_THROUGH_REACH = 300;
/** Share of the way to where it should be that the camera goes in a 60th of a second: smooth, not shaky (cosmetic). */
const EASE = 0.15;

/** Where the camera should be for a machine at `position` facing `quaternion`, course mm; null leaves it to the user. */
export function cameraView(mode: CameraMode, position: THREE.Vector3, heading: THREE.Vector3): CameraView | null {
  if (mode === 'free') return null;
  if (mode === 'side') {
    // Always on the machine's left, whichever way the course bends (owner, 2026-10-30).
    const left = new THREE.Vector3(0, 1, 0).cross(heading);
    return {
      eye: position.clone().addScaledVector(left, SIDE.out).add(new THREE.Vector3(0, SIDE.up, 0)),
      target: position.clone().add(new THREE.Vector3(0, SIDE.lift, 0)),
    };
  }
  const back = mode === 'follow' ? FOLLOW.back : OVERHEAD.back;
  const up = mode === 'follow' ? FOLLOW.up : OVERHEAD.up;
  return {
    eye: position.clone().addScaledVector(heading, -back).add(new THREE.Vector3(0, up, 0)),
    target: mode === 'follow' ? position.clone().addScaledVector(heading, FOLLOW.ahead) : position.clone(),
  };
}

/**
 * Points along the machine's way, up to `SEE_THROUGH_REACH` ahead and
 * behind, low and high on it: fences between these and the camera are
 * seen through in the side view (#136), course mm.
 */
export function seeThroughPoints(position: THREE.Vector3, heading: THREE.Vector3): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (const along of [-1, -0.5, 0, 0.5, 1]) {
    for (const y of [5, 30]) points.push(position.clone().addScaledVector(heading, along * SEE_THROUGH_REACH).add(new THREE.Vector3(0, y, 0)));
  }
  return points;
}

/** The way a machine faces, kept level so the camera does not roll or tip with it. */
export function levelHeading(quaternion: THREE.Quaternion, previous?: THREE.Vector3): THREE.Vector3 {
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion).setY(0);
  // Pointing straight up or down, it has no level way; keep the last one.
  if (f.lengthSq() < 0.01) return previous?.clone() ?? new THREE.Vector3(0, 0, 1);
  return f.normalize();
}

/** Eases a camera after a moving machine. */
export class RunCamera {
  private view: CameraView | null = null;
  private heading: THREE.Vector3 | undefined;
  /** Where the machine was at the last `next`, course mm. */
  private at = new THREE.Vector3();

  constructor(public mode: CameraMode = 'follow') {}

  /** Jump straight to the machine next time, as after a reset. */
  snap(): void {
    this.view = null;
    this.heading = undefined;
  }

  /** The level way the machine faced at the last `next`. */
  get facing(): THREE.Vector3 | undefined {
    return this.heading?.clone();
  }

  /** The camera's view for the machine where it is now, `dt` seconds after the last; null in the free mode. */
  next(position: THREE.Vector3, quaternion: THREE.Quaternion, dt: number): CameraView | null {
    this.heading = levelHeading(quaternion, this.heading);
    const goal = cameraView(this.mode, position, this.heading);
    if (!goal) return (this.view = null);
    if (!this.view) this.view = goal;
    else {
      const k = 1 - Math.pow(1 - EASE, dt * 60);
      if (this.mode !== 'side') {
        this.view.eye.lerp(goal.eye, k);
        this.view.target.lerp(goal.target, k);
      } else {
        // Seen from the side, a camera eased after the machine itself would
        // fall behind it across the picture; ease how it swings round the
        // machine instead, so the machine stays in the middle, and ease the
        // height on its own, slowly (#136).
        const ky = 1 - Math.pow(1 - SIDE_EASE_Y, dt * 60);
        for (const key of ['eye', 'target'] as const) {
          const v = this.view[key];
          const y = v.y + (goal[key].y - v.y) * ky;
          v.sub(this.at).lerp(goal[key].clone().sub(position), k).add(position).setY(y);
        }
      }
    }
    this.at.copy(position);
    return { eye: this.view.eye.clone(), target: this.view.target.clone() };
  }
}
