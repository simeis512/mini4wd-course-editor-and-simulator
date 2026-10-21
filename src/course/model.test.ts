import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D, Vector3 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { getPart } from './catalog';
import type { PartDef } from './part';
import { layoutCourse } from './course';
import { setTwist } from './edit';
import { matrixToPose, modelFor, partGeometry, useModel } from './geometry';
import { buildCourseMeshes } from './mesh';
import { parsePartModel, shapeSource, type PartModel } from './model';
import { chain } from './presets';

const straight = getPart('straight');

/** Metadata for a straight measured 2 mm longer than the catalog says. */
function measured(): unknown {
  const ports = partGeometry(straight).ports.map(matrixToPose);
  ports[1].pos[2] += 2;
  return {
    part: 'straight',
    version: 1,
    visual: 'models/straight/v1.glb',
    collider: 'models/straight/v1-collider.glb',
    ports: straight.ports.map((p, i) => ({ id: p.id, lanes: p.lanes, anchor: ports[i] })),
    laneCenterlines: [-120, 0, 120].map((x) => [
      [x, 0, 0],
      [x, 0, 542],
    ]),
    source: 'step/straight.step',
  };
}

/** The straight as if its master data named a model (spec 15.1). */
const withModel: PartDef = { ...straight, model: 'models/straight/v1.json' };

afterEach(() => useModel('straight', null));

describe('measured model metadata (spec 15.3)', () => {
  it('reads metadata that fits the part', () => {
    const m = parsePartModel(measured(), straight);
    expect(m.ports.map((p) => p.id)).toEqual(['a', 'b']);
    expect(m.ports[1].anchor.pos[2]).toBeCloseTo(542);
  });

  it('turns down metadata whose ports differ from the part', () => {
    const wrongId = measured() as PartModel;
    wrongId.ports[1].id = 'c';
    expect(() => parsePartModel(wrongId, straight)).toThrow(/port 1/);
    const fewer = measured() as PartModel;
    fewer.ports.pop();
    expect(() => parsePartModel(fewer, straight)).toThrow(/ports differ/);
    expect(() => parsePartModel(measured(), getPart('curve45'))).toThrow(/made for straight/);
    expect(() => parsePartModel({ ...(measured() as object), laneCenterlines: [] }, straight)).toThrow(/centreline/);
  });
});

describe('shape source switch (spec 15.1)', () => {
  it('sweeps parts with no model', () => {
    expect(shapeSource(straight)).toEqual({ kind: 'procedural' });
  });

  it('sweeps a part whose model is not loaded yet', () => {
    expect(shapeSource(withModel)).toEqual({ kind: 'model', path: 'models/straight/v1.json', model: null });
  });

  it('places ports where the model has them once it is in use', () => {
    const model = parsePartModel(measured(), straight);
    useModel('straight', model);
    expect(modelFor('straight')).toBe(model);
    expect(shapeSource(withModel)).toMatchObject({ kind: 'model', model });
    const layout = layoutCourse(chain(['straight', 'straight']));
    expect(new Vector3().setFromMatrixPosition(layout.pieces[1].ports[1]).z).toBeCloseTo(1084);
    useModel('straight', null);
    expect(new Vector3().setFromMatrixPosition(layoutCourse(chain(['straight', 'straight'])).pieces[1].ports[1]).z).toBeCloseTo(1080);
  });

  it('shows the model mesh in place of the sweep, twisted with the piece', () => {
    useModel('straight', parsePartModel(measured(), straight));
    const visual = new Object3D();
    const box = new BoxGeometry(360, 10, 540).translate(0, 5, 270);
    visual.add(new Mesh(box, new MeshBasicMaterial()));
    const layout = layoutCourse(setTwist(chain(['straight']), 0, 3));
    layout.pieces[0].part = withModel;
    const [group] = buildCourseMeshes(layout, new Map([['straight', visual]]));
    const mesh = group.children[0].children[0] as Mesh;
    expect(mesh).toBeInstanceOf(Mesh);
    // The original is left alone; the piece's copy leans at the far end.
    expect(mesh.geometry).not.toBe(box);
    const was = box.getAttribute('position');
    const pos = mesh.geometry.getAttribute('position');
    // The top right corner at the far end drops by about 180 sin 3°.
    const farRight = [...Array(was.count).keys()].find((i) => was.getX(i) < -170 && was.getZ(i) > 530 && was.getY(i) > 5)!;
    expect(pos.getY(farRight)).toBeCloseTo(10 * Math.cos((3 * Math.PI) / 180) - 180 * Math.sin((3 * Math.PI) / 180), 3);
  });
});
