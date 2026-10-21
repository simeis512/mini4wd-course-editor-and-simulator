import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';

// Three uses a WebXR Layers projection layer whenever the browser offers one.
// On Android Chrome that path left the AR camera feed black, so hide it and
// let three fall back to the long-supported XRWebGLLayer, which composites
// with alpha over the camera image.
if (typeof XRWebGLBinding !== 'undefined' && 'createProjectionLayer' in XRWebGLBinding.prototype) {
  delete (XRWebGLBinding.prototype as Partial<XRWebGLBinding>).createProjectionLayer;
}

/** What the 3D view changes while AR runs. */
export interface ArHooks {
  onStart(): void;
  onEnd(): void;
}

/** AR (WebXR) for viewing the course only: the button, our overlay and where the course goes. */
export class ArMode {
  readonly status: HTMLElement;

  constructor(
    renderer: THREE.WebGLRenderer,
    container: HTMLElement,
    private root: THREE.Object3D,
    hooks: ArHooks,
  ) {
    // Our own DOM overlay for AR: an exit button and a status line, so
    // problems on the phone are visible instead of a silent black screen.
    const overlay = document.getElementById('ar-overlay')!;
    this.status = document.getElementById('ar-status')!;
    const arButton = ARButton.createButton(renderer, {
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: overlay },
    });
    arButton.classList.add('ar-button');
    container.appendChild(arButton);
    document.getElementById('ar-exit')!.addEventListener('click', () => void renderer.xr.getSession()?.end());
    renderer.xr.addEventListener('sessionstart', () => {
      document.documentElement.classList.add('xr-presenting');
      overlay.hidden = false;
      const session = renderer.xr.getSession();
      const layer = session?.renderState.layers?.length ? 'projection' : 'webgl';
      this.status.textContent = `AR表示中：コースは足元の少し前に置いています（${session?.environmentBlendMode ?? '?'} / ${layer}）`;
      hooks.onStart();
      this.place();
    });
    renderer.xr.addEventListener('sessionend', () => {
      document.documentElement.classList.remove('xr-presenting');
      overlay.hidden = true;
      this.root.position.set(0, 0, 0);
      hooks.onEnd();
    });
  }

  /** Centre the course on the floor about 1.5 m in front of where AR started. */
  private place(): void {
    this.root.position.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root);
    const centre = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    // The 'local' space starts at the phone, so the floor is roughly 1.2 m below.
    this.root.position.set(-centre.x, -1.2, -1.5 - centre.z);
  }
}
