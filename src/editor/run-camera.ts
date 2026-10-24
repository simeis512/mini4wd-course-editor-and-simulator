import * as THREE from 'three';

// Where the camera looks from while the machine runs (#28, spec
// simulator.md 6): behind it, high above it, or left where the user puts it.

export type CameraMode = 'follow' | 'overhead' | 'free';

/** A camera's place and the point it looks at, course mm. */
export interface CameraView {
  eye: THREE.Vector3;
  target: THREE.Vector3;
}

/** Following: how far behind and above the machine the camera rides, and how far ahead of it it looks, mm (cosmetic). */
const FOLLOW = { back: 380, up: 170, ahead: 120 };
/** Overhead: how high above the machine, and how far back so the view is not straight down, mm (cosmetic). */
const OVERHEAD = { up: 1500, back: 350 };
/** Share of the way to where it should be that the camera goes in a 60th of a second: smooth, not shaky (cosmetic). */
const EASE = 0.15;

/** Where the camera should be for a machine at `position` facing `quaternion`, course mm; null leaves it to the user. */
export function cameraView(mode: CameraMode, position: THREE.Vector3, heading: THREE.Vector3): CameraView | null {
  if (mode === 'free') return null;
  const back = mode === 'follow' ? FOLLOW.back : OVERHEAD.back;
  const up = mode === 'follow' ? FOLLOW.up : OVERHEAD.up;
  return {
    eye: position.clone().addScaledVector(heading, -back).add(new THREE.Vector3(0, up, 0)),
    target: mode === 'follow' ? position.clone().addScaledVector(heading, FOLLOW.ahead) : position.clone(),
  };
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

  constructor(public mode: CameraMode = 'follow') {}

  /** Jump straight to the machine next time, as after a reset. */
  snap(): void {
    this.view = null;
    this.heading = undefined;
  }

  /** The camera's view for the machine where it is now, `dt` seconds after the last; null in the free mode. */
  next(position: THREE.Vector3, quaternion: THREE.Quaternion, dt: number): CameraView | null {
    this.heading = levelHeading(quaternion, this.heading);
    const goal = cameraView(this.mode, position, this.heading);
    if (!goal) return (this.view = null);
    if (!this.view) this.view = goal;
    else {
      const k = 1 - Math.pow(1 - EASE, dt * 60);
      this.view.eye.lerp(goal.eye, k);
      this.view.target.lerp(goal.target, k);
    }
    return { eye: this.view.eye.clone(), target: this.view.target.clone() };
  }
}
