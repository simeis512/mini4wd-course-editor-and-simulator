import * as THREE from 'three';
import { dotCell } from './ar-pose';

/** Distance between the dots left where the floor was found, m. */
const DOT_SPACING = 0.05;
/** Most dots kept; older ones are reused after this. */
const DOT_LIMIT = 3000;
/** Depth shown from red (near) to blue (this far), m. */
const DEPTH_RANGE = 4;
const DEPTH_OPACITY = 0.4;

/** What a session is asked for so the phone shares its depth view (ARCore depth, cpu-optimized on Android). */
export const DEPTH_SENSING: XRDepthStateInit = {
  usagePreference: ['cpu-optimized'],
  dataFormatPreference: ['luminance-alpha'],
};

/**
 * What the phone has found of the room while the course is being aimed (#19):
 * dots on every floor point the ring has touched, and, where the phone shares
 * its depth view, the distance to everything in sight coloured over the camera.
 */
export class ArScan {
  private dots: THREE.InstancedMesh;
  private cells = new Set<string>();
  private count = 0;
  private depth: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private depthTexture: THREE.DataTexture | null = null;
  /** Whether the depth view is shown when the phone has one. */
  depthWanted = true;

  constructor(scene: THREE.Scene) {
    this.dots = new THREE.InstancedMesh(DOT_GEOMETRY, DOT_MATERIAL, DOT_LIMIT);
    this.dots.count = 0;
    this.dots.frustumCulled = false;
    scene.add(this.dots);
    this.depth = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), depthMaterial());
    this.depth.frustumCulled = false;
    // Drawn first, under the course and the dots.
    this.depth.renderOrder = -1;
    this.depth.visible = false;
    scene.add(this.depth);
  }

  /** Whether this session shares the phone's depth view in a form we can read. */
  static hasDepth(session: XRSession): boolean {
    return !!session.enabledFeatures?.includes('depth-sensing') && session.depthUsage === 'cpu-optimized' && session.depthDataFormat === 'luminance-alpha';
  }

  /** Leave a dot at a floor point the ring touched, unless one is already near. */
  addDot(at: THREE.Vector3): void {
    const cell = dotCell(at, DOT_SPACING);
    if (this.cells.has(cell)) return;
    this.cells.add(cell);
    this.dots.setMatrixAt(this.count % DOT_LIMIT, new THREE.Matrix4().makeTranslation(at.x, at.y, at.z));
    this.count++;
    this.dots.count = Math.min(this.count, DOT_LIMIT);
    this.dots.instanceMatrix.needsUpdate = true;
  }

  /** Colour the depth view over the camera for this frame, if wanted and given. */
  showDepth(frame: XRFrame, view: XRView | undefined): void {
    const info = this.depthWanted && view ? frame.getDepthInformation(view) : null;
    this.depth.visible = !!info;
    if (!info) return;
    let tex = this.depthTexture;
    if (!tex || tex.image.width !== info.width || tex.image.height !== info.height) {
      tex?.dispose();
      tex = new THREE.DataTexture(new Uint8Array(info.width * info.height * 2), info.width, info.height, THREE.RGFormat, THREE.UnsignedByteType);
      tex.magFilter = tex.minFilter = THREE.LinearFilter;
      this.depthTexture = tex;
      this.depth.material.uniforms.depth.value = tex;
    }
    (tex.image.data as Uint8Array).set(new Uint8Array(info.data));
    tex.needsUpdate = true;
    const u = this.depth.material.uniforms;
    u.uvTransform.value.fromArray(info.normDepthBufferFromNormView.matrix);
    u.rawToMetres.value = info.rawValueToMeters;
  }

  /** Show the dots and the depth view only while aiming. */
  set visible(on: boolean) {
    this.dots.visible = on;
    if (!on) this.depth.visible = false;
  }

  /** Forget what was found, at the end of a session. */
  clear(): void {
    this.cells.clear();
    this.count = 0;
    this.dots.count = 0;
    this.depth.visible = false;
  }
}

const DOT_GEOMETRY = new THREE.CircleGeometry(0.008, 8).rotateX(-Math.PI / 2).translate(0, 0.002, 0);
const DOT_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });

/** A full-screen quad colouring each pixel by its depth: red near, blue far. */
function depthMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      depth: { value: null },
      uvTransform: { value: new THREE.Matrix4() },
      rawToMetres: { value: 0.001 },
      range: { value: DEPTH_RANGE },
      opacity: { value: DEPTH_OPACITY },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D depth;
      uniform mat4 uvTransform;
      uniform float rawToMetres;
      uniform float range;
      uniform float opacity;
      varying vec2 vUv;
      void main() {
        // Normalised view coordinates start at the top left.
        vec2 at = (uvTransform * vec4(vUv.x, 1.0 - vUv.y, 0.0, 1.0)).xy;
        vec2 la = texture2D(depth, at).rg * 255.0;
        float metres = (la.r + la.g * 256.0) * rawToMetres;
        if (metres <= 0.0) discard;
        float t = clamp(metres / range, 0.0, 1.0);
        vec3 near = vec3(1.0, 0.25, 0.2);
        vec3 mid = vec3(1.0, 0.9, 0.3);
        vec3 far = vec3(0.2, 0.45, 1.0);
        vec3 c = t < 0.5 ? mix(near, mid, t * 2.0) : mix(mid, far, t * 2.0 - 1.0);
        gl_FragColor = vec4(c, opacity);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}
