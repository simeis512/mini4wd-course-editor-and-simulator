import * as THREE from 'three';
import { halfWidth } from '../course/mesh';
import { JOINT_REACH, JOINT_SELECTED_SIZE, MARK_OUTLINE } from './mark-style';
import type { Clash } from '../course/clash';
import type { PlacedPiece } from '../course/course';
import { GLOBAL_SPEC } from '../course/catalog';
import { pieceTracks, roadOutline } from '../course/mesh';
import { drawClashMark, drawStackMark } from './view';

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
/** Height of a stack's count on screen, as a share of the view's height (#146). */
export const STACK_MARK_SIZE = 0.035;
const stackMaps = new Map<string, THREE.CanvasTexture>();

/** A sprite showing a stack's count (#146), its lower left corner at the mark so it stands up and to the right. */
export function stackSprite(text: string): THREE.Sprite {
  let map = stackMaps.get(text);
  if (!map) {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(2, 2);
    drawStackMark(ctx, 24, 12, text);
    map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    stackMaps.set(text, map);
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthTest: false, sizeAttenuation: false }));
  sprite.center.set(0.1, 0);
  sprite.renderOrder = 10;
  return sprite;
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
/** The joint mark's bar, mm: as thick as 2D's line looks from above; its length goes by the track's width. */
const JOINT_BAR = { height: 12, depth: 16 };
/** Radius of the disc in the middle of the joint mark, mm (2D's dot over its line). */
const JOINT_DISC = 22;
/** How far the dark edge stands out round a joint mark, mm (#146). */
const JOINT_EDGE = 3;
/** Gap between the road and the bottom of a joint mark's edge, mm, so that none of it sinks into the road (#146). */
const JOINT_LIFT = 1;
// The edge writes no depth and is drawn after the course but before the
// mark, so the mark always covers it where they overlap: only the rim
// round the mark shows, never the edge of the bar across the disc (#146).
export const MARK_EDGE = new THREE.MeshBasicMaterial({ color: MARK_OUTLINE, side: THREE.BackSide, depthWrite: false });
const EDGE_ORDER = 1;
const MARK_ORDER = 2;
const jointGeometries = new Map<string, THREE.BufferGeometry[]>();

/**
 * The geometries of a joint mark across `laneCount` lanes, as in 2D (#146):
 * a bar across JOINT_REACH of the track and a disc in its middle, standing
 * on the road with its edge just clear of it, thicker by `size`; then the
 * same grown by the edge.
 */
function jointGeometry(laneCount: number, size: number): THREE.BufferGeometry[] {
  const key = `${laneCount}:${size}`;
  let g = jointGeometries.get(key);
  if (!g) {
    const length = 2 * halfWidth(laneCount) * JOINT_REACH;
    const height = JOINT_BAR.height * size;
    const y = height / 2 + JOINT_EDGE + JOINT_LIFT;
    const parts = (grow: number) => [
      new THREE.BoxGeometry(length + 2 * grow, height + 2 * grow, JOINT_BAR.depth * size + 2 * grow).translate(0, y, 0),
      new THREE.CylinderGeometry(JOINT_DISC * size + grow, JOINT_DISC * size + grow, height + 2 * grow, 24).translate(0, y, 0),
    ];
    g = [...parts(0), ...parts(JOINT_EDGE)];
    jointGeometries.set(key, g);
  }
  return g;
}

/** A joint's mark in `material`, edged dark; the first child is the one picking looks at. */
export function jointMark(laneCount: number, material: THREE.Material, selected: boolean): THREE.Group {
  const [bar, disc, barEdge, discEdge] = jointGeometry(laneCount, selected ? JOINT_SELECTED_SIZE : 1);
  const g = new THREE.Group();
  const mesh = (geometry: THREE.BufferGeometry, m: THREE.Material, order: number) => {
    const x = new THREE.Mesh(geometry, m);
    x.renderOrder = order;
    return x;
  };
  g.add(mesh(bar, material, MARK_ORDER), mesh(disc, material, MARK_ORDER), mesh(barEdge, MARK_EDGE, EDGE_ORDER), mesh(discEdge, MARK_EDGE, EDGE_ORDER));
  return g;
}

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
