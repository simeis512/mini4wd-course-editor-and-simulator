import * as THREE from 'three';
import type { Block } from './blocks';
import type { Layout } from './course';
import type { PropRef } from './props';
import { material } from './mesh';
import { boxBlocks, hoseColor, hoseCurve, HOSE_DIAMETER } from './stoppers';
import { startStickers, timerBlocks } from './timing';

// The start line, lap timer and floor stoppers as meshes (#56, #53), in
// world millimetres like the pieces; the caller scales to metres.


/** Colours: white stickers with a black arrow; the timer pale blue-grey as on the box art, its tape aluminium; brown cardboard. */
export const PROP_COLORS: Record<string, string> = {
  sticker: '#f4f4f0',
  arrow: '#1b1d22',
  body: '#6f8db3',
  top: '#a9bdd4',
  tape: '#c9ced6',
  box: '#b48a5a',
};

function blockMesh(b: Block): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...b.size), material(PROP_COLORS[b.role], 1));
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(b.frame);
  return mesh;
}

/** Flat triangles through world points, each a list of three. */
function flat(triangles: THREE.Vector3[][], color: string): THREE.Mesh {
  const geo = new THREE.BufferGeometry().setFromPoints(triangles.flat());
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material(color, 1, true));
}

function group(prop: PropRef, children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.name = prop.kind;
  g.userData.prop = prop;
  g.add(...children);
  return g;
}

/** One group for the start line, one for the timer and one per stopper, each keeping what it is in `userData.prop` (`PropRef`). */
export function buildPropMeshes(layout: Layout): THREE.Group[] {
  const out: THREE.Group[] = [];
  if (layout.start) {
    const stickers = startStickers(layout, layout.start);
    const lift = (p: THREE.Vector3) => p.clone().setY(p.y + 0.1);
    out.push(
      group({ kind: 'start' }, [
        flat(stickers.flatMap(({ corners: [a, b, c, d] }) => [[a, b, c], [a, c, d]]), PROP_COLORS.sticker),
        flat(stickers.map((s) => s.arrow.map(lift)), PROP_COLORS.arrow),
      ]),
    );
  }
  if (layout.timer) out.push(group({ kind: 'timer' }, timerBlocks(layout, layout.timer).map(blockMesh)));
  layout.stoppers.forEach((s, index) => {
    const prop: PropRef = { kind: 'stopper', index };
    if (s.kind === 'box') {
      out.push(group(prop, boxBlocks(s).map(blockMesh)));
      return;
    }
    const r = HOSE_DIAMETER / 2;
    const pts = hoseCurve(s);
    if (s.closed) pts.pop();
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, r, z)), !!s.closed);
    const tube = new THREE.TubeGeometry(curve, pts.length * 2, r, 8, !!s.closed);
    out.push(group(prop, [new THREE.Mesh(tube, material(hoseColor(s), 1))]));
  });
  return out;
}
