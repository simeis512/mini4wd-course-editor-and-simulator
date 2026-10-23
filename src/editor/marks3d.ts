import * as THREE from 'three';
import type { Clash } from '../course/clash';
import type { PlacedPiece } from '../course/course';
import { GLOBAL_SPEC } from '../course/catalog';
import { pieceTracks, roadOutline } from '../course/mesh';
import { drawClashMark } from './view';

const OUTLINE_SOLID = new THREE.LineBasicMaterial({ color: 0x3fd0ff });
const OUTLINE_DASHED = new THREE.LineDashedMaterial({ color: 0x3fd0ff, dashSize: 50, gapSize: 30 });

/** The edge of a piece's road at the height of its fence tops, one loop per track. */
export function outlineOf(pc: PlacedPiece, index: number, solid: boolean): THREE.Line[] {
  const y = GLOBAL_SPEC.fenceHeight + 1;
  return pieceTracks(pc, index).map(({ samples, section }) => {
    const pts = roadOutline(samples, section, y);
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), solid ? OUTLINE_SOLID : OUTLINE_DASHED);
    if (!solid) line.computeLineDistances();
    return line;
  });
}

export const MARKER_GEOMETRY = new THREE.ConeGeometry(45, 90, 16).rotateX(Math.PI / 2).translate(0, 30, 30);
export const MARKER_OPEN = new THREE.MeshStandardMaterial({ color: 0xff9a2e, emissive: 0x552200 });
export const MARKER_SELECTED = new THREE.MeshStandardMaterial({ color: 0x3fd0ff, emissive: 0x114455 });
export const MARKER_SPLIT = new THREE.MeshStandardMaterial({ color: 0xff5a5a, emissive: 0x551111 });
export const MARKER_JOINT = new THREE.MeshStandardMaterial({ color: 0x39c26b, emissive: 0x0d3d1f });
/** A port left open on purpose (#13). */
export const MARKER_INTENDED = new THREE.MeshStandardMaterial({ color: 0x8a9099, emissive: 0x22252a });

/** Size of a clash mark on screen, as a share of the view's height. */
export const CLASH_MARK_SIZE = 0.05;

/** A sprite material showing the clash mark, drawn once per kind and shared. */
function clashMaterial(kind: Clash['kind']): () => THREE.SpriteMaterial {
  let map: THREE.CanvasTexture | null = null;
  return () => {
    if (!map) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(2, 2);
      drawClashMark(ctx, 16, 16, kind);
      map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
    }
    return new THREE.SpriteMaterial({ map, depthTest: false, sizeAttenuation: false });
  };
}
export const CLASH_MATERIALS: Record<Clash['kind'], () => THREE.SpriteMaterial> = {
  interference: clashMaterial('interference'),
  clearance: clashMaterial('clearance'),
  stopper: clashMaterial('stopper'),
};
/** A ball on each point of the selected hose, to drag. */
export const HANDLE_GEOMETRY = new THREE.SphereGeometry(18, 16, 12);
export const HANDLE = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x333333 });
/** Height of a marker's middle above its port, mm, where picking aims. */
export const MARKER_PICK_HEIGHT = 10;
/** A flat bar across the middle of a joint, standing just above the road. */
export const JOINT_GEOMETRY = new THREE.BoxGeometry(90, 12, 24).translate(0, 8, 0);

/** Highlight level of the pieces a raise would move. */
export const RUN_LEVEL = 3;
const HIGHLIGHT = [0, 0x0a2a35, 0x1a6680, 0x664400];
const highlightCache = [0, 1, 2, 3].map(() => new WeakMap<THREE.Material, THREE.Material>());
const baseOf = new WeakMap<THREE.Material, THREE.Material>();

/** `level` 2: the selection; 1: joined to it; 3: a run about to be raised. */
export function highlighted(m: THREE.Material | THREE.Material[], level: number): THREE.Material {
  const base = unhighlighted(m);
  let h = highlightCache[level].get(base);
  if (!h) {
    const c = (base as THREE.MeshStandardMaterial).clone();
    c.emissive = new THREE.Color(HIGHLIGHT[level]);
    highlightCache[level].set(base, c);
    baseOf.set(c, base);
    h = c;
  }
  return h;
}

export function unhighlighted(m: THREE.Material | THREE.Material[]): THREE.Material {
  const single = Array.isArray(m) ? m[0] : m;
  return baseOf.get(single) ?? single;
}
