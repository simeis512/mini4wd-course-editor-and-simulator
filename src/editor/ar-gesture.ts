import { angleDelta, twistAngle } from './ar-pose';

/** What the fingers on the AR screen ask for. */
export interface ArGestureHandlers {
  /** Whether gestures move the course now (it has been put down). */
  enabled(): boolean;
  /** One finger moved from one point on the screen to another. */
  onDrag(from: { x: number; y: number }, to: { x: number; y: number }): void;
  /** Two fingers turned by this much on the screen (radians, clockwise positive) about the point between them. */
  onTwist(turn: number, centre: { x: number; y: number }): void;
}

/** One-finger drag and two-finger twist on the AR screen (#19). */
export class ArGestures {
  private fingers = new Map<number, { x: number; y: number }>();

  constructor(el: HTMLElement, private handlers: ArGestureHandlers) {
    el.addEventListener('pointerdown', (e) => {
      if (!handlers.enabled()) return;
      el.setPointerCapture(e.pointerId);
      this.fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    el.addEventListener('pointermove', (e) => this.move(e));
    const lift = (e: PointerEvent) => this.fingers.delete(e.pointerId);
    el.addEventListener('pointerup', lift);
    el.addEventListener('pointercancel', lift);
  }

  private move(e: PointerEvent): void {
    const from = this.fingers.get(e.pointerId);
    if (!from) return;
    const to = { x: e.clientX, y: e.clientY };
    if (this.handlers.enabled()) {
      if (this.fingers.size === 1) this.handlers.onDrag(from, to);
      else if (this.fingers.size === 2) {
        const other = [...this.fingers].find(([id]) => id !== e.pointerId)![1];
        const centre = { x: (other.x + to.x) / 2, y: (other.y + to.y) / 2 };
        this.handlers.onTwist(angleDelta(twistAngle(other, from), twistAngle(other, to)), centre);
      }
    }
    this.fingers.set(e.pointerId, to);
  }

  /** Forget the fingers, at the end of a session. */
  clear(): void {
    this.fingers.clear();
  }
}
