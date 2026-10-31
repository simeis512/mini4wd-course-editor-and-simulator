import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Layout } from './course';
import { material, sweepBox } from './mesh';
import { tapeStrips, type TapeKind } from './tape';

// The joint tape as meshes (#133), in world millimetres like the pieces;
// the caller scales to metres.

/** Colours of the kinds of tape (cosmetic): pale green curing tape, clear-brown packing tape, tan cloth tape. */
export const TAPE_COLORS: Record<TapeKind, string> = {
  curing: '#9fcf7a',
  opp: '#d9c38f',
  cloth: '#b98c5a',
};

/** One mesh for the floor strips and one for the wall strips; null with no tape. */
export function buildTapeMesh(layout: Layout): THREE.Group | null {
  const tape = layout.tape;
  const strips = tapeStrips(layout);
  if (!tape || !strips.length) return null;
  const group = new THREE.Group();
  group.name = 'joint-tape';
  for (const where of ['floor', 'wall'] as const) {
    const spec = tape[where];
    const parts = strips
      .filter((s) => s.where === where)
      .map((s) => sweepBox(s.frames, s.x[0], s.x[1], s.y[0], s.y[1]).applyMatrix4(layout.pieces[s.piece].matrix));
    if (!spec || !parts.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(parts), material(TAPE_COLORS[spec.kind], 1, true));
    mesh.name = `tape-${where}`;
    for (const p of parts) p.dispose();
    group.add(mesh);
  }
  return group;
}
