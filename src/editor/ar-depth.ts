import * as THREE from 'three';

/** Depth shown from red (near) to blue (this far), m. */
const DEPTH_RANGE = 4;
const DEPTH_OPACITY = 0.4;
/**
 * Real things hide the course only when nearer than it by this much, m, plus
 * a share of the distance, as ARCore depth wavers by a few cm; otherwise the
 * floor the course lies on would flicker through the road (#19, provisional).
 */
const OCCLUSION_MARGIN = 0.05;
const OCCLUSION_MARGIN_SHARE = 0.04;

/** What a session is asked for so the phone shares its depth view (ARCore depth, cpu-optimized on Android). */
export const DEPTH_SENSING: XRDepthStateInit = {
  usagePreference: ['cpu-optimized'],
  dataFormatPreference: ['luminance-alpha'],
};

/**
 * The phone's depth view in AR (#19): coloured over the camera while the
 * course is being aimed, and used to hide the course behind real things
 * (occlusion). Both need a phone that shares ARCore depth.
 */
export class ArDepth {
  /** The distance to everything in sight, coloured over the camera. */
  private view: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** Writes the real distances into the depth buffer, so the course behind real things is not drawn. */
  private occluder: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private texture: THREE.DataTexture | null = null;
  /** Shared by both quads. */
  private uniforms = {
    depth: { value: null as THREE.DataTexture | null },
    uvTransform: { value: new THREE.Matrix4() },
    rawToMetres: { value: 0.001 },
  };
  /** Whether the coloured depth view is wanted (while aiming). */
  viewWanted = true;
  /** Whether the course hides behind real things. */
  occlusionWanted = true;

  constructor(scene: THREE.Scene) {
    this.view = fullScreen(viewMaterial(this.uniforms));
    // Drawn early, under the course and the dots.
    this.view.renderOrder = -1;
    this.occluder = fullScreen(occluderMaterial(this.uniforms));
    // Drawn first of all, so the course is tested against it.
    this.occluder.renderOrder = -2;
    scene.add(this.view, this.occluder);
  }

  /** Whether this session shares the phone's depth view in a form we can read. */
  static available(session: XRSession): boolean {
    return !!session.enabledFeatures?.includes('depth-sensing') && session.depthUsage === 'cpu-optimized' && session.depthDataFormat === 'luminance-alpha';
  }

  /** Take this frame's depth and show what is wanted; `aiming` shows the coloured view. */
  update(frame: XRFrame, view: XRView | undefined, aiming: boolean): void {
    const showView = aiming && this.viewWanted;
    const info = (showView || this.occlusionWanted) && view ? frame.getDepthInformation(view) : null;
    this.view.visible = !!info && showView;
    this.occluder.visible = !!info && this.occlusionWanted;
    if (!info) return;
    let tex = this.texture;
    if (!tex || tex.image.width !== info.width || tex.image.height !== info.height) {
      tex?.dispose();
      tex = new THREE.DataTexture(new Uint8Array(info.width * info.height * 2), info.width, info.height, THREE.RGFormat, THREE.UnsignedByteType);
      // The low and high bytes of a distance cannot be blended apart.
      tex.magFilter = tex.minFilter = THREE.NearestFilter;
      this.texture = tex;
      this.uniforms.depth.value = tex;
    }
    (tex.image.data as Uint8Array).set(new Uint8Array(info.data));
    tex.needsUpdate = true;
    this.uniforms.uvTransform.value.fromArray(info.normDepthBufferFromNormView.matrix);
    this.uniforms.rawToMetres.value = info.rawValueToMeters;
  }

  /** Show nothing, at the end of a session. */
  hide(): void {
    this.view.visible = this.occluder.visible = false;
  }
}

function fullScreen(material: THREE.ShaderMaterial): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  /** The terms of the camera's projection that turn a view-space z into depth. */
  varying vec2 vDepthTerms;
  void main() {
    vUv = uv;
    vDepthTerms = vec2(projectionMatrix[2][2], projectionMatrix[3][2]);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

/** Reads the distance (m) at this pixel into \`metres\`; 0 where the phone does not know. */
const READ_DEPTH = /* glsl */ `
  uniform sampler2D depth;
  uniform mat4 uvTransform;
  uniform float rawToMetres;
  varying vec2 vUv;
  float metresHere() {
    // Normalised view coordinates start at the top left.
    vec2 at = (uvTransform * vec4(vUv.x, 1.0 - vUv.y, 0.0, 1.0)).xy;
    vec2 la = texture2D(depth, at).rg * 255.0;
    return (la.r + la.g * 256.0) * rawToMetres;
  }`;

/** Red near to blue far, see-through. */
function viewMaterial(uniforms: object): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, range: { value: DEPTH_RANGE }, opacity: { value: DEPTH_OPACITY } },
    vertexShader: VERTEX,
    fragmentShader: /* glsl */ `
      ${READ_DEPTH}
      uniform float range;
      uniform float opacity;
      void main() {
        float metres = metresHere();
        if (metres <= 0.0) discard;
        float t = clamp(metres / range, 0.0, 1.0);
        vec3 near = vec3(1.0, 0.25, 0.2);
        vec3 mid = vec3(1.0, 0.9, 0.3);
        vec3 far = vec3(0.2, 0.45, 1.0);
        vec3 c = t < 0.5 ? mix(near, mid, t * 2.0) : mix(mid, far, t * 2.0 - 1.0);
        gl_FragColor = vec4(c, opacity);
      }`,
    // Blended but kept with the opaque things, so it is drawn before the course
    // (by render order) instead of over it like a transparent one would be.
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthTest: false,
    depthWrite: false,
  });
}

/** Depth only: the real distance at each pixel, as the camera's depth buffer would hold it. */
function occluderMaterial(uniforms: object): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, margin: { value: OCCLUSION_MARGIN }, marginShare: { value: OCCLUSION_MARGIN_SHARE } },
    vertexShader: VERTEX,
    fragmentShader: /* glsl */ `
      ${READ_DEPTH}
      uniform float margin;
      varying vec2 vDepthTerms;
      uniform float marginShare;
      void main() {
        float metres = metresHere();
        if (metres <= 0.0) discard;
        // Push the real distance back, so only things clearly in front hide the course.
        metres = metres * (1.0 + marginShare) + margin;
        // The distance is along the view axis: a view-space z of -metres.
        float ndc = (vDepthTerms.y - vDepthTerms.x * metres) / metres;
        gl_FragDepth = clamp(ndc * 0.5 + 0.5, 0.0, 1.0);
        gl_FragColor = vec4(0.0);
      }`,
    colorWrite: false,
    // WebGL writes depth only with the depth test on, so let every pixel pass.
    depthTest: true,
    depthFunc: THREE.AlwaysDepth,
    depthWrite: true,
  });
}
