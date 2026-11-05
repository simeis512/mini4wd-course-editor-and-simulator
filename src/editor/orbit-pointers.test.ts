import { PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { describe, expect, it } from 'vitest';
import { followOwnPointers } from './orbit-pointers';

type Listener = (e: unknown) => void;

/** Just enough of an element and its document for OrbitControls to listen on. */
class FakeTarget {
  listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, f: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(f);
  }
  removeEventListener(type: string, f: Listener) {
    this.listeners.get(type)?.delete(f);
  }
  fire(type: string, e: unknown) {
    for (const f of [...(this.listeners.get(type) ?? [])]) f(e);
  }
}

class FakeCanvas extends FakeTarget {
  ownerDocument = new FakeTarget();
  style: Record<string, string> = {};
  clientWidth = 400;
  clientHeight = 800;
  getRootNode() {
    return this.ownerDocument;
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 400, height: 800 };
  }
}

const touch = (pointerId: number, pageX: number, pageY: number) => ({ pointerId, pointerType: 'touch', pageX, pageY, clientX: pageX, clientY: pageY, button: 0 });

/** A finger on the canvas held still, another finger moving on the side panel, as #147 reports; how far the camera turned. */
function strayFinger(fix: boolean): number {
  const camera = new PerspectiveCamera();
  camera.position.set(0, 1, 3);
  const controls = new OrbitControls(camera);
  if (fix) followOwnPointers(controls);
  const canvas = new FakeCanvas();
  controls.connect(canvas as unknown as HTMLElement);
  controls.enableDamping = false;
  const start = camera.position.clone();
  canvas.fire('pointerdown', touch(1, 200, 300));
  // The side panel is below the course on a phone.
  canvas.ownerDocument.fire('pointermove', touch(2, 200, 700));
  canvas.ownerDocument.fire('pointermove', touch(2, 230, 700));
  canvas.ownerDocument.fire('pointerup', touch(2, 230, 700));
  controls.update();
  return camera.position.distanceTo(start);
}

describe('OrbitControls follows only its own fingers (#147)', () => {
  it('is swung round by another finger without the fix', () => {
    expect(strayFinger(false)).toBeGreaterThan(0.5);
  });

  it('stays put with the fix while the other finger moves elsewhere', () => {
    expect(strayFinger(true)).toBeCloseTo(0, 6);
  });

  it('still turns with its own finger', () => {
    const camera = new PerspectiveCamera();
    camera.position.set(0, 1, 3);
    const controls = new OrbitControls(camera);
    followOwnPointers(controls);
    const canvas = new FakeCanvas();
    controls.connect(canvas as unknown as HTMLElement);
    const start = camera.position.clone();
    canvas.fire('pointerdown', touch(1, 200, 300));
    canvas.ownerDocument.fire('pointermove', touch(1, 240, 300));
    canvas.ownerDocument.fire('pointerup', touch(1, 240, 300));
    controls.update();
    expect(camera.position.distanceTo(start)).toBeGreaterThan(0.1);
  });
});
